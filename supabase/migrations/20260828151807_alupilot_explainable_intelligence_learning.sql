begin;

create table public.planning_intelligence_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  thermal_weight numeric(6,3) not null default 20,
  resource_weight numeric(6,3) not null default 25,
  material_weight numeric(6,3) not null default 25,
  delivery_weight numeric(6,3) not null default 15,
  flow_weight numeric(6,3) not null default 15,
  minimum_confidence_samples integer not null default 5,
  updated_by_user_id uuid,
  updated_by_name text,
  updated_at timestamptz not null default now(),
  constraint planning_intelligence_weights_nonnegative check (
    thermal_weight >= 0 and resource_weight >= 0 and material_weight >= 0 and delivery_weight >= 0 and flow_weight >= 0
  ),
  constraint planning_intelligence_weights_total check (
    thermal_weight + resource_weight + material_weight + delivery_weight + flow_weight = 100
  ),
  constraint planning_intelligence_min_samples_positive check (minimum_confidence_samples between 1 and 100)
);

insert into public.planning_intelligence_settings (organization_id)
select id from public.organizations on conflict (organization_id) do nothing;

create table public.planning_learning_observations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  execution_history_id uuid not null references public.production_execution_history(id) on delete cascade,
  simulation_version_id uuid references public.simulation_versions(id) on delete set null,
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  process_sheet_id uuid references public.process_sheets(id) on delete set null,
  machine_code text not null,
  tool_code text not null,
  tool_sequence integer,
  predicted_productivity_kg_h numeric(14,3),
  actual_productivity_kg_h numeric(14,3),
  predicted_duration_minutes numeric(14,3),
  actual_duration_minutes numeric(14,3),
  productivity_error_percent numeric(12,4),
  duration_error_percent numeric(12,4),
  prediction_snapshot jsonb not null default '{}'::jsonb,
  actual_snapshot jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  unique (execution_history_id)
);

create index planning_learning_group_idx on public.planning_learning_observations
  (organization_id, tool_code, machine_code, tool_sequence, observed_at desc);
create index planning_learning_version_idx on public.planning_learning_observations
  (simulation_version_id) where simulation_version_id is not null;

create trigger planning_intelligence_settings_updated_at before update on public.planning_intelligence_settings
for each row execute function private.set_updated_at();
create trigger audit_planning_intelligence_settings_trg after insert or update or delete on public.planning_intelligence_settings
for each row execute function public.audit_operational_change();
create trigger audit_planning_learning_observations_trg after insert or update or delete on public.planning_learning_observations
for each row execute function public.audit_operational_change();

alter table public.planning_intelligence_settings enable row level security;
alter table public.planning_learning_observations enable row level security;
revoke all on public.planning_intelligence_settings from public, anon, authenticated;
revoke all on public.planning_learning_observations from public, anon, authenticated;

create or replace function public.normalize_execution_history_tool_code()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select o.tool_code into new.tool_code from public.production_orders o
  where o.id = new.production_order_id and o.organization_id = new.organization_id;
  return new;
end;
$$;
drop trigger if exists normalize_execution_history_tool_code_trg on public.production_execution_history;
create trigger normalize_execution_history_tool_code_trg
before insert or update on public.production_execution_history
for each row execute function public.normalize_execution_history_tool_code();

update public.production_execution_history h set tool_code = o.tool_code
from public.production_orders o
where o.id = h.production_order_id and o.organization_id = h.organization_id
  and h.tool_code is distinct from o.tool_code;

create or replace function public.capture_planning_learning_observation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version_id uuid; v_prediction jsonb; v_predicted_productivity numeric;
  v_predicted_duration numeric; v_actual_duration numeric;
