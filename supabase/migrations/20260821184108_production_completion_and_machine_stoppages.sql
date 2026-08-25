alter table public.simplified_imports
  add column if not exists production_status text not null default 'queued',
  add column if not exists production_started_at timestamptz,
  add column if not exists production_completed_at timestamptz,
  add column if not exists production_completed_by_name text;

alter table public.simplified_imports
  drop constraint if exists simplified_imports_production_status_check;
alter table public.simplified_imports
  add constraint simplified_imports_production_status_check
  check (production_status in ('queued', 'in_progress', 'completed', 'cancelled'));

alter table public.maintenance_work_orders
  add column if not exists opened_by_name text,
  add column if not exists stoppage_id uuid;

create table if not exists public.machine_stoppages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  import_batch_id uuid references public.simplified_imports(id) on delete set null,
  maintenance_work_order_id uuid references public.maintenance_work_orders(id) on delete set null,
  machine_code text not null,
  plan_code text,
  order_number text not null,
  tool_code text not null,
  product_code text,
  customer_name text,
  alloy_code text,
  temper text,
  category text not null,
  reason_code text,
  reason text not null,
  notes text,
  shift text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_minutes numeric(12,2) check (duration_minutes is null or duration_minutes >= 0),
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  maintenance_required boolean not null default true,
  reported_by_name text not null,
  closed_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (category in ('mechanical','electrical','hydraulic','tooling','quality','process','material','setup','other')),
  check ((status = 'open' and ended_at is null) or status <> 'open')
);

alter table public.maintenance_work_orders
  drop constraint if exists maintenance_work_orders_stoppage_id_fkey;
alter table public.maintenance_work_orders
  add constraint maintenance_work_orders_stoppage_id_fkey
  foreign key (stoppage_id) references public.machine_stoppages(id) on delete set null;

create index if not exists machine_stoppages_open_queue_idx
  on public.machine_stoppages (organization_id, status, started_at desc);
create index if not exists machine_stoppages_machine_date_idx
  on public.machine_stoppages (organization_id, machine_code, started_at desc);
create index if not exists machine_stoppages_order_idx
  on public.machine_stoppages (production_order_id, started_at desc);
create index if not exists machine_stoppages_import_idx
  on public.machine_stoppages (import_batch_id);
create index if not exists machine_stoppages_work_order_idx
  on public.machine_stoppages (maintenance_work_order_id)
  where maintenance_work_order_id is not null;
create index if not exists maintenance_work_orders_stoppage_idx
  on public.maintenance_work_orders (stoppage_id)
  where stoppage_id is not null;
create index if not exists simplified_imports_fifo_status_idx
  on public.simplified_imports (organization_id, production_status, created_at);

alter table public.machine_stoppages enable row level security;
grant select, insert, update on public.machine_stoppages to anon, authenticated;

drop policy if exists machine_stoppages_v1_open_select on public.machine_stoppages;
create policy machine_stoppages_v1_open_select on public.machine_stoppages
  for select to anon
  using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);

drop policy if exists machine_stoppages_v1_open_insert on public.machine_stoppages;
create policy machine_stoppages_v1_open_insert on public.machine_stoppages
  for insert to anon
  with check (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);

drop policy if exists machine_stoppages_v1_open_update on public.machine_stoppages;
create policy machine_stoppages_v1_open_update on public.machine_stoppages
  for update to anon
  using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
  with check (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);

drop policy if exists machine_stoppages_authenticated_select on public.machine_stoppages;
create policy machine_stoppages_authenticated_select on public.machine_stoppages
  for select to authenticated
  using (organization_id in (select private.authorized_org_ids()));

drop policy if exists machine_stoppages_authenticated_insert on public.machine_stoppages;
create policy machine_stoppages_authenticated_insert on public.machine_stoppages
  for insert to authenticated
  with check (organization_id in (select private.authorized_org_ids()));

