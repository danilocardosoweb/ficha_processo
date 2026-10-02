-- Keep the imported Simplificada immutable while exposing the approved
-- simulation as the operational work sequence.
begin;

alter table public.production_orders
  add column if not exists original_machine_code text,
  add column if not exists original_sequence integer,
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

update public.production_orders
set original_machine_code = coalesce(original_machine_code, machine_code),
    original_sequence = coalesce(original_sequence, sequence),
    active_sequence_source = coalesce(active_sequence_source, 'original')
where original_machine_code is null or original_sequence is null;

create or replace function private.preserve_original_production_sequence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.original_machine_code := coalesce(new.original_machine_code, new.machine_code);
    new.original_sequence := coalesce(new.original_sequence, new.sequence);
  else
    new.original_machine_code := old.original_machine_code;
    new.original_sequence := old.original_sequence;
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_original_production_sequence on public.production_orders;
create trigger preserve_original_production_sequence
before insert or update of machine_code, sequence, original_machine_code, original_sequence
on public.production_orders
for each row execute function private.preserve_original_production_sequence();

create or replace function private.freeze_started_order_sequence()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A running/started order remains in its current press and position. The
  -- rest of an approved scenario can still be applied around it.
  if tg_op = 'UPDATE'
     and old.actual_start is not null
     and (new.machine_code is distinct from old.machine_code or new.sequence is distinct from old.sequence) then
    new.machine_code := old.machine_code;
    new.sequence := old.sequence;
  end if;
  return new;
end;
$$;

drop trigger if exists freeze_started_order_sequence on public.production_orders;
create trigger freeze_started_order_sequence
before update of machine_code, sequence on public.production_orders
for each row execute function private.freeze_started_order_sequence();

alter table public.simplified_imports
  add column if not exists active_sequence_source text not null default 'original',
  add column if not exists active_sequence_scenario_id uuid references public.simulation_scenarios(id) on delete set null,
  add column if not exists active_sequence_version integer,
  add column if not exists active_sequence_approved_at timestamptz,
  add column if not exists active_sequence_approved_by_name text;

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

-- The approval RPC already performs the physical/resource checks and writes the
-- selected sequence. This trigger adds provenance after that transaction point,
-- without changing the immutable original snapshot captured above.
create or replace function private.mark_approved_work_sequence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
  v_input jsonb;
  v_name text;
  v_order jsonb;
  v_order_id uuid;
  v_import_id uuid;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  select v.version_number, v.input_snapshot
    into v_version, v_input
  from public.simulation_versions v
  where v.scenario_id = new.id and v.version_number = new.current_version;

  select coalesce(u.display_name, u.username)
    into v_name
  from private.local_users u
  where u.id = new.approved_by_user_id;

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
           active_sequence_scenario_id = new.id,
           active_sequence_version = v_version,
           active_sequence_approved_at = coalesce(new.approved_at, now()),
           active_sequence_approved_by_name = v_name
     where id = v_order_id and organization_id = new.organization_id;

    select import_batch_id into v_import_id
    from public.production_orders
    where id = v_order_id and organization_id = new.organization_id;

    if v_import_id is not null then
      update public.simplified_imports
         set active_sequence_source = 'simulation',
             active_sequence_scenario_id = new.id,
             active_sequence_version = v_version,
             active_sequence_approved_at = coalesce(new.approved_at, now()),
             active_sequence_approved_by_name = v_name
       where id = v_import_id and organization_id = new.organization_id;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists mark_approved_work_sequence on public.simulation_scenarios;
create trigger mark_approved_work_sequence
after update of status on public.simulation_scenarios
for each row execute function private.mark_approved_work_sequence();

commit;
