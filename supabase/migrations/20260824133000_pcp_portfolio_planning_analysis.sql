-- Carteira de encomendas e histórico de planejamentos para análise do PCP.
create table if not exists public.pcp_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_type text not null check (import_type in ('order_portfolio','planning_history')),
  file_name text not null,
  file_hash text,
  source_sheet text,
  row_count integer not null default 0 check (row_count >= 0),
  status text not null default 'processing' check (status in ('processing','processed','failed')),
  imported_by_name text not null default 'Danilo Silva',
  imported_at timestamptz not null default now(),
  processed_at timestamptz,
  error_details jsonb,
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists public.order_portfolio (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_batch_id uuid not null references public.pcp_import_batches(id) on delete cascade,
  source_row integer not null check (source_row > 0),
  order_key text not null,
  order_number text not null,
  customer_name text,
  customer_order_number text,
  source_base text,
  implantation_date date,
  delivery_week integer,
  due_date date,
  original_due_date date,
  scheduled_date date,
  last_invoice_date date,
  product_code text,
  tool_code text,
  service_unit text check (service_unit is null or service_unit in ('kg','pieces')),
  billing_unit text check (billing_unit is null or billing_unit in ('kg','pieces')),
  ordered_kg numeric(16,3) not null default 0,
  ordered_pieces numeric(16,3) not null default 0,
  balance_kg numeric(16,3) not null default 0,
  balance_pieces numeric(16,3) not null default 0,
  committed_kg numeric(16,3) not null default 0,
  committed_pieces numeric(16,3) not null default 0,
  produced_kg numeric(16,3) not null default 0,
  produced_pieces numeric(16,3) not null default 0,
  packed_kg numeric(16,3) not null default 0,
  packed_pieces numeric(16,3) not null default 0,
  invoiced_kg numeric(16,3) not null default 0,
  invoiced_pieces numeric(16,3) not null default 0,
  priority integer,
  alloy_code text,
  temper text,
  status text,
  service_status text,
  item_status text,
  market_code text,
  customer_item text,
  delivery_city text,
  special_conditions text,
  situation_notes text,
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (import_batch_id, source_row)
);

create table if not exists public.planning_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_batch_id uuid not null references public.pcp_import_batches(id) on delete cascade,
  source_row integer not null check (source_row > 0),
  order_key text not null,
  order_number text not null,
  customer_name text,
  product_code text,
  tool_code text,
  programming_date date,
  due_date date,
  requested_kg numeric(16,3) not null default 0,
  requested_pieces numeric(16,3) not null default 0,
  fulfilled_kg numeric(16,3) not null default 0,
  fulfilled_pieces numeric(16,3) not null default 0,
  service_unit text check (service_unit is null or service_unit in ('kg','pieces')),
  item_status text,
  order_status text,
  plan_code text,
  plan_date date,
  planned_kg numeric(16,3) not null default 0,
  planned_pieces numeric(16,3) not null default 0,
  packed_kg numeric(16,3) not null default 0,
  packed_pieces numeric(16,3) not null default 0,
  lot_number text,
  production_date date,
  gross_kg numeric(16,3) not null default 0,
  net_kg numeric(16,3) not null default 0,
  loss_kg numeric(16,3) not null default 0,
  purchased_kg numeric(16,3) not null default 0,
  packaging_date date,
  separated_kg numeric(16,3) not null default 0,
  pending_packaging_kg numeric(16,3) not null default 0,
  racks text,
  stoppage_reason text,
  source_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (import_batch_id, source_row)
);

create unique index if not exists pcp_import_batches_file_idx
  on public.pcp_import_batches (organization_id, import_type, file_hash)
  where file_hash is not null and status = 'processed';
create index if not exists pcp_import_batches_latest_idx
  on public.pcp_import_batches (organization_id, import_type, imported_at desc)
  where status = 'processed';
create index if not exists order_portfolio_tool_due_idx
  on public.order_portfolio (import_batch_id, tool_code, due_date, priority);
create index if not exists order_portfolio_order_key_idx
  on public.order_portfolio (import_batch_id, order_key);
create index if not exists planning_history_order_key_idx
  on public.planning_history (import_batch_id, order_key);
create index if not exists planning_history_plan_idx
  on public.planning_history (import_batch_id, plan_code, plan_date);

alter table public.pcp_import_batches enable row level security;
alter table public.order_portfolio enable row level security;
alter table public.planning_history enable row level security;

do $$
declare t text;
begin
  foreach t in array array['pcp_import_batches','order_portfolio','planning_history']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (organization_id in (select private.authorized_org_ids()))', t||'_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (organization_id in (select private.authorized_org_ids()))', t||'_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (organization_id in (select private.authorized_org_ids())) with check (organization_id in (select private.authorized_org_ids()))', t||'_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (organization_id in (select private.authorized_org_ids()))', t||'_delete', t);
    execute format('create policy %I on public.%I for select to anon using (organization_id = %L::uuid)', t||'_v1_open_select', t, '8557a116-8377-44a6-b2f3-5b087f08bea8');
    execute format('create policy %I on public.%I for insert to anon with check (organization_id = %L::uuid)', t||'_v1_open_insert', t, '8557a116-8377-44a6-b2f3-5b087f08bea8');
    execute format('create policy %I on public.%I for update to anon using (organization_id = %L::uuid) with check (organization_id = %L::uuid)', t||'_v1_open_update', t, '8557a116-8377-44a6-b2f3-5b087f08bea8', '8557a116-8377-44a6-b2f3-5b087f08bea8');
    execute format('create policy %I on public.%I for delete to anon using (organization_id = %L::uuid)', t||'_v1_open_delete', t, '8557a116-8377-44a6-b2f3-5b087f08bea8');
  end loop;
end $$;

grant select, insert, update, delete on public.pcp_import_batches, public.order_portfolio, public.planning_history to authenticated, anon;
grant usage, select on sequence public.order_portfolio_id_seq, public.planning_history_id_seq to authenticated, anon;
