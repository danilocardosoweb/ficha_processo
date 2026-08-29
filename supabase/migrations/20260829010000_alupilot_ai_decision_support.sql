begin;

alter table public.production_orders
  add column if not exists package_measure_mm numeric(10,2),
  add column if not exists carcass_diameter_mm numeric(10,2);

alter table public.production_orders drop constraint if exists production_orders_package_measure_positive;
alter table public.production_orders add constraint production_orders_package_measure_positive
  check (package_measure_mm is null or package_measure_mm > 0);
alter table public.production_orders drop constraint if exists production_orders_carcass_diameter_positive;
alter table public.production_orders add constraint production_orders_carcass_diameter_positive
  check (carcass_diameter_mm is null or carcass_diameter_mm > 0);

comment on column public.production_orders.package_measure_mm is 'Medida do pacote importada da Simplificada; segundo componente da carcaça.';
comment on column public.production_orders.carcass_diameter_mm is 'Diâmetro importado da Simplificada; primeiro componente da carcaça.';

update public.production_orders
set package_measure_mm = coalesce(package_measure_mm,
      nullif(source_data ->> 'medidaPacote', '')::numeric),
    carcass_diameter_mm = coalesce(carcass_diameter_mm,
      nullif(source_data ->> 'diametro', '')::numeric)
where source_data ? 'medidaPacote' or source_data ? 'diametro';

update public.production_orders
set carcass_code = concat(trim_scale(carcass_diameter_mm)::text, 'X', trim_scale(package_measure_mm)::text)
where nullif(btrim(coalesce(carcass_code, '')), '') is null
  and carcass_diameter_mm is not null and package_measure_mm is not null;

create table if not exists public.bo_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  bo_code text not null,
  total_quantity integer not null default 0,
  unavailable_quantity integer not null default 0,
  status text not null default 'available' check (status in ('available','maintenance','blocked','inactive')),
  location text,
  notes text,
  updated_by_user_id uuid,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, bo_code),
  check (btrim(bo_code) <> ''),
  check (total_quantity >= 0 and unavailable_quantity >= 0 and unavailable_quantity <= total_quantity)
);

create index if not exists bo_resources_lookup_idx on public.bo_resources (organization_id, bo_code, status);
drop trigger if exists bo_resources_updated_at on public.bo_resources;
create trigger bo_resources_updated_at before update on public.bo_resources for each row execute function private.set_updated_at();
drop trigger if exists audit_bo_resources_trg on public.bo_resources;
create trigger audit_bo_resources_trg after insert or update or delete on public.bo_resources for each row execute function public.audit_operational_change();
alter table public.bo_resources enable row level security;
revoke all on public.bo_resources from public, anon, authenticated;

alter table public.planning_intelligence_settings
  add column if not exists hole_sequence_weight numeric(6,3) not null default 10,
  add column if not exists short_run_weight numeric(6,3) not null default 15,
  add column if not exists high_hole_threshold integer not null default 4,
  add column if not exists max_consecutive_high_hole_tools integer not null default 2,
  add column if not exists low_volume_threshold_kg numeric(12,2) not null default 300,
  add column if not exists ai_enabled boolean not null default false,
  add column if not exists ai_model_mode text not null default 'auto',
  add column if not exists ai_model text not null default 'openrouter/auto',
  add column if not exists ai_personality_prompt text not null default 'Você é uma analista sênior de PCP e Processos de uma indústria de extrusão de alumínio, com mais de 20 anos de experiência. Analise a programação com rigor industrial, proteja a continuidade das prensas e explique recomendações de forma objetiva, prática e auditável.',
  add column if not exists ai_analysis_criteria text not null default 'Observe cobertura térmica, volume versus produtividade, alternância de ferramentas com muitos furos, disponibilidade compartilhada de carcaças e BOs, material, prazo, trocas de liga e risco de mesa cheia. Nunca invente dados e nunca recomende ignorar um bloqueio físico.',
  add column if not exists ai_max_recommendations integer not null default 6;

alter table public.planning_intelligence_settings drop constraint if exists planning_intelligence_weights_total;
update public.planning_intelligence_settings set
  thermal_weight=15, resource_weight=20, material_weight=20,
  delivery_weight=10, flow_weight=10, hole_sequence_weight=10, short_run_weight=15;
alter table public.planning_intelligence_settings add constraint planning_intelligence_weights_total check (
  thermal_weight + resource_weight + material_weight + delivery_weight + flow_weight + hole_sequence_weight + short_run_weight = 100
);
alter table public.planning_intelligence_settings drop constraint if exists planning_intelligence_hole_threshold_check;
alter table public.planning_intelligence_settings add constraint planning_intelligence_hole_threshold_check
  check (high_hole_threshold between 1 and 100 and max_consecutive_high_hole_tools between 1 and 20);
