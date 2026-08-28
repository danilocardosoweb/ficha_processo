begin;

-- The thermal topology is an operational parameter, not a UI constant.
alter table public.machine_load_settings
  add column if not exists oven_count integer not null default 3,
  add column if not exists oven_slots_per_oven integer not null default 7;

alter table public.machine_load_settings
  drop constraint if exists machine_load_oven_topology_positive;
alter table public.machine_load_settings
  add constraint machine_load_oven_topology_positive
  check (oven_count between 1 and 20 and oven_slots_per_oven between 1 and 100);

-- A setup may use a different carcass according to press and physical sequence.
-- NULL press/sequence means the mapping is the default for the tool.
create table public.tool_carcass_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  tool_code text not null,
  machine_code text,
  sequence_number integer,
  carcass_code text not null,
  quantity integer not null default 1 check (quantity > 0),
  notes text,
  is_active boolean not null default true,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tool_carcass_tool_not_blank check (btrim(tool_code) <> ''),
  constraint tool_carcass_code_not_blank check (btrim(carcass_code) <> ''),
  constraint tool_carcass_sequence_positive check (sequence_number is null or sequence_number > 0),
  unique nulls not distinct (organization_id, tool_code, machine_code, sequence_number)
);

create index tool_carcass_requirement_lookup_idx
  on public.tool_carcass_requirements (organization_id, upper(tool_code), machine_code, sequence_number)
  where is_active = true;

create trigger tool_carcass_requirements_updated_at
before update on public.tool_carcass_requirements
for each row execute function private.set_updated_at();
create trigger audit_tool_carcass_requirements_trg
after insert or update or delete on public.tool_carcass_requirements
for each row execute function public.audit_operational_change();

alter table public.tool_carcass_requirements enable row level security;
revoke all on public.tool_carcass_requirements from public, anon, authenticated;

alter table public.simulation_scenarios
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by_user_id uuid,
  add column if not exists applied_at timestamptz;

