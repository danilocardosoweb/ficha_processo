-- AlumMES V1 - schema inicial multiempresa.
create extension if not exists pgcrypto;
create schema if not exists private;

create type public.member_role as enum ('owner','admin','pcp','supervisor','operator','engineering','maintenance','quality','viewer');
create type public.order_status as enum ('planned','released','in_progress','paused','completed','cancelled');
create type public.event_type as enum ('start','pause','resume','production','scrap','stop','complete');
create type public.work_order_status as enum ('open','in_progress','waiting','completed','cancelled');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.member_role not null default 'viewer',
  display_name text,
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);

create or replace function private.authorized_org_ids()
returns setof uuid language sql stable security definer
set search_path = ''
as $$ select om.organization_id from public.organization_members om where om.user_id = (select auth.uid()) $$;
revoke all on function private.authorized_org_ids() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.authorized_org_ids() to authenticated;

create table public.plants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now(),
  unique (organization_id,code)
);

create table public.machines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plant_id uuid references public.plants(id) on delete set null,
  code text not null,
  name text not null,
  capacity_tons integer,
  is_active boolean not null default true,
  connectivity_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,code)
);

create table public.tools (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  description text,
  lifecycle_kg numeric(14,3) not null default 0,
  status text not null default 'available',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,code)
);

create table public.simplified_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  file_name text not null,
  file_hash text,
  row_count integer not null default 0 check (row_count >= 0),
  status text not null default 'pending' check (status in ('pending','processing','processed','failed')),
  error_details jsonb,
  imported_by uuid references auth.users(id),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.production_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_batch_id uuid references public.simplified_imports(id) on delete set null,
  order_number text not null,
  plan_code text,
  machine_code text not null,
  tool_code text not null,
  product_code text,
  product_description text,
  customer_name text,
  alloy_code text not null,
  temper text,
  target_kg numeric(14,3) not null check (target_kg > 0),
  produced_kg numeric(14,3) not null default 0 check (produced_kg >= 0),
  target_quantity integer check (target_quantity > 0),
  due_date date,
  sequence integer not null default 0 check (sequence >= 0),
  status public.order_status not null default 'planned',
  scheduled_start timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  notes text,
  source_data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,order_number)
);
create index production_orders_schedule_idx on public.production_orders (organization_id,machine_code,status,due_date,sequence);

create table public.order_status_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  from_status public.order_status,
  to_status public.order_status not null,
  changed_by uuid references auth.users(id),
  reason text,
  created_at timestamptz not null default now()
);

create table public.production_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  machine_code text not null,
  type public.event_type not null,
  quantity_kg numeric(14,3),
  quantity_pieces integer,
  reason_code text,
  notes text,
  occurred_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id),
  source text not null default 'manual' check (source in ('manual','import','integration')),
  external_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index production_events_external_id_idx on public.production_events (organization_id,external_id) where external_id is not null;

create table public.process_sheets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  machine_code text,
  tool_code text not null,
  product_code text,
  alloy_code text not null,
  revision integer not null default 1,
  parameters jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  approved_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id,tool_code,alloy_code,revision)
);
create index process_sheets_lookup_idx on public.process_sheets (organization_id,tool_code,product_code,alloy_code,is_active);

create table public.quality_inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  result text not null check (result in ('pending','approved','rejected','conditional')),
  measurements jsonb not null default '{}'::jsonb,
  notes text,
  inspected_by uuid references auth.users(id),
  inspected_at timestamptz not null default now()
);

create table public.maintenance_work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  machine_code text,
  tool_code text,
  production_order_id uuid references public.production_orders(id) on delete set null,
  title text not null,
  description text,
  priority text not null default 'normal' check (priority in ('low','normal','high','critical')),
  status public.work_order_status not null default 'open',
  opened_by uuid references auth.users(id),
  assigned_to uuid references auth.users(id),
  opened_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Porta transacional para futuras integracoes (CLP, ERP e outros), sem protocolo de CLP nesta fase.
