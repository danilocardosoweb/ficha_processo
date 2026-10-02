-- Make the approved simulation the visible operational work sequence.
-- The imported Simplificada remains the immutable original; this migration
-- guarantees that both the order rows and their parent import carry the
-- scenario/version used by the production queue and oven workflow.
begin;

alter table public.production_orders
  add column if not exists active_sequence_source text not null default 'original',
  add column if not exists active_sequence_scenario_id uuid references public.simulation_scenarios(id) on delete set null,
  add column if not exists active_sequence_version integer,
  add column if not exists active_sequence_approved_at timestamptz,
  add column if not exists active_sequence_approved_by_name text;

alter table public.simplified_imports
  add column if not exists active_sequence_source text not null default 'original',
  add column if not exists active_sequence_scenario_id uuid references public.simulation_scenarios(id) on delete set null,
  add column if not exists active_sequence_version integer,
  add column if not exists active_sequence_approved_at timestamptz,
  add column if not exists active_sequence_approved_by_name text;

alter table public.production_orders
  drop constraint if exists production_orders_active_sequence_source_check;
alter table public.production_orders
  add constraint production_orders_active_sequence_source_check
  check (active_sequence_source in ('original', 'simulation'));

alter table public.simplified_imports
  drop constraint if exists simplified_imports_active_sequence_source_check;
alter table public.simplified_imports
  add constraint simplified_imports_active_sequence_source_check
  check (active_sequence_source in ('original', 'simulation'));

create index if not exists production_orders_active_sequence_idx
  on public.production_orders (organization_id, active_sequence_source, machine_code, sequence)
  where is_active = true;

create index if not exists simplified_imports_active_sequence_idx
  on public.simplified_imports (organization_id, active_sequence_source, active_sequence_approved_at desc);

-- Keep the application and the repair path on exactly the same provenance
-- logic. The backfill below is needed for scenarios approved before this
-- trigger was deployed, so the oven workflow can immediately show the active
-- Simplificada after an upgrade.
create or replace function private.apply_approved_work_sequence(p_scenario_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_approved_at timestamptz;
  v_approved_by_user_id uuid;
  v_version integer;
  v_input jsonb;
  v_name text;
  v_order jsonb;
  v_order_id uuid;
  v_import_id uuid;
begin
  select s.organization_id, s.approved_at, s.approved_by_user_id,
         v.version_number, v.input_snapshot
    into v_org, v_approved_at, v_approved_by_user_id, v_version, v_input
  from public.simulation_scenarios s
  join public.simulation_versions v
    on v.scenario_id = s.id and v.version_number = s.current_version
  where s.id = p_scenario_id and s.status = 'approved';

  if v_org is null or v_input is null then
    return;
  end if;

  select coalesce(u.display_name, u.username)
    into v_name
  from private.local_users u
  where u.id = v_approved_by_user_id;

  for v_order in
    select value from jsonb_array_elements(coalesce(v_input -> 'orders', '[]'::jsonb))
  loop
    begin
      v_order_id := nullif(v_order ->> 'id', '')::uuid;
    exception when invalid_text_representation then
      v_order_id := null;
    end;
    if v_order_id is null then
      continue;
    end if;

    update public.production_orders
       set active_sequence_source = 'simulation',
           active_sequence_scenario_id = p_scenario_id,
           active_sequence_version = v_version,
           active_sequence_approved_at = coalesce(v_approved_at, now()),
           active_sequence_approved_by_name = v_name
     where id = v_order_id and organization_id = v_org;

    select import_batch_id into v_import_id
    from public.production_orders
    where id = v_order_id and organization_id = v_org;

    if v_import_id is not null then
      update public.simplified_imports
         set active_sequence_source = 'simulation',
             active_sequence_scenario_id = p_scenario_id,
             active_sequence_version = v_version,
             active_sequence_approved_at = coalesce(v_approved_at, now()),
             active_sequence_approved_by_name = v_name
       where id = v_import_id and organization_id = v_org;
    end if;
  end loop;
end;
$$;

create or replace function private.mark_approved_work_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform private.apply_approved_work_sequence(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists mark_approved_work_sequence on public.simulation_scenarios;
create trigger mark_approved_work_sequence
after update of status on public.simulation_scenarios
for each row execute function private.mark_approved_work_sequence();

-- Repair approved scenarios that were created while the original trigger was
-- absent or before the provenance columns existed. Oldest first means the
-- latest approved scenario wins when an order appears in more than one copy.
do $backfill$
declare
  v_scenario record;
begin
  for v_scenario in
    select id
    from public.simulation_scenarios
    where status = 'approved'
    order by coalesce(approved_at, updated_at), id
  loop
    perform private.apply_approved_work_sequence(v_scenario.id);
  end loop;
end;
$backfill$;

revoke all on function private.mark_approved_work_sequence() from public;
revoke all on function private.apply_approved_work_sequence(uuid) from public;

commit;