create or replace function public.local_list_tool_carcass_requirements(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid; v_org uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  return jsonb_build_object(
    'mappings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'toolCode', r.tool_code, 'machineCode', r.machine_code,
        'sequenceNumber', r.sequence_number, 'carcassCode', r.carcass_code,
        'quantity', r.quantity, 'notes', r.notes, 'isActive', r.is_active,
        'updatedBy', r.updated_by_name, 'updatedAt', r.updated_at
      ) order by r.tool_code, r.machine_code nulls first, r.sequence_number nulls first)
      from public.tool_carcass_requirements r where r.organization_id = v_org
    ), '[]'::jsonb),
    'tools', coalesce((
      select jsonb_agg(jsonb_build_object('code', t.code, 'description', t.description) order by t.code)
      from public.tools t where t.organization_id = v_org
    ), '[]'::jsonb),
    'carcasses', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.carcass_code, 'availableQuantity',
        case when c.status = 'available' then greatest(c.total_quantity - c.unavailable_quantity, 0) else 0 end
      ) order by c.carcass_code)
      from public.press_carcass_resources c where c.organization_id = v_org
    ), '[]'::jsonb),
    'machines', coalesce((
      select jsonb_agg(jsonb_build_object('code', m.code, 'name', m.name) order by m.code)
      from public.machines m where m.organization_id = v_org and m.is_active = true
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.local_upsert_tool_carcass_requirement(
  p_token text, p_id uuid, p_tool_code text, p_machine_code text,
  p_sequence_number integer, p_carcass_code text, p_quantity integer,
  p_notes text, p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid; v_org uuid; v_role text; v_name text; v_id uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id, role::text, coalesce(display_name, username)
    into v_org, v_role, v_name from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp', 'engineering') then raise exception 'Perfil sem permissão para vincular carcaças.'; end if;
  if btrim(coalesce(p_tool_code, '')) = '' or btrim(coalesce(p_carcass_code, '')) = '' then raise exception 'Informe ferramenta e carcaça.'; end if;
  if coalesce(p_quantity, 0) <= 0 then raise exception 'A quantidade de carcaças deve ser maior que zero.'; end if;
  if p_machine_code is not null and not exists (
    select 1 from public.machines m where m.organization_id = v_org and m.code = p_machine_code and m.is_active = true
  ) then raise exception 'Prensa não encontrada.'; end if;
  if not exists (
    select 1 from public.press_carcass_resources c
    where c.organization_id = v_org and upper(btrim(c.carcass_code)) = upper(btrim(p_carcass_code))
  ) then raise exception 'Cadastre a carcaça física antes de vinculá-la à ferramenta.'; end if;

  if p_id is null then
    insert into public.tool_carcass_requirements (
      organization_id, tool_code, machine_code, sequence_number, carcass_code,
      quantity, notes, is_active, created_by_user_id, updated_by_user_id, updated_by_name
    ) values (
      v_org, upper(btrim(p_tool_code)), nullif(btrim(coalesce(p_machine_code, '')), ''),
      p_sequence_number, upper(btrim(p_carcass_code)), p_quantity,
      nullif(btrim(coalesce(p_notes, '')), ''), coalesce(p_is_active, true),
      v_actor, v_actor, v_name
    ) returning id into v_id;
  else
    update public.tool_carcass_requirements set
      tool_code = upper(btrim(p_tool_code)),
      machine_code = nullif(btrim(coalesce(p_machine_code, '')), ''),
      sequence_number = p_sequence_number,
      carcass_code = upper(btrim(p_carcass_code)), quantity = p_quantity,
      notes = nullif(btrim(coalesce(p_notes, '')), ''), is_active = coalesce(p_is_active, true),
      updated_by_user_id = v_actor, updated_by_name = v_name
    where id = p_id and organization_id = v_org returning id into v_id;
    if v_id is null then raise exception 'Vínculo não encontrado.'; end if;
  end if;
  return v_id;
end;
$$;

-- Include interval reservations so the simulator can reason about the shared
-- pool instead of subtracting every future reservation from all instants.
create or replace function public.local_list_press_carcass_resources(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_org uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'machineCode', 'SHARED', 'sharedAcrossMachines', true,
      'carcassCode', c.carcass_code, 'totalQuantity', c.total_quantity,
      'unavailableQuantity', c.unavailable_quantity,
      'physicalAvailableQuantity', case when c.status = 'available' then greatest(c.total_quantity - c.unavailable_quantity, 0) else 0 end,
      'reservedQuantity', coalesce(r.reserved_quantity, 0),
      'availableQuantity', case when c.status = 'available' then greatest(c.total_quantity - c.unavailable_quantity - coalesce(r.reserved_quantity, 0), 0) else 0 end,
      'reservations', coalesce(r.reservations, '[]'::jsonb),
      'status', c.status, 'location', c.location, 'notes', c.notes, 'updatedAt', c.updated_at
    ) order by c.carcass_code)
    from public.press_carcass_resources c
    left join lateral (
      select coalesce(sum(cr.quantity), 0)::integer reserved_quantity,
        jsonb_agg(jsonb_build_object('id', cr.id, 'quantity', cr.quantity,
          'startsAt', cr.starts_at, 'endsAt', cr.ends_at,
          'productionOrderId', cr.production_order_id, 'simulationVersionId', cr.simulation_version_id
        ) order by cr.starts_at) filter (where cr.id is not null) reservations
      from public.press_carcass_reservations cr
      where cr.carcass_resource_id = c.id and cr.status = 'active'
        and (cr.ends_at is null or cr.ends_at > now())
    ) r on true
    where c.organization_id = v_org
  ), '[]'::jsonb);
end;
$$;