begin
  select v.id, item.value into v_version_id, v_prediction
  from public.simulation_scenarios s
  join public.simulation_versions v on v.scenario_id = s.id
  cross join lateral jsonb_array_elements(coalesce(v.result_snapshot -> 'machines', '[]'::jsonb)) machine
  cross join lateral jsonb_array_elements(coalesce(machine.value -> 'items', '[]'::jsonb)) item
  where s.organization_id = new.organization_id and s.status = 'approved'
    and item.value ->> 'id' = new.production_order_id::text
  order by s.approved_at desc nulls last, v.version_number desc limit 1;

  v_predicted_productivity := nullif(v_prediction ->> 'productivityKgH', '')::numeric;
  if nullif(v_prediction ->> 'startAt', '') is not null and nullif(v_prediction ->> 'endAt', '') is not null then
    v_predicted_duration := extract(epoch from ((v_prediction ->> 'endAt')::timestamptz - (v_prediction ->> 'startAt')::timestamptz)) / 60.0;
  end if;
  if new.started_at is not null and new.completed_at > new.started_at then
    v_actual_duration := extract(epoch from (new.completed_at - new.started_at)) / 60.0;
  end if;

  insert into public.planning_learning_observations (
    organization_id, execution_history_id, simulation_version_id, production_order_id,
    process_sheet_id, machine_code, tool_code, tool_sequence,
    predicted_productivity_kg_h, actual_productivity_kg_h,
    predicted_duration_minutes, actual_duration_minutes,
    productivity_error_percent, duration_error_percent,
    prediction_snapshot, actual_snapshot, observed_at
  ) values (
    new.organization_id, new.id, v_version_id, new.production_order_id,
    new.process_sheet_id, new.machine_code, new.tool_code, new.tool_sequence,
    v_predicted_productivity, new.achieved_productivity_kg_h,
    v_predicted_duration, v_actual_duration,
    case when v_predicted_productivity > 0 and new.achieved_productivity_kg_h is not null
      then round(((new.achieved_productivity_kg_h - v_predicted_productivity) / v_predicted_productivity * 100)::numeric, 4) end,
    case when v_predicted_duration > 0 and v_actual_duration is not null
      then round(((v_actual_duration - v_predicted_duration) / v_predicted_duration * 100)::numeric, 4) end,
    coalesce(v_prediction, '{}'::jsonb), to_jsonb(new), new.completed_at
  ) on conflict (execution_history_id) do update set
    simulation_version_id = excluded.simulation_version_id,
    predicted_productivity_kg_h = excluded.predicted_productivity_kg_h,
    actual_productivity_kg_h = excluded.actual_productivity_kg_h,
    predicted_duration_minutes = excluded.predicted_duration_minutes,
    actual_duration_minutes = excluded.actual_duration_minutes,
    productivity_error_percent = excluded.productivity_error_percent,
    duration_error_percent = excluded.duration_error_percent,
    prediction_snapshot = excluded.prediction_snapshot,
    actual_snapshot = excluded.actual_snapshot,
    observed_at = excluded.observed_at;
  return new;
end;
$$;

drop trigger if exists capture_planning_learning_observation_trg on public.production_execution_history;
create trigger capture_planning_learning_observation_trg
after insert or update of achieved_productivity_kg_h, completed_at on public.production_execution_history
for each row execute function public.capture_planning_learning_observation();

-- Existing executions become the initial learning corpus. They may not have a
-- prediction yet, but already establish actual productivity by setup.
insert into public.planning_learning_observations (
  organization_id, execution_history_id, production_order_id, process_sheet_id,
  machine_code, tool_code, tool_sequence, actual_productivity_kg_h,
  actual_duration_minutes, actual_snapshot, observed_at
)
select h.organization_id, h.id, h.production_order_id, h.process_sheet_id,
  h.machine_code, h.tool_code, h.tool_sequence, h.achieved_productivity_kg_h,
  case when h.started_at is not null and h.completed_at > h.started_at
    then extract(epoch from (h.completed_at - h.started_at)) / 60.0 end,
  to_jsonb(h), h.completed_at
from public.production_execution_history h
on conflict (execution_history_id) do nothing;

