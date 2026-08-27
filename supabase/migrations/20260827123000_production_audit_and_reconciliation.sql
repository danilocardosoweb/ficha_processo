begin;

alter table public.process_sheets
  add column if not exists achieved_productivity_kg_h numeric(14,3),
  add column if not exists achieved_productivity_recorded_at timestamptz,
  add column if not exists copied_from_process_sheet_id uuid references public.process_sheets(id) on delete set null,
  add column if not exists copied_from_sequence integer;

alter table public.production_orders
  add column if not exists process_sheet_id uuid references public.process_sheets(id) on delete set null,
  add column if not exists achieved_productivity_kg_h numeric(14,3);

create table if not exists public.production_execution_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  process_sheet_id uuid references public.process_sheets(id) on delete set null,
  machine_code text not null,
  tool_code text not null,
  tool_sequence integer,
  plan_code text,
  order_number text not null,
  started_at timestamptz,
  completed_at timestamptz not null,
  produced_kg numeric(14,3) not null default 0,
  produced_quantity numeric(14,3) not null default 0,
  achieved_productivity_kg_h numeric(14,3),
  operator_name text not null,
  setup_snapshot jsonb not null default '{}'::jsonb,
  planning_snapshot jsonb not null default '{}'::jsonb,
  result_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (production_order_id)
);

create table if not exists public.system_audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  action text not null check (action in ('insert','update','delete','complete','copy_setup','import','reconcile')),
  actor_name text not null default 'Sistema',
  occurred_at timestamptz not null default now(),
  before_data jsonb,
  after_data jsonb,
  snapshot jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.production_report_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_name text not null,
  file_hash text,
  source_sheet text,
  row_count integer not null default 0,
  imported_by_name text not null,
  imported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.external_production_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_id uuid not null references public.production_report_imports(id) on delete cascade,
  row_number integer not null,
  machine_code text,
  production_date date,
  batch_number text,
  start_time time,
  end_time time,
  shift_code text,
  product_code text,
  tool_code text,
  tool_sequence integer,
  billet_quantity numeric(14,3),
  billet_length_mm numeric(14,3),
  gross_weight_kg numeric(14,3),
  net_weight_kg numeric(14,3),
  efficiency_percent numeric(10,3),
  achieved_productivity_kg_h numeric(14,3),
  produced_quantity numeric(14,3),
  theoretical_linear_weight_kg_m numeric(14,6),
  actual_linear_weight_kg_m numeric(14,6),
  packaging_linear_weight_kg_m numeric(14,6),
  alloy_code text,
  alloy_used text,
  order_number text,
  state text,
  scrap_kg numeric(14,3),
  losses_kg numeric(14,3),
  matched_execution_id uuid references public.production_execution_history(id) on delete set null,
  match_confidence numeric(5,2),
  matched_at timestamptz,
  raw_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (import_id, row_number)
);

create index if not exists production_execution_history_tool_idx
  on public.production_execution_history (organization_id, tool_code, tool_sequence, completed_at desc);
create index if not exists system_audit_events_lookup_idx
  on public.system_audit_events (organization_id, occurred_at desc, entity_type);
create index if not exists external_production_records_match_idx
  on public.external_production_records (organization_id, production_date, machine_code, tool_code, tool_sequence);

create or replace function public.snapshot_completed_production()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sheet public.process_sheets%rowtype;
  v_productivity numeric(14,3);
  v_actor text;