drop function if exists public.local_save_machine_load_setting(text, text, numeric, numeric, numeric, integer, integer, integer);
create or replace function public.local_save_machine_load_setting(
  p_token text, p_machine_code text, p_default_productivity_kg_h numeric,
  p_billet_bar_weight_kg numeric, p_extrusion_efficiency numeric,
  p_setup_minutes integer, p_alloy_change_minutes integer,
  p_tool_heating_minutes integer, p_oven_count integer,
  p_oven_slots_per_oven integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid; v_org uuid; v_role text; v_before jsonb;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id, role::text into v_org, v_role from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp') then raise exception 'Perfil sem permissão para alterar a simulação.'; end if;
  if not exists (select 1 from public.machines m where m.organization_id = v_org and m.code = p_machine_code and m.is_active = true) then raise exception 'Prensa não encontrada.'; end if;
  if coalesce(p_default_productivity_kg_h, 0) <= 0 or coalesce(p_billet_bar_weight_kg, 0) <= 0 then raise exception 'Produtividade e peso da barra precisam ser maiores que zero.'; end if;
  if coalesce(p_extrusion_efficiency, 0) <= 0 or p_extrusion_efficiency > 1 then raise exception 'A eficiência precisa estar entre 0 e 100%%.'; end if;
  if coalesce(p_oven_count, 0) not between 1 and 20 or coalesce(p_oven_slots_per_oven, 0) not between 1 and 100 then raise exception 'Configuração dos fornos inválida.'; end if;
  select to_jsonb(x) into v_before from public.machine_load_settings x where x.organization_id = v_org and x.machine_code = p_machine_code;
  insert into public.machine_load_settings (
    organization_id, machine_code, default_productivity_kg_h, billet_bar_weight_kg,
    extrusion_efficiency, setup_minutes, alloy_change_minutes, tool_heating_minutes,
    oven_count, oven_slots_per_oven, updated_at
  ) values (
    v_org, p_machine_code, p_default_productivity_kg_h, p_billet_bar_weight_kg,
    p_extrusion_efficiency, p_setup_minutes, p_alloy_change_minutes, p_tool_heating_minutes,
    p_oven_count, p_oven_slots_per_oven, now()
  ) on conflict (organization_id, machine_code) do update set
    default_productivity_kg_h = excluded.default_productivity_kg_h,
    billet_bar_weight_kg = excluded.billet_bar_weight_kg,
    extrusion_efficiency = excluded.extrusion_efficiency,
    setup_minutes = excluded.setup_minutes,
    alloy_change_minutes = excluded.alloy_change_minutes,
    tool_heating_minutes = excluded.tool_heating_minutes,
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

create or replace function public.local_approve_simulation_scenario(p_token text, p_scenario_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid; v_org uuid; v_role text; v_name text; v_version_id uuid; v_version_number integer;
  v_input jsonb; v_result jsonb; v_item jsonb; v_billet jsonb; v_order jsonb;
  v_resource public.press_carcass_resources%rowtype; v_overlap integer; v_position integer;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id, role::text, coalesce(display_name, username)
    into v_org, v_role, v_name from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp') then raise exception 'Somente Administrador ou PCP pode aprovar cenários.'; end if;

  select v.id, v.version_number, v.input_snapshot, v.result_snapshot
    into v_version_id, v_version_number, v_input, v_result
  from public.simulation_scenarios s
  join public.simulation_versions v on v.scenario_id = s.id and v.version_number = s.current_version
  where s.id = p_scenario_id and s.organization_id = v_org
  for update of s;
  if v_version_id is null then raise exception 'Cenário não encontrado.'; end if;

  update public.billet_reservations set status = 'released', updated_by_user_id = v_actor, updated_by_name = v_name
  where organization_id = v_org and simulation_version_id = v_version_id and status = 'active';
  update public.press_carcass_reservations set status = 'released', updated_by_user_id = v_actor, updated_by_name = v_name
  where organization_id = v_org and simulation_version_id = v_version_id and status = 'active';

  for v_billet in select value from jsonb_array_elements(coalesce(v_result -> 'billets', '[]'::jsonb)) loop
    if coalesce((v_billet ->> 'bars')::integer, 0) > 0 then
      perform public.local_reserve_billet_stock(
        p_token, v_billet ->> 'alloyCode', (v_billet ->> 'bars')::integer,
        v_version_id, null, 'Reserva automática do cenário aprovado'
      );
    end if;
  end loop;

  for v_item in
    select item.value
    from jsonb_array_elements(coalesce(v_result -> 'machines', '[]'::jsonb)) machine,
         jsonb_array_elements(coalesce(machine.value -> 'items', '[]'::jsonb)) item
  loop
    if nullif(btrim(coalesce(v_item ->> 'carcassCode', '')), '') is not null then
      select * into v_resource from public.press_carcass_resources c
      where c.organization_id = v_org
        and upper(btrim(c.carcass_code)) = upper(btrim(v_item ->> 'carcassCode'))
        and c.status = 'available' for update;
      if v_resource.id is null then raise exception 'Carcaça % não está disponível.', v_item ->> 'carcassCode'; end if;
      select coalesce(sum(r.quantity), 0)::integer into v_overlap
      from public.press_carcass_reservations r
      where r.carcass_resource_id = v_resource.id and r.status = 'active'
        and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange((v_item ->> 'startAt')::timestamptz, (v_item ->> 'endAt')::timestamptz, '[)');
      if v_overlap + greatest(coalesce((v_item ->> 'carcassQuantity')::integer, 1), 1) > greatest(v_resource.total_quantity - v_resource.unavailable_quantity, 0) then
        raise exception 'A carcaça % não possui saldo no intervalo planejado.', v_resource.carcass_code;
      end if;
      insert into public.press_carcass_reservations (
        organization_id, carcass_resource_id, simulation_version_id, production_order_id,
        quantity, starts_at, ends_at, status, notes, created_by_user_id, updated_by_user_id, updated_by_name
      ) values (
        v_org, v_resource.id, v_version_id, nullif(v_item ->> 'id', '')::uuid,
        greatest(coalesce((v_item ->> 'carcassQuantity')::integer, 1), 1), (v_item ->> 'startAt')::timestamptz, (v_item ->> 'endAt')::timestamptz,
        'active', 'Reserva automática do cenário aprovado', v_actor, v_actor, v_name
      );
    end if;
  end loop;

  -- Apply the approved queue only after every stock/resource validation passed.
  for v_order in select value from jsonb_array_elements(coalesce(v_input -> 'orders', '[]'::jsonb)) loop
    update public.production_orders set
      machine_code = v_order ->> 'machineCode',
      sequence = greatest(coalesce((v_order ->> 'sequence')::integer, 1), 1),
      updated_at = now()
    where id = (v_order ->> 'id')::uuid and organization_id = v_org;
    if not found then raise exception 'Uma ordem do cenário não está mais disponível.'; end if;
  end loop;

  delete from public.simulation_resource_events where simulation_version_id = v_version_id;
  for v_item in
    select item.value
    from jsonb_array_elements(coalesce(v_result -> 'machines', '[]'::jsonb)) machine,
         jsonb_array_elements(coalesce(machine.value -> 'items', '[]'::jsonb)) item
  loop
    insert into public.simulation_resource_events (organization_id, simulation_version_id, resource_type, resource_code, event_type, starts_at, ends_at, quantity, unit, metadata)
    values
      (v_org, v_version_id, 'press', v_item ->> 'machineCode', 'reserved', (v_item ->> 'startAt')::timestamptz, (v_item ->> 'endAt')::timestamptz, 1, 'press', jsonb_build_object('orderId', v_item ->> 'id')),
      (v_org, v_version_id, 'tool', v_item ->> 'toolCode', 'reserved', (v_item ->> 'startAt')::timestamptz, (v_item ->> 'endAt')::timestamptz, 1, 'tool', jsonb_build_object('orderId', v_item ->> 'id'));
    if nullif(v_item ->> 'carcassCode', '') is not null then
      insert into public.simulation_resource_events (organization_id, simulation_version_id, resource_type, resource_code, event_type, starts_at, ends_at, quantity, unit, metadata)
      values (v_org, v_version_id, 'carcass', v_item ->> 'carcassCode', 'reserved', (v_item ->> 'startAt')::timestamptz, (v_item ->> 'endAt')::timestamptz, greatest(coalesce((v_item ->> 'carcassQuantity')::integer, 1), 1), 'carcass', jsonb_build_object('orderId', v_item ->> 'id'));
    end if;
  end loop;

  update public.simulation_scenarios set status = 'approved', approved_at = now(),
    approved_by_user_id = v_actor, applied_at = now(), updated_by_user_id = v_actor
  where id = p_scenario_id and organization_id = v_org;
  insert into private.local_user_audit (organization_id, actor_user_id, event_type, details)
  values (v_org, v_actor, 'simulation_scenario_approved', jsonb_build_object(
    'scenario_id', p_scenario_id, 'version_id', v_version_id, 'version_number', v_version_number
  ));
  return jsonb_build_object('ok', true, 'scenarioId', p_scenario_id, 'versionNumber', v_version_number, 'status', 'approved');
end;
$$;

revoke all on function public.local_list_tool_carcass_requirements(text) from public;
revoke all on function public.local_upsert_tool_carcass_requirement(text, uuid, text, text, integer, text, integer, text, boolean) from public;
revoke all on function public.local_save_machine_load_setting(text, text, numeric, numeric, numeric, integer, integer, integer, integer, integer) from public;
revoke all on function public.local_approve_simulation_scenario(text, uuid) from public;
grant execute on function public.local_list_tool_carcass_requirements(text) to anon, authenticated;
grant execute on function public.local_upsert_tool_carcass_requirement(text, uuid, text, text, integer, text, integer, text, boolean) to anon, authenticated;
grant execute on function public.local_save_machine_load_setting(text, text, numeric, numeric, numeric, integer, integer, integer, integer, integer) to anon, authenticated;
grant execute on function public.local_approve_simulation_scenario(text, uuid) to anon, authenticated;

commit;
