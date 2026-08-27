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

revoke all on public.simulation_scenarios from public, anon;
revoke all on public.simulation_versions from public, anon;
revoke all on public.simulation_version_items from public, anon;
revoke all on public.simulation_resource_events from public, anon;
revoke all on public.simulation_scenarios from authenticated;
revoke all on public.simulation_versions from authenticated;
revoke all on public.simulation_version_items from authenticated;
revoke all on public.simulation_resource_events from authenticated;

-- The application uses its own opaque local session, not Supabase Auth. All
-- access therefore goes through token-aware RPCs and the tables remain closed.
create or replace function public.local_list_simulation_scenarios(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'name', s.name,
      'description', s.description,
      'status', s.status,
      'scope', s.scope,
      'currentVersion', s.current_version,
      'requestedStartAt', s.requested_start_at,
      'createdAt', s.created_at,
      'updatedAt', s.updated_at,
      'createdBy', coalesce(u.full_name, u.username)
    ) order by s.updated_at desc)
    from public.simulation_scenarios s
    left join private.local_users u on u.id = s.created_by_user_id
    where s.organization_id = v_org
      and s.status <> 'archived'
  ), '[]'::jsonb);
end;
$$;

create or replace function public.local_get_simulation_scenario(
  p_token text,
  p_scenario_id uuid,
  p_version_number integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_result jsonb;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;

  select jsonb_build_object(
    'scenarioId', s.id,
    'name', s.name,
    'description', s.description,
    'status', s.status,
    'versionNumber', v.version_number,
    'modelVersion', v.model_version,
    'mode', v.mode,
    'requestedStartAt', v.requested_start_at,
    'inputs', v.input_snapshot,
    'rules', v.rules_snapshot,
    'result', v.result_snapshot,
    'createdAt', v.created_at
  ) into v_result
  from public.simulation_scenarios s
  join public.simulation_versions v on v.scenario_id = s.id
  where s.id = p_scenario_id
    and s.organization_id = v_org
    and v.version_number = coalesce(p_version_number, s.current_version);

  if v_result is null then
    raise exception 'Cenário de simulação não encontrado.';
  end if;
  return v_result;
end;
$$;

create or replace function public.local_save_simulation_scenario(
  p_token text,
  p_scenario_id uuid,
  p_name text,
  p_description text,
  p_machine_code text,
  p_mode text,
  p_requested_start_at timestamptz,
  p_input_snapshot jsonb,
  p_rules_snapshot jsonb,
  p_result_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_role text;
  v_scenario_id uuid;
  v_version integer;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id, role into v_org, v_role from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp') then
    raise exception 'Somente Administrador ou PCP pode salvar cenários.';
  end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Informe o nome do cenário.'; end if;
  if p_mode not in ('fifo', 'optimized', 'manual') then raise exception 'Modo de simulação inválido.'; end if;
  if jsonb_typeof(p_input_snapshot) <> 'object' or jsonb_typeof(p_rules_snapshot) <> 'object' or jsonb_typeof(p_result_snapshot) <> 'object' then
    raise exception 'Snapshots da simulação inválidos.';
  end if;

  if p_scenario_id is null then
    insert into public.simulation_scenarios (
      organization_id, name, description, requested_start_at, scope,
      created_by_user_id, updated_by_user_id
    ) values (
      v_org, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''),
      p_requested_start_at, jsonb_build_object('machineCode', p_machine_code), v_actor, v_actor
    ) returning id into v_scenario_id;
    v_version := 1;
  else
    select id, current_version + 1 into v_scenario_id, v_version
    from public.simulation_scenarios
    where id = p_scenario_id and organization_id = v_org
    for update;
    if v_scenario_id is null then raise exception 'Cenário não encontrado.'; end if;
    update public.simulation_scenarios set
      name = btrim(p_name),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      requested_start_at = p_requested_start_at,
      scope = jsonb_build_object('machineCode', p_machine_code),
      updated_by_user_id = v_actor
    where id = v_scenario_id;
  end if;

  insert into public.simulation_versions (
    organization_id, scenario_id, version_number, model_version, mode,
    requested_start_at, input_snapshot, rules_snapshot, result_snapshot,
    created_by_user_id
  ) values (
    v_org, v_scenario_id, v_version, 'alupilot-v1', p_mode,
    p_requested_start_at, p_input_snapshot, p_rules_snapshot, p_result_snapshot, v_actor
  );

  update public.simulation_scenarios
  set current_version = v_version, status = 'calculated', updated_by_user_id = v_actor
  where id = v_scenario_id;

  return jsonb_build_object('id', v_scenario_id, 'versionNumber', v_version);
end;
$$;

revoke all on function public.local_list_simulation_scenarios(text) from public;
revoke all on function public.local_get_simulation_scenario(text, uuid, integer) from public;
revoke all on function public.local_save_simulation_scenario(text, uuid, text, text, text, text, timestamptz, jsonb, jsonb, jsonb) from public;
grant execute on function public.local_list_simulation_scenarios(text) to anon, authenticated;
grant execute on function public.local_get_simulation_scenario(text, uuid, integer) to anon, authenticated;
grant execute on function public.local_save_simulation_scenario(text, uuid, text, text, text, text, timestamptz, jsonb, jsonb, jsonb) to anon, authenticated;
