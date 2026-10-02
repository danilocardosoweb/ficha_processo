-- Camada de IA versionada: fornecedor, consentimento de envio e proveniência.
-- Chaves continuam exclusivamente nas variáveis de ambiente do servidor.
begin;

alter table public.planning_intelligence_settings
  add column if not exists ai_provider text not null default 'openrouter',
  add column if not exists ai_provider_endpoint text not null default '',
  add column if not exists ai_external_data_enabled boolean not null default true;

alter table public.planning_intelligence_settings
  drop constraint if exists planning_intelligence_ai_provider_check;
alter table public.planning_intelligence_settings
  add constraint planning_intelligence_ai_provider_check
  check (ai_provider in ('openrouter','lmstudio','openai','openclaw'));
alter table public.planning_intelligence_settings
  drop constraint if exists planning_intelligence_ai_provider_endpoint_check;
alter table public.planning_intelligence_settings
  add constraint planning_intelligence_ai_provider_endpoint_check
  check (ai_provider_endpoint = '' or ai_provider_endpoint ~ '^https?://[^[:space:]]+$');

alter table public.planning_ai_analyses
  add column if not exists contract jsonb not null default '{}'::jsonb,
  add column if not exists validation jsonb not null default '{}'::jsonb;

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
      'aiEnabled',ai_enabled,'aiProvider',ai_provider,'aiProviderEndpoint',ai_provider_endpoint,'aiExternalDataEnabled',ai_external_data_enabled,
      'aiModelMode',ai_model_mode,'aiModel',ai_model,'aiPersonalityPrompt',ai_personality_prompt,
      'aiAnalysisCriteria',ai_analysis_criteria,'aiMaxRecommendations',ai_max_recommendations
    ) from public.planning_intelligence_settings where organization_id=v_org),
    'summary',(select jsonb_build_object('observations',count(*),'predictionsCompared',count(*) filter(where predicted_productivity_kg_h is not null and actual_productivity_kg_h is not null),'meanAbsoluteErrorPercent',round(coalesce(avg(abs(productivity_error_percent)) filter(where productivity_error_percent is not null),0),2),'confidencePercent',round(least(95,20+count(*)*8)*(1-least(coalesce(avg(abs(productivity_error_percent)) filter(where productivity_error_percent is not null),50),70)/100.0),1)) from public.planning_learning_observations where organization_id=v_org),
    'groups',coalesce((select jsonb_agg(to_jsonb(g) order by g.sample_count desc,g.tool_code) from (select tool_code,machine_code,tool_sequence,count(*)::integer sample_count,round(avg(actual_productivity_kg_h) filter(where actual_productivity_kg_h is not null),1) average_actual_productivity_kg_h,round(avg(predicted_productivity_kg_h) filter(where predicted_productivity_kg_h is not null),1) average_predicted_productivity_kg_h,round(avg(abs(productivity_error_percent)) filter(where productivity_error_percent is not null),2) mean_absolute_error_percent,round(least(95,20+count(*)*10)*(1-least(coalesce(avg(abs(productivity_error_percent)) filter(where productivity_error_percent is not null),50),70)/100.0),1) confidence_percent,round((array_agg(actual_productivity_kg_h order by observed_at desc) filter(where actual_productivity_kg_h is not null))[1],1) latest_actual_productivity_kg_h,(count(*)>=v_min_samples) calibrated from public.planning_learning_observations where organization_id=v_org group by tool_code,machine_code,tool_sequence having count(*)>0 limit 200) g),'[]'::jsonb),
    'recent',coalesce((select jsonb_agg(to_jsonb(r) order by r.observed_at desc) from (select id,machine_code,tool_code,tool_sequence,predicted_productivity_kg_h,actual_productivity_kg_h,productivity_error_percent,predicted_duration_minutes,actual_duration_minutes,observed_at from public.planning_learning_observations where organization_id=v_org order by observed_at desc limit 50) r),'[]'::jsonb)
  );
end; $$;