create table public.integration_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_name text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end $$;
create trigger machines_updated_at before update on public.machines for each row execute function private.set_updated_at();
create trigger tools_updated_at before update on public.tools for each row execute function private.set_updated_at();
create trigger orders_updated_at before update on public.production_orders for each row execute function private.set_updated_at();
create trigger process_sheets_updated_at before update on public.process_sheets for each row execute function private.set_updated_at();
create trigger maintenance_updated_at before update on public.maintenance_work_orders for each row execute function private.set_updated_at();

-- Todas as tabelas expostas usam RLS e isolamento por organizacao.
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.plants enable row level security;
alter table public.machines enable row level security;
alter table public.tools enable row level security;
alter table public.simplified_imports enable row level security;
alter table public.production_orders enable row level security;
alter table public.order_status_history enable row level security;
alter table public.production_events enable row level security;
alter table public.process_sheets enable row level security;
alter table public.quality_inspections enable row level security;
alter table public.maintenance_work_orders enable row level security;
alter table public.integration_outbox enable row level security;

create policy organizations_select on public.organizations for select to authenticated using (id in (select private.authorized_org_ids()));
create policy members_select on public.organization_members for select to authenticated using (organization_id in (select private.authorized_org_ids()));

do $$ declare t text; begin
  foreach t in array array['plants','machines','tools','simplified_imports','production_orders','order_status_history','production_events','process_sheets','quality_inspections','maintenance_work_orders']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (organization_id in (select private.authorized_org_ids()))',t||'_select',t);
    execute format('create policy %I on public.%I for insert to authenticated with check (organization_id in (select private.authorized_org_ids()))',t||'_insert',t);
    execute format('create policy %I on public.%I for update to authenticated using (organization_id in (select private.authorized_org_ids())) with check (organization_id in (select private.authorized_org_ids()))',t||'_update',t);
    execute format('create policy %I on public.%I for delete to authenticated using (organization_id in (select private.authorized_org_ids()))',t||'_delete',t);
  end loop;
end $$;

-- Outbox e associacoes sao administradas apenas por backend confiavel; sem policies de escrita via cliente.
create policy integration_outbox_select on public.integration_outbox for select to authenticated using (organization_id in (select private.authorized_org_ids()));

grant select on public.organizations, public.organization_members to authenticated;
grant select,insert,update,delete on public.plants,public.machines,public.tools,public.simplified_imports,public.production_orders,public.order_status_history,public.production_events,public.process_sheets,public.quality_inspections,public.maintenance_work_orders to authenticated;
grant select on public.integration_outbox to authenticated;
grant usage,select on all sequences in schema public to authenticated;

-- V1 sem login: acesso aberto e limitado a organizacao unica configurada no app.
-- Nao usar estas policies em uma implantacao publica sem adicionar um controle de acesso externo.
create policy organizations_v1_open_select on public.organizations
for select to anon using (id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);

do $$ declare t text; begin
  foreach t in array array['plants','machines','tools','simplified_imports','production_orders','order_status_history','production_events','process_sheets','quality_inspections','maintenance_work_orders']
  loop
    execute format('create policy %I on public.%I for select to anon using (organization_id = %L::uuid)',t||'_v1_open_select',t,'8557a116-8377-44a6-b2f3-5b087f08bea8');
    execute format('create policy %I on public.%I for insert to anon with check (organization_id = %L::uuid)',t||'_v1_open_insert',t,'8557a116-8377-44a6-b2f3-5b087f08bea8');
    execute format('create policy %I on public.%I for update to anon using (organization_id = %L::uuid) with check (organization_id = %L::uuid)',t||'_v1_open_update',t,'8557a116-8377-44a6-b2f3-5b087f08bea8','8557a116-8377-44a6-b2f3-5b087f08bea8');
    execute format('create policy %I on public.%I for delete to anon using (organization_id = %L::uuid)',t||'_v1_open_delete',t,'8557a116-8377-44a6-b2f3-5b087f08bea8');
  end loop;
end $$;

grant select on public.organizations to anon;
grant select,insert,update,delete on public.plants,public.machines,public.tools,public.simplified_imports,public.production_orders,public.order_status_history,public.production_events,public.process_sheets,public.quality_inspections,public.maintenance_work_orders to anon;
grant usage,select on all sequences in schema public to anon;
