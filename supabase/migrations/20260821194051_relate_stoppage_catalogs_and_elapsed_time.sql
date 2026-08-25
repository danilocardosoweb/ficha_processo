alter table public.operational_catalogs
  add column if not exists parent_id uuid;

alter table public.operational_catalogs
  drop constraint if exists operational_catalogs_parent_id_fkey;
alter table public.operational_catalogs
  add constraint operational_catalogs_parent_id_fkey
  foreign key (parent_id) references public.operational_catalogs(id) on delete restrict;

update public.operational_catalogs reason
   set parent_id = type.id
  from public.operational_catalogs type
 where reason.organization_id = type.organization_id
   and reason.catalog_type = 'stoppage_reason'
   and type.catalog_type = 'stoppage_type'
   and type.code = reason.group_code
   and reason.parent_id is distinct from type.id;

alter table public.operational_catalogs
  drop constraint if exists operational_catalogs_stoppage_parent_check;
alter table public.operational_catalogs
  add constraint operational_catalogs_stoppage_parent_check
  check (catalog_type <> 'stoppage_reason' or parent_id is not null);

create index if not exists operational_catalogs_parent_idx
  on public.operational_catalogs (parent_id, sort_order)
  where parent_id is not null;

alter table public.machine_stoppages
  add column if not exists stoppage_type_catalog_id uuid;

alter table public.machine_stoppages
  drop constraint if exists machine_stoppages_type_catalog_id_fkey;
alter table public.machine_stoppages
  add constraint machine_stoppages_type_catalog_id_fkey
  foreign key (stoppage_type_catalog_id)
  references public.operational_catalogs(id) on delete restrict;

update public.machine_stoppages stoppage
   set stoppage_type_catalog_id = type.id
  from public.operational_catalogs reason
  join public.operational_catalogs type on type.id = reason.parent_id
 where stoppage.reason_catalog_id = reason.id
   and stoppage.stoppage_type_catalog_id is distinct from type.id;

create index if not exists machine_stoppages_type_catalog_idx
  on public.machine_stoppages (stoppage_type_catalog_id, started_at desc)
  where stoppage_type_catalog_id is not null;

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
      title, description, priority, status, opened_by_name, stoppage_id,
      opened_at, completed_at
    ) values (
      new.organization_id, new.machine_code, new.tool_code, new.production_order_id,
      'Parada ' || new.machine_code || ' · ' || new.reason,
      concat_ws(E'\n', 'Plano: ' || coalesce(new.plan_code, '—'),
        'Ordem: ' || new.order_number, 'Ferramenta: ' || new.tool_code,
        'Sintomas: ' || coalesce(new.symptoms, '—'), nullif(new.notes, '')),
      case when new.category in ('mechanical','electrical','hydraulic') then 'high' else 'normal' end,
      case when new.status = 'closed' then 'completed'::public.work_order_status else 'open'::public.work_order_status end,
      new.reported_by_name, new.id, new.started_at,
      case when new.status = 'closed' then new.ended_at else null end
    ) returning id into work_order_id;

    update public.machine_stoppages
       set maintenance_work_order_id = work_order_id
     where id = new.id;
  end if;

  if new.status = 'open' then
    update public.production_orders
       set status = 'paused',
           last_status_reason = 'Parada: ' || new.reason
     where id = new.production_order_id
       and status = 'in_progress';
  end if;

  insert into public.production_events (
    organization_id, production_order_id, machine_code, type,
    reason_code, notes, occurred_at, source, payload
  ) values (
    new.organization_id, new.production_order_id, new.machine_code, 'stop',
    new.reason_code, concat_ws(' · ', new.reason, nullif(new.notes, '')),
    new.started_at, 'manual', jsonb_build_object(
      'stoppage_id', new.id,
      'category', new.category,
      'duration_minutes', new.duration_minutes
    )
  );

  if new.status = 'closed' and new.ended_at is not null then
    insert into public.production_events (
      organization_id, production_order_id, machine_code, type,
      reason_code, notes, occurred_at, source, payload
    ) values (
      new.organization_id, new.production_order_id, new.machine_code, 'resume',
      new.reason_code, 'Retomada após ' || new.reason,
      new.ended_at, 'manual', jsonb_build_object('stoppage_id', new.id)
    );
  end if;
  return new;
end;
$$;