create or replace function public.local_save_planning_intelligence_settings_v3(
  p_token text,p_thermal numeric,p_resources numeric,p_material numeric,p_delivery numeric,p_flow numeric,p_hole_sequence numeric,p_short_run numeric,
  p_minimum_confidence_samples integer,p_high_hole_threshold integer,p_max_consecutive_high_hole_tools integer,p_low_volume_threshold_kg numeric,
  p_ai_enabled boolean,p_ai_provider text,p_ai_provider_endpoint text,p_ai_external_data_enabled boolean,p_ai_model_mode text,p_ai_model text,p_ai_personality_prompt text,p_ai_analysis_criteria text,p_ai_max_recommendations integer
) returns void language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_org uuid; v_role text; v_name text;
begin
  v_actor:=private.require_local_session(p_token,false);
  select organization_id,role::text,coalesce(display_name,username) into v_org,v_role,v_name from private.local_users where id=v_actor;
  if v_role not in ('admin','manager','pcp') then raise exception 'Perfil sem permissão para alterar os critérios.' using errcode='42501'; end if;
  if coalesce(p_thermal,0)+coalesce(p_resources,0)+coalesce(p_material,0)+coalesce(p_delivery,0)+coalesce(p_flow,0)+coalesce(p_hole_sequence,0)+coalesce(p_short_run,0)<>100 then raise exception 'A soma dos pesos deve ser 100%%.'; end if;
  if p_ai_provider not in ('openrouter','lmstudio','openai','openclaw') then raise exception 'Provedor de IA inválido.'; end if;
  if length(coalesce(p_ai_provider_endpoint,''))>300 or (p_ai_provider_endpoint<>'' and p_ai_provider_endpoint !~ '^https?://[^[:space:]]+$') then raise exception 'Endpoint de IA inválido.'; end if;
  if p_ai_model_mode not in ('auto','manual') or btrim(coalesce(p_ai_model,''))='' then raise exception 'Modelo de IA inválido.'; end if;
  insert into public.planning_intelligence_settings(organization_id,thermal_weight,resource_weight,material_weight,delivery_weight,flow_weight,hole_sequence_weight,short_run_weight,minimum_confidence_samples,high_hole_threshold,max_consecutive_high_hole_tools,low_volume_threshold_kg,ai_enabled,ai_provider,ai_provider_endpoint,ai_external_data_enabled,ai_model_mode,ai_model,ai_personality_prompt,ai_analysis_criteria,ai_max_recommendations,updated_by_user_id,updated_by_name)
  values(v_org,p_thermal,p_resources,p_material,p_delivery,p_flow,p_hole_sequence,p_short_run,p_minimum_confidence_samples,p_high_hole_threshold,p_max_consecutive_high_hole_tools,p_low_volume_threshold_kg,coalesce(p_ai_enabled,false),p_ai_provider,btrim(coalesce(p_ai_provider_endpoint,'')),coalesce(p_ai_external_data_enabled,true),p_ai_model_mode,btrim(p_ai_model),btrim(p_ai_personality_prompt),btrim(p_ai_analysis_criteria),p_ai_max_recommendations,v_actor,v_name)
  on conflict(organization_id) do update set thermal_weight=excluded.thermal_weight,resource_weight=excluded.resource_weight,material_weight=excluded.material_weight,delivery_weight=excluded.delivery_weight,flow_weight=excluded.flow_weight,hole_sequence_weight=excluded.hole_sequence_weight,short_run_weight=excluded.short_run_weight,minimum_confidence_samples=excluded.minimum_confidence_samples,high_hole_threshold=excluded.high_hole_threshold,max_consecutive_high_hole_tools=excluded.max_consecutive_high_hole_tools,low_volume_threshold_kg=excluded.low_volume_threshold_kg,ai_enabled=excluded.ai_enabled,ai_provider=excluded.ai_provider,ai_provider_endpoint=excluded.ai_provider_endpoint,ai_external_data_enabled=excluded.ai_external_data_enabled,ai_model_mode=excluded.ai_model_mode,ai_model=excluded.ai_model,ai_personality_prompt=excluded.ai_personality_prompt,ai_analysis_criteria=excluded.ai_analysis_criteria,ai_max_recommendations=excluded.ai_max_recommendations,updated_by_user_id=v_actor,updated_by_name=v_name;
end; $$;

create or replace function public.local_save_planning_ai_analysis(p_token text,p_request_hash text,p_model_requested text,p_model_used text,p_status text,p_input_summary jsonb,p_result jsonb,p_usage jsonb,p_duration_ms integer,p_error_message text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_actor uuid; v_org uuid; v_name text; v_id uuid;
begin
  v_actor:=private.require_local_session(p_token,false); select organization_id,coalesce(display_name,username) into v_org,v_name from private.local_users where id=v_actor;
  if p_status not in ('completed','failed') then raise exception 'Status inválido.'; end if;
  insert into public.planning_ai_analyses(organization_id,request_hash,model_requested,model_used,status,input_summary,result,usage,duration_ms,error_message,created_by_user_id,created_by_name,contract,validation)
  values(v_org,p_request_hash,p_model_requested,p_model_used,p_status,coalesce(p_input_summary,'{}'::jsonb),p_result,coalesce(p_usage,'{}'::jsonb),p_duration_ms,left(p_error_message,1000),v_actor,v_name,coalesce(p_result->'contract','{}'::jsonb),coalesce(p_result->'validation','{}'::jsonb)) returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.local_save_planning_intelligence_settings_v3(text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,integer,integer,integer,numeric,boolean,text,text,boolean,text,text,text,text,integer) from public;
grant execute on function public.local_save_planning_intelligence_settings_v3(text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,integer,integer,integer,numeric,boolean,text,text,boolean,text,text,text,text,integer) to anon,authenticated;

commit;
