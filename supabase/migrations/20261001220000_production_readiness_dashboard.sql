-- Data used by the operator readiness panel before opening a process sheet.
alter table public.machine_load_settings
  add column if not exists tool_change_minutes integer not null default 1;

alter table public.machine_load_settings
  drop constraint if exists machine_load_tool_change_minutes_nonnegative;
alter table public.machine_load_settings
  add constraint machine_load_tool_change_minutes_nonnegative
  check (tool_change_minutes >= 0 and tool_change_minutes <= 1_440);

alter table public.tools
  add column if not exists tool_weight_kg numeric(10,3);

alter table public.tools
  drop constraint if exists tools_weight_positive;
alter table public.tools
  add constraint tools_weight_positive
  check (tool_weight_kg is null or tool_weight_kg > 0);

alter table public.production_orders
  add column if not exists requires_test boolean not null default false;

create index if not exists production_orders_requires_test_idx
  on public.production_orders (organization_id, machine_code, requires_test)
  where is_active = true and status in ('planned', 'released', 'in_progress', 'paused');

-- Keep the existing settings RPC contract and add the configurable dead time
-- used by the operator panel to estimate tool-change minutes.
create or replace function public.local_save_machine_load_setting(
  p_token text,
  p_machine_code text,
  p_default_productivity_kg_h numeric,
  p_billet_bar_weight_kg numeric,
  p_extrusion_efficiency numeric,
  p_setup_minutes integer,
  p_alloy_change_minutes integer,
  p_tool_heating_minutes integer,
  p_tool_change_minutes integer,
  p_oven_count integer,
  p_oven_slots_per_oven integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_role text;
  v_before jsonb;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id, role::text into v_org, v_role from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp') then raise exception 'Perfil sem permissão para alterar a simulação.'; end if;
  if not exists (select 1 from public.machines m where m.organization_id = v_org and m.code = p_machine_code and m.is_active = true) then raise exception 'Prensa não encontrada.'; end if;
  if coalesce(p_default_productivity_kg_h, 0) <= 0 or coalesce(p_billet_bar_weight_kg, 0) <= 0 then raise exception 'Produtividade e peso da barra precisam ser maiores que zero.'; end if;
  if coalesce(p_extrusion_efficiency, 0) <= 0 or p_extrusion_efficiency > 1 then raise exception 'A eficiência precisa estar entre 0 e 100%%.'; end if;
  if coalesce(p_setup_minutes, 0) not between 0 and 1_440
     or coalesce(p_alloy_change_minutes, 0) not between 0 and 1_440
     or coalesce(p_tool_heating_minutes, 0) not between 0 and 1_440
     or coalesce(p_tool_change_minutes, 0) not between 0 and 1_440 then
    raise exception 'Os tempos configurados são inválidos.';
  end if;
  if coalesce(p_oven_count, 0) not between 1 and 20 or coalesce(p_oven_slots_per_oven, 0) not between 1 and 100 then raise exception 'Configuração dos fornos inválida.'; end if;
  select to_jsonb(x) into v_before from public.machine_load_settings x where x.organization_id = v_org and x.machine_code = p_machine_code;
  insert into public.machine_load_settings (
    organization_id, machine_code, default_productivity_kg_h, billet_bar_weight_kg,
    extrusion_efficiency, setup_minutes, alloy_change_minutes, tool_heating_minutes,
    tool_change_minutes, oven_count, oven_slots_per_oven, updated_at
  ) values (
    v_org, p_machine_code, p_default_productivity_kg_h, p_billet_bar_weight_kg,
    p_extrusion_efficiency, p_setup_minutes, p_alloy_change_minutes, p_tool_heating_minutes,
    p_tool_change_minutes, p_oven_count, p_oven_slots_per_oven, now()
  ) on conflict (organization_id, machine_code) do update set
    default_productivity_kg_h = excluded.default_productivity_kg_h,
    billet_bar_weight_kg = excluded.billet_bar_weight_kg,
    extrusion_efficiency = excluded.extrusion_efficiency,
    setup_minutes = excluded.setup_minutes,
    alloy_change_minutes = excluded.alloy_change_minutes,
    tool_heating_minutes = excluded.tool_heating_minutes,
    tool_change_minutes = excluded.tool_change_minutes,
    oven_count = excluded.oven_count,
    oven_slots_per_oven = excluded.oven_slots_per_oven,
    updated_at = now();
  insert into private.local_user_audit (organization_id, actor_user_id, event_type, details)
  values (v_org, v_actor, 'machine_load_setting_updated', jsonb_build_object(
    'machine_code', p_machine_code, 'before', v_before,
    'after', (select to_jsonb(x) from public.machine_load_settings x where x.organization_id = v_org and x.machine_code = p_machine_code)
  ));
end;
$$;

revoke all on function public.local_save_machine_load_setting(text, text, numeric, numeric, numeric, integer, integer, integer, integer, integer, integer) from public;
grant execute on function public.local_save_machine_load_setting(text, text, numeric, numeric, numeric, integer, integer, integer, integer, integer, integer) to anon, authenticated;

create or replace function public.local_set_production_order_test_requirement(
  p_token text,
  p_order_ids uuid[],
  p_requires_test boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_role text;
  v_count integer;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id, role::text into v_org, v_role
    from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp') then
    raise exception 'Somente PCP ou administrador pode indicar testes.';
  end if;
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then
    return 0;
  end if;
  update public.production_orders
    set requires_test = p_requires_test
    where organization_id = v_org
      and id = any(p_order_ids)
      and is_active = true
      and status in ('planned', 'released', 'in_progress', 'paused');
  get diagnostics v_count = row_count;
  insert into private.local_user_audit (organization_id, actor_user_id, event_type, details)
  values (v_org, v_actor, 'production_test_requirement_updated', jsonb_build_object(
    'order_ids', p_order_ids,
    'requires_test', p_requires_test,
    'updated_count', v_count
  ));
  return v_count;
end;
$$;

revoke all on function public.local_set_production_order_test_requirement(text, uuid[], boolean) from public;
grant execute on function public.local_set_production_order_test_requirement(text, uuid[], boolean) to anon, authenticated;
