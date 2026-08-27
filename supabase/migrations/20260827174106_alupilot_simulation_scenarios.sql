-- Persistent and auditable foundation for the AluPilot simulation engine.
-- This migration stores immutable snapshots. It does not change the current
-- production calculation or expose local-auth data directly to anon clients.

create table public.simulation_scenarios (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft'
    check (status in ('draft', 'calculated', 'approved', 'archived')),
  requested_start_at timestamptz not null,
  scope jsonb not null default '{}'::jsonb,
  current_version integer not null default 0 check (current_version >= 0),
  created_by_user_id uuid,
  updated_by_user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint simulation_scenarios_name_not_blank check (btrim(name) <> '')
);

create table public.simulation_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scenario_id uuid not null references public.simulation_scenarios(id) on delete cascade,
  version_number integer not null check (version_number > 0),
  model_version text not null,
  mode text not null check (mode in ('fifo', 'optimized', 'manual')),
  requested_start_at timestamptz not null,
  input_snapshot jsonb not null,
  rules_snapshot jsonb not null,
  result_snapshot jsonb not null,
  explanation_snapshot jsonb not null default '[]'::jsonb,
  score_snapshot jsonb not null default '{}'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  unique (scenario_id, version_number)
);

create table public.simulation_version_items (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  simulation_version_id uuid not null references public.simulation_versions(id) on delete cascade,
  production_order_id uuid references public.production_orders(id) on delete set null,
  position integer not null check (position > 0),
  press_code text not null,
  tool_code text not null,
  tool_sequence integer,
  oven_code text,
  oven_position integer,
  alloy_code text not null,
  alternative_alloys text[] not null default '{}',
  carcass_code text,
  holes integer check (holes is null or holes > 0),
  bo_code text,
  target_kg numeric(14,3) not null check (target_kg >= 0),
  remaining_kg numeric(14,3) not null check (remaining_kg >= 0),
  productivity_kg_h numeric(14,3) not null check (productivity_kg_h > 0),
  planned_start_at timestamptz,
  planned_end_at timestamptz,
  resource_snapshot jsonb not null default '{}'::jsonb,
  calculation_snapshot jsonb not null default '{}'::jsonb,
  unique (simulation_version_id, press_code, position)
);

create table public.simulation_resource_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  simulation_version_id uuid not null references public.simulation_versions(id) on delete cascade,
  simulation_item_id bigint references public.simulation_version_items(id) on delete cascade,
  resource_type text not null
    check (resource_type in ('press', 'oven', 'tool', 'billet', 'alloy', 'carcass')),
  resource_code text not null,
  event_type text not null,
  starts_at timestamptz,
  ends_at timestamptz,
  quantity numeric(16,4),
  unit text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint simulation_resource_event_period check (
    starts_at is null or ends_at is null or ends_at >= starts_at
  )
);

create index simulation_scenarios_org_updated_idx
  on public.simulation_scenarios (organization_id, updated_at desc);
create index simulation_versions_scenario_idx
  on public.simulation_versions (scenario_id, version_number desc);
create index simulation_version_items_resource_idx
  on public.simulation_version_items (simulation_version_id, press_code, position);
create index simulation_resource_events_timeline_idx
  on public.simulation_resource_events (simulation_version_id, resource_type, starts_at);

create trigger simulation_scenarios_updated_at
before update on public.simulation_scenarios
for each row execute function private.set_updated_at();

alter table public.simulation_scenarios enable row level security;
alter table public.simulation_versions enable row level security;
alter table public.simulation_version_items enable row level security;
alter table public.simulation_resource_events enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'simulation_scenarios',
    'simulation_versions',
    'simulation_version_items',
    'simulation_resource_events'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (organization_id in (select private.authorized_org_ids()))',
      table_name || '_select', table_name
    );
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (organization_id in (select private.authorized_org_ids()))',
      table_name || '_insert', table_name
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (organization_id in (select private.authorized_org_ids())) with check (organization_id in (select private.authorized_org_ids()))',
      table_name || '_update', table_name
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (organization_id in (select private.authorized_org_ids()))',
      table_name || '_delete', table_name
    );
  end loop;
end $$;

revoke all on public.simulation_scenarios from public, anon;
revoke all on public.simulation_versions from public, anon;
revoke all on public.simulation_version_items from public, anon;
revoke all on public.simulation_resource_events from public, anon;

grant select, insert, update, delete on public.simulation_scenarios to authenticated;
grant select, insert, update, delete on public.simulation_versions to authenticated;
grant select, insert, update, delete on public.simulation_version_items to authenticated;
grant select, insert, update, delete on public.simulation_resource_events to authenticated;
grant usage, select on sequence public.simulation_version_items_id_seq to authenticated;
grant usage, select on sequence public.simulation_resource_events_id_seq to authenticated;
