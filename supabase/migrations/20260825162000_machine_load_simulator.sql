alter table public.production_orders
  add column if not exists last_productivity_kg_h numeric(14,3);

alter table public.production_orders
  drop constraint if exists production_orders_last_productivity_positive;
alter table public.production_orders
  add constraint production_orders_last_productivity_positive
  check (last_productivity_kg_h is null or last_productivity_kg_h > 0);

create index if not exists production_orders_machine_load_idx
  on public.production_orders (organization_id, machine_code, sequence)
  where is_active = true and status in ('planned', 'released', 'in_progress', 'paused');

create table if not exists public.machine_load_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  machine_code text not null,
  billet_bar_weight_kg numeric(10,3) not null default 415,
  extrusion_efficiency numeric(6,5) not null default 0.85,
  default_productivity_kg_h numeric(12,3) not null default 1000,
  setup_minutes integer not null default 20,
  alloy_change_minutes integer not null default 15,
  tool_heating_minutes integer not null default 240,
  updated_at timestamptz not null default now(),
  primary key (organization_id, machine_code),
  constraint machine_load_bar_weight_positive check (billet_bar_weight_kg > 0),
  constraint machine_load_efficiency_range check (extrusion_efficiency > 0 and extrusion_efficiency <= 1),
  constraint machine_load_productivity_positive check (default_productivity_kg_h > 0),
  constraint machine_load_nonnegative_times check (setup_minutes >= 0 and alloy_change_minutes >= 0 and tool_heating_minutes >= 0)
);

create table if not exists public.tool_alloy_options (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tool_code text not null,
  alloy_code text not null,
  priority smallint not null default 1,
  is_primary boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, tool_code, alloy_code),
  constraint tool_alloy_priority_positive check (priority > 0)
);

create index if not exists tool_alloy_options_lookup_idx
  on public.tool_alloy_options (organization_id, upper(tool_code), priority)
  where is_active = true;

alter table public.machine_load_settings enable row level security;
alter table public.tool_alloy_options enable row level security;

drop policy if exists machine_load_settings_read on public.machine_load_settings;
create policy machine_load_settings_read on public.machine_load_settings
  for select to anon, authenticated using (true);
drop policy if exists machine_load_settings_write on public.machine_load_settings;
create policy machine_load_settings_write on public.machine_load_settings
  for all to anon, authenticated using (true) with check (true);

drop policy if exists tool_alloy_options_read on public.tool_alloy_options;
create policy tool_alloy_options_read on public.tool_alloy_options
  for select to anon, authenticated using (true);
drop policy if exists tool_alloy_options_write on public.tool_alloy_options;
create policy tool_alloy_options_write on public.tool_alloy_options
  for all to anon, authenticated using (true) with check (true);

grant select, insert, update, delete on public.machine_load_settings to anon, authenticated;
grant select, insert, update, delete on public.tool_alloy_options to anon, authenticated;
grant usage, select on sequence public.tool_alloy_options_id_seq to anon, authenticated;