begin
  if new.status <> 'completed' or old.status = 'completed' then
    return new;
  end if;

  if new.process_sheet_id is not null then
    select * into v_sheet from public.process_sheets where id = new.process_sheet_id;
  end if;
  if v_sheet.id is null then
    select * into v_sheet
      from public.process_sheets
     where organization_id = new.organization_id
       and is_active = true
       and coalesce(machine_code, '') = coalesce(new.machine_code, '')
       and upper(coalesce(product_code, tool_code)) = upper(coalesce(new.product_code, new.tool_code))
     order by updated_at desc
     limit 1;
  end if;

  v_productivity := nullif(new.achieved_productivity_kg_h, 0);
  if v_productivity is null and new.actual_start is not null and new.actual_end is not null
     and new.actual_end > new.actual_start and coalesce(new.produced_kg, 0) > 0 then
    v_productivity := round((new.produced_kg / (extract(epoch from (new.actual_end - new.actual_start)) / 3600.0))::numeric, 3);
  end if;
  v_actor := coalesce(nullif(new.completed_by_name, ''), 'Sistema');

  insert into public.production_execution_history (
    organization_id, production_order_id, process_sheet_id, machine_code, tool_code,
    tool_sequence, plan_code, order_number, started_at, completed_at, produced_kg,
    produced_quantity, achieved_productivity_kg_h, operator_name,
    setup_snapshot, planning_snapshot, result_snapshot
  ) values (
    new.organization_id, new.id, v_sheet.id, new.machine_code,
    coalesce(new.product_code, new.tool_code), v_sheet.tool_sequence,
    new.plan_code, new.order_number, new.actual_start, coalesce(new.actual_end, now()),
    coalesce(new.produced_kg, 0), coalesce(new.produced_quantity, 0), v_productivity, v_actor,
    case when v_sheet.id is null then '{}'::jsonb else to_jsonb(v_sheet) end,
    jsonb_build_object('target_kg', new.target_kg, 'target_quantity', new.target_quantity,
      'demand_unit', new.demand_unit, 'customer_name', new.customer_name, 'alloy_code', new.alloy_code,
      'temper', new.temper, 'due_date', new.due_date, 'sequence', new.sequence),
    jsonb_build_object('produced_kg', new.produced_kg, 'produced_quantity', new.produced_quantity,
      'achieved_productivity_kg_h', v_productivity, 'reason', new.last_status_reason)
  ) on conflict (production_order_id) do nothing;

  if v_sheet.id is not null and v_productivity is not null then
    update public.process_sheets
       set achieved_productivity_kg_h = v_productivity,
           achieved_productivity_recorded_at = coalesce(new.actual_end, now())
     where id = v_sheet.id;
  end if;

  insert into public.system_audit_events (
    organization_id, entity_type, entity_id, action, actor_name, after_data, snapshot, metadata
  ) values (
    new.organization_id, 'production_order', new.id::text, 'complete', v_actor,
    to_jsonb(new), case when v_sheet.id is null then '{}'::jsonb else to_jsonb(v_sheet) end,
    jsonb_build_object('order_number', new.order_number, 'plan_code', new.plan_code,
      'tool_code', coalesce(new.product_code, new.tool_code))
  );
  return new;
end;
$$;

drop trigger if exists snapshot_completed_production_trg on public.production_orders;
create trigger snapshot_completed_production_trg
after update of status on public.production_orders
for each row execute function public.snapshot_completed_production();

create or replace function public.audit_operational_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_org uuid;
  v_id text;
  v_actor text;
begin
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_org := coalesce((v_new->>'organization_id')::uuid, (v_old->>'organization_id')::uuid);
  v_id := coalesce(v_new->>'id', v_old->>'id', 'unknown');
  v_actor := coalesce(v_new->>'last_changed_by_name', v_new->>'completed_by_name',
    v_new->>'reported_by_name', v_new->>'updated_by_name', 'Sistema');
  insert into public.system_audit_events (
    organization_id, entity_type, entity_id, action, actor_name, before_data, after_data
  ) values (v_org, tg_table_name, v_id, lower(tg_op), v_actor, v_old, v_new);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_process_sheets_trg on public.process_sheets;
create trigger audit_process_sheets_trg after insert or update or delete on public.process_sheets
for each row execute function public.audit_operational_change();
drop trigger if exists audit_machine_stoppages_trg on public.machine_stoppages;
create trigger audit_machine_stoppages_trg after insert or update or delete on public.machine_stoppages
for each row execute function public.audit_operational_change();
drop trigger if exists audit_tool_heating_cycles_trg on public.tool_heating_cycles;
create trigger audit_tool_heating_cycles_trg after insert or update or delete on public.tool_heating_cycles
for each row execute function public.audit_operational_change();

alter table public.production_execution_history enable row level security;
alter table public.system_audit_events enable row level security;
alter table public.production_report_imports enable row level security;
alter table public.external_production_records enable row level security;

drop policy if exists "production_execution_history_open_read" on public.production_execution_history;
create policy "production_execution_history_open_read" on public.production_execution_history for select using (true);
drop policy if exists "system_audit_events_open_read" on public.system_audit_events;
create policy "system_audit_events_open_read" on public.system_audit_events for select using (true);
drop policy if exists "production_report_imports_open_access" on public.production_report_imports;
create policy "production_report_imports_open_access" on public.production_report_imports for all using (true) with check (true);
drop policy if exists "external_production_records_open_access" on public.external_production_records;
create policy "external_production_records_open_access" on public.external_production_records for all using (true) with check (true);

grant select on public.production_execution_history, public.system_audit_events to anon, authenticated;
grant select, insert, update, delete on public.production_report_imports, public.external_production_records to anon, authenticated;
grant usage, select on sequence public.system_audit_events_id_seq to anon, authenticated;

commit;