drop policy if exists machine_stoppages_authenticated_update on public.machine_stoppages;
create policy machine_stoppages_authenticated_update on public.machine_stoppages
  for update to authenticated
  using (organization_id in (select private.authorized_org_ids()))
  with check (organization_id in (select private.authorized_org_ids()));

create or replace function private.sync_simplified_production_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pending_count integer;
  started_count integer;
begin
  if new.import_batch_id is null then return new; end if;

  select
    count(*) filter (where po.status not in ('completed', 'cancelled')),
    count(*) filter (where po.status in ('in_progress', 'paused', 'completed'))
  into pending_count, started_count
  from public.production_orders po
  where po.import_batch_id = new.import_batch_id;

  if pending_count = 0 then
    update public.simplified_imports
       set production_status = 'completed',
           production_completed_at = coalesce(production_completed_at, now()),
           production_completed_by_name = coalesce(new.completed_by_name, new.started_by_name, 'Sistema'),
           is_active = false
     where id = new.import_batch_id;
  elsif started_count > 0 then
    update public.simplified_imports
       set production_status = 'in_progress',
           production_started_at = coalesce(production_started_at, now()),
           production_completed_at = null,
           production_completed_by_name = null
     where id = new.import_batch_id;
  else
    update public.simplified_imports
       set production_status = 'queued',
           production_completed_at = null,
           production_completed_by_name = null
     where id = new.import_batch_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_simplified_production_status on public.production_orders;
create trigger sync_simplified_production_status
after insert or update of status on public.production_orders
for each row execute function private.sync_simplified_production_status();

create or replace function private.route_stoppage_to_maintenance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  work_order_id uuid;
begin
  if new.maintenance_required then
    insert into public.maintenance_work_orders (
      organization_id, machine_code, tool_code, production_order_id,
      title, description, priority, status, opened_by_name, stoppage_id, opened_at
    ) values (
      new.organization_id, new.machine_code, new.tool_code, new.production_order_id,
      'Parada ' || new.machine_code || ' · ' || new.reason,
      concat_ws(E'\n', 'Plano: ' || coalesce(new.plan_code, '—'), 'Ordem: ' || new.order_number,
        'Ferramenta: ' || new.tool_code, nullif(new.notes, '')),
      case when new.category in ('mechanical','electrical','hydraulic') then 'high' else 'normal' end,
      'open', new.reported_by_name, new.id, new.started_at
    ) returning id into work_order_id;

    update public.machine_stoppages
       set maintenance_work_order_id = work_order_id
     where id = new.id;
  end if;

  update public.production_orders
     set status = 'paused',
         last_status_reason = 'Parada: ' || new.reason
   where id = new.production_order_id
     and status = 'in_progress';

  insert into public.production_events (
    organization_id, production_order_id, machine_code, type,
    reason_code, notes, occurred_at, source, payload
  ) values (
    new.organization_id, new.production_order_id, new.machine_code, 'stop',
    new.reason_code, concat_ws(' · ', new.reason, nullif(new.notes, '')),
    new.started_at, 'manual', jsonb_build_object('stoppage_id', new.id, 'category', new.category)
  );
  return new;
end;
$$;

drop trigger if exists route_stoppage_to_maintenance on public.machine_stoppages;
create trigger route_stoppage_to_maintenance
after insert on public.machine_stoppages
for each row execute function private.route_stoppage_to_maintenance();

create trigger machine_stoppages_updated_at
before update on public.machine_stoppages
for each row execute function private.set_updated_at();

update public.simplified_imports si
   set production_status = case
     when not exists (
       select 1 from public.production_orders po
       where po.import_batch_id = si.id and po.status not in ('completed','cancelled')
     ) then 'completed'
     when exists (
       select 1 from public.production_orders po
       where po.import_batch_id = si.id and po.status in ('in_progress','paused','completed')
     ) then 'in_progress'
     else 'queued'
   end
 where si.status = 'processed';