create or replace function public.local_get_planning_intelligence(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid; v_org uuid; v_min_samples integer;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  insert into public.planning_intelligence_settings (organization_id) values (v_org)
  on conflict (organization_id) do nothing;
  select minimum_confidence_samples into v_min_samples from public.planning_intelligence_settings where organization_id = v_org;
  return jsonb_build_object(
    'settings', (select jsonb_build_object(
      'thermal', thermal_weight, 'resources', resource_weight, 'material', material_weight,
      'delivery', delivery_weight, 'flow', flow_weight, 'minimumConfidenceSamples', minimum_confidence_samples
    ) from public.planning_intelligence_settings where organization_id = v_org),
    'summary', (select jsonb_build_object(
      'observations', count(*),
      'predictionsCompared', count(*) filter (where predicted_productivity_kg_h is not null and actual_productivity_kg_h is not null),
      'meanAbsoluteErrorPercent', round(coalesce(avg(abs(productivity_error_percent)) filter (where productivity_error_percent is not null), 0), 2),
      'confidencePercent', round(least(95, 20 + count(*) * 8) * (1 - least(coalesce(avg(abs(productivity_error_percent)) filter (where productivity_error_percent is not null), 50), 70) / 100.0), 1)
    ) from public.planning_learning_observations where organization_id = v_org),
    'groups', coalesce((select jsonb_agg(to_jsonb(g) order by g.sample_count desc, g.tool_code) from (
      select tool_code, machine_code, tool_sequence,
        count(*)::integer sample_count,
        round(avg(actual_productivity_kg_h) filter (where actual_productivity_kg_h is not null), 1) average_actual_productivity_kg_h,
        round(avg(predicted_productivity_kg_h) filter (where predicted_productivity_kg_h is not null), 1) average_predicted_productivity_kg_h,
        round(avg(abs(productivity_error_percent)) filter (where productivity_error_percent is not null), 2) mean_absolute_error_percent,
        round(least(95, 20 + count(*) * 10) * (1 - least(coalesce(avg(abs(productivity_error_percent)) filter (where productivity_error_percent is not null), 50), 70) / 100.0), 1) confidence_percent,
        round((array_agg(actual_productivity_kg_h order by observed_at desc) filter (where actual_productivity_kg_h is not null))[1], 1) latest_actual_productivity_kg_h,
        (count(*) >= v_min_samples) calibrated
      from public.planning_learning_observations where organization_id = v_org
      group by tool_code, machine_code, tool_sequence
      having count(*) > 0
      limit 200
    ) g), '[]'::jsonb),
    'recent', coalesce((select jsonb_agg(to_jsonb(r) order by r.observed_at desc) from (
      select id, machine_code, tool_code, tool_sequence, predicted_productivity_kg_h,
        actual_productivity_kg_h, productivity_error_percent, predicted_duration_minutes,
        actual_duration_minutes, observed_at
      from public.planning_learning_observations where organization_id = v_org
      order by observed_at desc limit 50
    ) r), '[]'::jsonb)
  );
end;
$$;

create or replace function public.local_save_planning_intelligence_settings(
  p_token text, p_thermal numeric, p_resources numeric, p_material numeric,
  p_delivery numeric, p_flow numeric, p_minimum_confidence_samples integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid; v_org uuid; v_role text; v_name text;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id, role::text, coalesce(display_name, username)
    into v_org, v_role, v_name from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp') then raise exception 'Perfil sem permissão para alterar os critérios.'; end if;
  if coalesce(p_thermal, 0) + coalesce(p_resources, 0) + coalesce(p_material, 0) + coalesce(p_delivery, 0) + coalesce(p_flow, 0) <> 100 then
    raise exception 'A soma dos pesos deve ser 100%%.';
  end if;
  insert into public.planning_intelligence_settings (
    organization_id, thermal_weight, resource_weight, material_weight,
    delivery_weight, flow_weight, minimum_confidence_samples,
    updated_by_user_id, updated_by_name
  ) values (v_org, p_thermal, p_resources, p_material, p_delivery, p_flow,
    p_minimum_confidence_samples, v_actor, v_name)
  on conflict (organization_id) do update set
    thermal_weight = excluded.thermal_weight, resource_weight = excluded.resource_weight,
    material_weight = excluded.material_weight, delivery_weight = excluded.delivery_weight,
    flow_weight = excluded.flow_weight, minimum_confidence_samples = excluded.minimum_confidence_samples,
    updated_by_user_id = v_actor, updated_by_name = v_name;
end;
$$;

create or replace function public.local_save_simulation_scenario_v2(
  p_token text, p_scenario_id uuid, p_name text, p_description text,
  p_machine_code text, p_mode text, p_requested_start_at timestamptz,
  p_input_snapshot jsonb, p_rules_snapshot jsonb, p_result_snapshot jsonb,
  p_analysis_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid; v_org uuid; v_role text; v_scenario_id uuid; v_version integer;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id, role::text into v_org, v_role from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp') then raise exception 'Somente Administrador ou PCP pode salvar cenários.'; end if;
  if btrim(coalesce(p_name, '')) = '' then raise exception 'Informe o nome do cenário.'; end if;
  if p_mode not in ('fifo', 'optimized', 'manual') then raise exception 'Modo de simulação inválido.'; end if;
  if jsonb_typeof(p_input_snapshot) <> 'object' or jsonb_typeof(p_rules_snapshot) <> 'object' or jsonb_typeof(p_result_snapshot) <> 'object' then raise exception 'Snapshots da simulação inválidos.'; end if;
  if p_scenario_id is null then
    insert into public.simulation_scenarios (organization_id, name, description, requested_start_at, scope, created_by_user_id, updated_by_user_id)
    values (v_org, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_requested_start_at,
      jsonb_build_object('machineCode', p_machine_code), v_actor, v_actor)
    returning id into v_scenario_id;
    v_version := 1;
  else
    select id, current_version + 1 into v_scenario_id, v_version from public.simulation_scenarios
    where id = p_scenario_id and organization_id = v_org for update;
    if v_scenario_id is null then raise exception 'Cenário não encontrado.'; end if;
    update public.simulation_scenarios set name = btrim(p_name), description = nullif(btrim(coalesce(p_description, '')), ''),
      requested_start_at = p_requested_start_at, scope = jsonb_build_object('machineCode', p_machine_code),
      status = 'calculated', approved_at = null, approved_by_user_id = null, applied_at = null,
      updated_by_user_id = v_actor where id = v_scenario_id;
  end if;
  insert into public.simulation_versions (
    organization_id, scenario_id, version_number, model_version, mode,
    requested_start_at, input_snapshot, rules_snapshot, result_snapshot,
    explanation_snapshot, score_snapshot, created_by_user_id
  ) values (
    v_org, v_scenario_id, v_version, coalesce(nullif(p_rules_snapshot ->> 'modelVersion', ''), 'alupilot-v2.0'), p_mode,
    p_requested_start_at, p_input_snapshot, p_rules_snapshot, p_result_snapshot,
    coalesce(p_analysis_snapshot -> 'recommendations', '[]'::jsonb),
    coalesce(p_analysis_snapshot - 'recommendations', '{}'::jsonb), v_actor
  );
  update public.simulation_scenarios set current_version = v_version, status = 'calculated', updated_by_user_id = v_actor where id = v_scenario_id;
  return jsonb_build_object('id', v_scenario_id, 'versionNumber', v_version);
end;
$$;

create or replace function public.local_get_simulation_scenario(
  p_token text, p_scenario_id uuid, p_version_number integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid; v_org uuid; v_result jsonb;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  select jsonb_build_object(
    'scenarioId', s.id, 'name', s.name, 'description', s.description,
    'status', s.status, 'versionNumber', v.version_number, 'modelVersion', v.model_version,
    'mode', v.mode, 'requestedStartAt', v.requested_start_at,
    'inputs', v.input_snapshot, 'rules', v.rules_snapshot, 'result', v.result_snapshot,
    'analysis', case when v.score_snapshot ? 'score' then jsonb_build_object(
      'score', v.score_snapshot -> 'score', 'recommendations', v.explanation_snapshot,
      'summary', coalesce(v.score_snapshot -> 'summary', '{}'::jsonb)
    ) else null end,
    'createdAt', v.created_at
  ) into v_result
  from public.simulation_scenarios s join public.simulation_versions v on v.scenario_id = s.id
  where s.id = p_scenario_id and s.organization_id = v_org
    and v.version_number = coalesce(p_version_number, s.current_version);
  if v_result is null then raise exception 'Cenário de simulação não encontrado.'; end if;
  return v_result;
end;
$$;

create or replace function public.local_approve_simulation_scenario_v2(p_token text, p_scenario_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_org uuid; v_result jsonb;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  select v.result_snapshot into v_result
  from public.simulation_scenarios s join public.simulation_versions v
    on v.scenario_id = s.id and v.version_number = s.current_version
  where s.id = p_scenario_id and s.organization_id = v_org;
  if v_result is null then raise exception 'Cenário não encontrado.'; end if;
  if not coalesce((v_result ->> 'feasible')::boolean, false) then
    raise exception 'O cenário possui impedimentos de recurso e não pode ser aprovado.';
  end if;
  return public.local_approve_simulation_scenario(p_token, p_scenario_id);
end;
$$;

revoke all on function public.local_get_planning_intelligence(text) from public;
revoke all on function public.local_save_planning_intelligence_settings(text, numeric, numeric, numeric, numeric, numeric, integer) from public;
revoke all on function public.local_save_simulation_scenario_v2(text, uuid, text, text, text, text, timestamptz, jsonb, jsonb, jsonb, jsonb) from public;
revoke all on function public.local_get_simulation_scenario(text, uuid, integer) from public;
revoke all on function public.local_approve_simulation_scenario_v2(text, uuid) from public;
grant execute on function public.local_get_planning_intelligence(text) to anon, authenticated;
grant execute on function public.local_save_planning_intelligence_settings(text, numeric, numeric, numeric, numeric, numeric, integer) to anon, authenticated;
grant execute on function public.local_save_simulation_scenario_v2(text, uuid, text, text, text, text, timestamptz, jsonb, jsonb, jsonb, jsonb) to anon, authenticated;
grant execute on function public.local_get_simulation_scenario(text, uuid, integer) to anon, authenticated;
grant execute on function public.local_approve_simulation_scenario_v2(text, uuid) to anon, authenticated;

commit;