alter table public.planning_intelligence_settings drop constraint if exists planning_intelligence_low_volume_check;
alter table public.planning_intelligence_settings add constraint planning_intelligence_low_volume_check
  check (low_volume_threshold_kg > 0 and ai_max_recommendations between 1 and 12);
alter table public.planning_intelligence_settings drop constraint if exists planning_intelligence_ai_mode_check;
alter table public.planning_intelligence_settings add constraint planning_intelligence_ai_mode_check
  check (ai_model_mode in ('auto','manual') and btrim(ai_model) <> '');

create table if not exists public.planning_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_hash text not null,
  model_requested text not null,
  model_used text,
  status text not null check (status in ('completed','failed')),
  input_summary jsonb not null default '{}'::jsonb,
  result jsonb,
  usage jsonb not null default '{}'::jsonb,
  duration_ms integer,
  error_message text,
  created_by_user_id uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists planning_ai_analysis_cache_idx on public.planning_ai_analyses (organization_id, request_hash, created_at desc) where status='completed';
drop trigger if exists audit_planning_ai_analyses_trg on public.planning_ai_analyses;
create trigger audit_planning_ai_analyses_trg after insert or update or delete on public.planning_ai_analyses for each row execute function public.audit_operational_change();
alter table public.planning_ai_analyses enable row level security;
revoke all on public.planning_ai_analyses from public, anon, authenticated;

alter table public.simulation_resource_events drop constraint if exists simulation_resource_events_resource_type_check;
alter table public.simulation_resource_events add constraint simulation_resource_events_resource_type_check
  check (resource_type in ('press','oven','tool','billet','alloy','carcass','bo'));
alter table public.resource_unavailability_periods drop constraint if exists resource_unavailability_resource_type_check;
alter table public.resource_unavailability_periods add constraint resource_unavailability_resource_type_check
  check (resource_type in ('press','oven','tool','carcass','bo'));

create or replace function public.local_list_bo_resources(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_org uuid;
begin
  v_actor:=private.require_local_session(p_token,false);
  select organization_id into v_org from private.local_users where id=v_actor;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'boCode',bo_code,'totalQuantity',total_quantity,
    'unavailableQuantity',unavailable_quantity,
    'availableQuantity',case when status='available' then greatest(total_quantity-unavailable_quantity,0) else 0 end,
    'status',status,'location',location,'notes',notes,'updatedAt',updated_at
  ) order by bo_code) from public.bo_resources where organization_id=v_org),'[]'::jsonb);
end; $$;

