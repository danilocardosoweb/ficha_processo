alter table public.simplified_imports
  add column if not exists machine_code text;

alter table public.production_orders
  add column if not exists produced_quantity integer not null default 0,
  add column if not exists started_by_name text,
  add column if not exists completed_by_name text,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by_name text,
  add column if not exists reprogram_count integer not null default 0,
  add column if not exists last_status_reason text;

alter table public.production_orders
  drop constraint if exists production_orders_organization_id_order_number_key;

create unique index if not exists production_orders_import_order_key
  on public.production_orders (organization_id, import_batch_id, order_number)
  where import_batch_id is not null;

create unique index if not exists production_orders_manual_order_key
  on public.production_orders (organization_id, order_number)
  where import_batch_id is null;

create unique index if not exists simplified_imports_file_hash_key
  on public.simplified_imports (organization_id, file_hash)
  where file_hash is not null;

create index if not exists production_orders_operator_queue_idx
  on public.production_orders (organization_id, machine_code, tool_code, status, sequence)
  where is_active = true and status in ('planned', 'released', 'in_progress', 'paused');

create table if not exists public.production_completions (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  import_batch_id uuid references public.simplified_imports(id) on delete set null,
  operator_name text not null,
  completed_at timestamptz not null default now(),
  produced_kg numeric(14,3) not null default 0 check (produced_kg >= 0),
  produced_quantity integer not null default 0 check (produced_quantity >= 0),
  demand_unit text not null check (demand_unit in ('kg', 'pieces', 'bars')),
  reprogram_cycle integer not null default 0 check (reprogram_cycle >= 0),
  source_snapshot jsonb not null default '{}'::jsonb
);

create index if not exists production_completions_order_idx
  on public.production_completions (production_order_id, completed_at desc);
create index if not exists production_completions_org_date_idx
  on public.production_completions (organization_id, completed_at desc);

alter table public.production_completions enable row level security;
grant select, insert on public.production_completions to anon, authenticated;
grant usage, select on sequence public.production_completions_id_seq to anon, authenticated;

drop policy if exists production_completions_v1_open_select on public.production_completions;
create policy production_completions_v1_open_select on public.production_completions
  for select to anon
  using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);

drop policy if exists production_completions_v1_open_insert on public.production_completions;
create policy production_completions_v1_open_insert on public.production_completions
  for insert to anon
  with check (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);

drop policy if exists production_completions_authenticated_select on public.production_completions;
create policy production_completions_authenticated_select on public.production_completions
  for select to authenticated
  using (organization_id in (select private.authorized_org_ids()));

drop policy if exists production_completions_authenticated_insert on public.production_completions;
create policy production_completions_authenticated_insert on public.production_completions
  for insert to authenticated
  with check (organization_id in (select private.authorized_org_ids()));

create or replace function private.guard_production_order_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status in ('planned', 'released', 'paused') and new.status in ('in_progress', 'cancelled'))
      or (old.status = 'in_progress' and new.status in ('paused', 'completed', 'cancelled'))
      or (old.status = 'completed' and new.status = 'planned'
          and new.reopened_at is not null
          and new.reprogram_count > old.reprogram_count)
    ) then
      raise exception 'Transição de status não permitida: % para %', old.status, new.status;
    end if;

    if new.status = 'in_progress' then
      if nullif(trim(new.started_by_name), '') is null then
        raise exception 'Informe o operador antes de iniciar a produção';
      end if;
      new.actual_start := coalesce(new.actual_start, now());
      new.actual_end := null;
      new.is_active := true;
    elsif new.status = 'completed' then
      if nullif(trim(new.completed_by_name), '') is null then
        raise exception 'Informe o operador antes de concluir a produção';
      end if;
      new.actual_end := coalesce(new.actual_end, now());
      new.is_active := false;
    elsif old.status = 'completed' and new.status = 'planned' then
      new.is_active := true;
      new.actual_start := null;
      new.actual_end := null;
      new.started_by_name := null;
      new.completed_by_name := null;
      new.produced_kg := 0;
      new.produced_quantity := 0;
    elsif new.status = 'cancelled' then
      new.is_active := false;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_production_order_transition on public.production_orders;
create trigger guard_production_order_transition
before update of status on public.production_orders
for each row execute function private.guard_production_order_transition();

create or replace function private.record_production_order_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    insert into public.order_status_history (
      organization_id, production_order_id, from_status, to_status, reason
    ) values (
      new.organization_id, new.id, old.status, new.status, new.last_status_reason
    );

    if new.status = 'completed' then
      insert into public.production_completions (
        organization_id, production_order_id, import_batch_id, operator_name,
        completed_at, produced_kg, produced_quantity, demand_unit,
        reprogram_cycle, source_snapshot
      ) values (
        new.organization_id, new.id, new.import_batch_id, new.completed_by_name,
        new.actual_end, new.produced_kg, new.produced_quantity, new.demand_unit,
        new.reprogram_count, to_jsonb(new)
      );
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists record_production_order_transition on public.production_orders;
create trigger record_production_order_transition
after update of status on public.production_orders
for each row execute function private.record_production_order_transition();

create or replace function private.activate_simplified_queue()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status = 'processed' and new.is_active
     and (old.status is distinct from new.status or old.is_active is distinct from new.is_active) then
    update public.simplified_imports
       set is_active = false
     where organization_id = new.organization_id
       and machine_code = new.machine_code
       and id <> new.id
       and is_active = true;

    update public.production_orders
       set is_active = false
     where organization_id = new.organization_id
       and machine_code = new.machine_code
       and import_batch_id <> new.id
       and status <> 'completed';

    update public.production_orders
       set is_active = coalesce((source_data ->> 'ativa')::boolean, true)
     where import_batch_id = new.id
       and status <> 'completed';
  end if;
  return new;
end;
$$;

drop trigger if exists activate_simplified_queue on public.simplified_imports;
create trigger activate_simplified_queue
after update of status, is_active on public.simplified_imports
for each row execute function private.activate_simplified_queue();