create or replace function public.local_upsert_bo_resource(
  p_token text,p_id uuid,p_bo_code text,p_total_quantity integer,p_unavailable_quantity integer,
  p_status text,p_location text,p_notes text
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_org uuid; v_role text; v_name text; v_id uuid;
begin
  v_actor:=private.require_local_session(p_token,false);
  select organization_id,role::text,coalesce(display_name,username) into v_org,v_role,v_name from private.local_users where id=v_actor;
  if v_role not in ('admin','manager','pcp') then raise exception 'Perfil sem permissão para alterar BOs.' using errcode='42501'; end if;
  if btrim(coalesce(p_bo_code,''))='' then raise exception 'Informe o BO.'; end if;
  if p_status not in ('available','maintenance','blocked','inactive') then raise exception 'Status inválido.'; end if;
  if p_total_quantity<0 or p_unavailable_quantity<0 or p_unavailable_quantity>p_total_quantity then raise exception 'Quantidades inválidas.'; end if;
  if p_id is null then
    insert into public.bo_resources(organization_id,bo_code,total_quantity,unavailable_quantity,status,location,notes,updated_by_user_id,updated_by_name)
    values(v_org,upper(btrim(p_bo_code)),p_total_quantity,p_unavailable_quantity,p_status,nullif(btrim(coalesce(p_location,'')),''),nullif(btrim(coalesce(p_notes,'')),''),v_actor,v_name)
    on conflict(organization_id,bo_code) do update set total_quantity=excluded.total_quantity,unavailable_quantity=excluded.unavailable_quantity,status=excluded.status,location=excluded.location,notes=excluded.notes,updated_by_user_id=v_actor,updated_by_name=v_name
    returning id into v_id;
  else
    update public.bo_resources set bo_code=upper(btrim(p_bo_code)),total_quantity=p_total_quantity,unavailable_quantity=p_unavailable_quantity,status=p_status,location=nullif(btrim(coalesce(p_location,'')),''),notes=nullif(btrim(coalesce(p_notes,'')),''),updated_by_user_id=v_actor,updated_by_name=v_name
    where id=p_id and organization_id=v_org returning id into v_id;
    if v_id is null then raise exception 'BO não encontrado.'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.local_get_planning_intelligence(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_org uuid; v_min_samples integer;
begin
  v_actor:=private.require_local_session(p_token,false);
  select organization_id into v_org from private.local_users where id=v_actor;
  insert into public.planning_intelligence_settings(organization_id) values(v_org) on conflict(organization_id) do nothing;
  select minimum_confidence_samples into v_min_samples from public.planning_intelligence_settings where organization_id=v_org;
  return jsonb_build_object(
    'settings',(select jsonb_build_object(
      'thermal',thermal_weight,'resources',resource_weight,'material',material_weight,'delivery',delivery_weight,'flow',flow_weight,
      'holeSequence',hole_sequence_weight,'shortRun',short_run_weight,'minimumConfidenceSamples',minimum_confidence_samples,
      'highHoleThreshold',high_hole_threshold,'maxConsecutiveHighHoleTools',max_consecutive_high_hole_tools,'lowVolumeThresholdKg',low_volume_threshold_kg,
      'aiEnabled',ai_enabled,'aiModelMode',ai_model_mode,'aiModel',ai_model,'aiPersonalityPrompt',ai_personality_prompt,
      'aiAnalysisCriteria',ai_analysis_criteria,'aiMaxRecommendations',ai_max_recommendations
    ) from public.planning_intelligence_settings where organization_id=v_org),
    'summary',(select jsonb_build_object('observations',count(*),'predictionsCompared',count(*) filter(where predicted_productivity_kg_h is not null and actual_productivity_kg_h is not null),'meanAbsoluteErrorPercent',round(coalesce(avg(abs(productivity_error_percent)) filter(where productivity_error_percent is not null),0),2),'confidencePercent',round(least(95,20+count(*)*8)*(1-least(coalesce(avg(abs(productivity_error_percent)) filter(where productivity_error_percent is not null),50),70)/100.0),1)) from public.planning_learning_observations where organization_id=v_org),
    'groups',coalesce((select jsonb_agg(to_jsonb(g) order by g.sample_count desc,g.tool_code) from (select tool_code,machine_code,tool_sequence,count(*)::integer sample_count,round(avg(actual_productivity_kg_h) filter(where actual_productivity_kg_h is not null),1) average_actual_productivity_kg_h,round(avg(predicted_productivity_kg_h) filter(where predicted_productivity_kg_h is not null),1) average_predicted_productivity_kg_h,round(avg(abs(productivity_error_percent)) filter(where productivity_error_percent is not null),2) mean_absolute_error_percent,round(least(95,20+count(*)*10)*(1-least(coalesce(avg(abs(productivity_error_percent)) filter(where productivity_error_percent is not null),50),70)/100.0),1) confidence_percent,round((array_agg(actual_productivity_kg_h order by observed_at desc) filter(where actual_productivity_kg_h is not null))[1],1) latest_actual_productivity_kg_h,(count(*)>=v_min_samples) calibrated from public.planning_learning_observations where organization_id=v_org group by tool_code,machine_code,tool_sequence having count(*)>0 limit 200) g),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(to_jsonb(r) order by r.observed_at desc) from (select id,machine_code,tool_code,tool_sequence,predicted_productivity_kg_h,actual_productivity_kg_h,productivity_error_percent,predicted_duration_minutes,actual_duration_minutes,observed_at from public.planning_learning_observations where organization_id=v_org order by observed_at desc limit 50) r),'[]'::jsonb)
  );
end; $$;

create or replace function public.local_save_planning_intelligence_settings_v2(
  p_token text,p_thermal numeric,p_resources numeric,p_material numeric,p_delivery numeric,p_flow numeric,p_hole_sequence numeric,p_short_run numeric,
  p_minimum_confidence_samples integer,p_high_hole_threshold integer,p_max_consecutive_high_hole_tools integer,p_low_volume_threshold_kg numeric,
  p_ai_enabled boolean,p_ai_model_mode text,p_ai_model text,p_ai_personality_prompt text,p_ai_analysis_criteria text,p_ai_max_recommendations integer
) returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_org uuid; v_role text; v_name text;
begin
  v_actor:=private.require_local_session(p_token,false);
  select organization_id,role::text,coalesce(display_name,username) into v_org,v_role,v_name from private.local_users where id=v_actor;
  if v_role not in ('admin','manager','pcp') then raise exception 'Perfil sem permissão para alterar os critérios.' using errcode='42501'; end if;
  if coalesce(p_thermal,0)+coalesce(p_resources,0)+coalesce(p_material,0)+coalesce(p_delivery,0)+coalesce(p_flow,0)+coalesce(p_hole_sequence,0)+coalesce(p_short_run,0)<>100 then raise exception 'A soma dos pesos deve ser 100%%.'; end if;
  if p_ai_model_mode not in ('auto','manual') or btrim(coalesce(p_ai_model,''))='' then raise exception 'Modelo de IA inválido.'; end if;
  insert into public.planning_intelligence_settings(organization_id,thermal_weight,resource_weight,material_weight,delivery_weight,flow_weight,hole_sequence_weight,short_run_weight,minimum_confidence_samples,high_hole_threshold,max_consecutive_high_hole_tools,low_volume_threshold_kg,ai_enabled,ai_model_mode,ai_model,ai_personality_prompt,ai_analysis_criteria,ai_max_recommendations,updated_by_user_id,updated_by_name)
  values(v_org,p_thermal,p_resources,p_material,p_delivery,p_flow,p_hole_sequence,p_short_run,p_minimum_confidence_samples,p_high_hole_threshold,p_max_consecutive_high_hole_tools,p_low_volume_threshold_kg,coalesce(p_ai_enabled,false),p_ai_model_mode,btrim(p_ai_model),btrim(p_ai_personality_prompt),btrim(p_ai_analysis_criteria),p_ai_max_recommendations,v_actor,v_name)
  on conflict(organization_id) do update set thermal_weight=excluded.thermal_weight,resource_weight=excluded.resource_weight,material_weight=excluded.material_weight,delivery_weight=excluded.delivery_weight,flow_weight=excluded.flow_weight,hole_sequence_weight=excluded.hole_sequence_weight,short_run_weight=excluded.short_run_weight,minimum_confidence_samples=excluded.minimum_confidence_samples,high_hole_threshold=excluded.high_hole_threshold,max_consecutive_high_hole_tools=excluded.max_consecutive_high_hole_tools,low_volume_threshold_kg=excluded.low_volume_threshold_kg,ai_enabled=excluded.ai_enabled,ai_model_mode=excluded.ai_model_mode,ai_model=excluded.ai_model,ai_personality_prompt=excluded.ai_personality_prompt,ai_analysis_criteria=excluded.ai_analysis_criteria,ai_max_recommendations=excluded.ai_max_recommendations,updated_by_user_id=v_actor,updated_by_name=v_name;
end; $$;

create or replace function public.local_get_cached_planning_ai_analysis(p_token text,p_request_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_org uuid;
begin
  v_actor:=private.require_local_session(p_token,false); select organization_id into v_org from private.local_users where id=v_actor;
  return (select jsonb_build_object('result',result,'modelUsed',model_used,'usage',usage,'durationMs',duration_ms,'createdAt',created_at,'cached',true) from public.planning_ai_analyses where organization_id=v_org and request_hash=p_request_hash and status='completed' and created_at>now()-interval '30 minutes' order by created_at desc limit 1);
end; $$;

create or replace function public.local_save_planning_ai_analysis(p_token text,p_request_hash text,p_model_requested text,p_model_used text,p_status text,p_input_summary jsonb,p_result jsonb,p_usage jsonb,p_duration_ms integer,p_error_message text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_org uuid; v_name text; v_id uuid;
begin
  v_actor:=private.require_local_session(p_token,false); select organization_id,coalesce(display_name,username) into v_org,v_name from private.local_users where id=v_actor;
  if p_status not in ('completed','failed') then raise exception 'Status inválido.'; end if;
  insert into public.planning_ai_analyses(organization_id,request_hash,model_requested,model_used,status,input_summary,result,usage,duration_ms,error_message,created_by_user_id,created_by_name)
  values(v_org,p_request_hash,p_model_requested,p_model_used,p_status,coalesce(p_input_summary,'{}'::jsonb),p_result,coalesce(p_usage,'{}'::jsonb),p_duration_ms,left(p_error_message,1000),v_actor,v_name) returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.local_list_bo_resources(text) from public;
revoke all on function public.local_upsert_bo_resource(text,uuid,text,integer,integer,text,text,text) from public;
revoke all on function public.local_save_planning_intelligence_settings_v2(text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,integer,integer,integer,numeric,boolean,text,text,text,text,integer) from public;
revoke all on function public.local_get_cached_planning_ai_analysis(text,text) from public;
revoke all on function public.local_save_planning_ai_analysis(text,text,text,text,text,jsonb,jsonb,jsonb,integer,text) from public;
grant execute on function public.local_list_bo_resources(text) to anon,authenticated;
grant execute on function public.local_upsert_bo_resource(text,uuid,text,integer,integer,text,text,text) to anon,authenticated;
grant execute on function public.local_save_planning_intelligence_settings_v2(text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,integer,integer,integer,numeric,boolean,text,text,text,text,integer) to anon,authenticated;
grant execute on function public.local_get_cached_planning_ai_analysis(text,text) to anon,authenticated;
grant execute on function public.local_save_planning_ai_analysis(text,text,text,text,text,jsonb,jsonb,jsonb,integer,text) to anon,authenticated;

commit;
