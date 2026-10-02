-- A confirmação de retirada do forno faz parte do ato de iniciar a produção.
-- A liberação antecipada somente é possível com justificativa rastreável.
create or replace function public.local_start_production(
  p_token text,
  p_order_ids uuid[],
  p_confirmed_removed_from_oven boolean,
  p_early_release_justification text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_org uuid;
  v_machine text;
  v_tool text;
  v_expected_count integer;
  v_available_count integer;
  v_early boolean := false;
  v_reason text := btrim(coalesce(p_early_release_justification, ''));
  v_released_cycles uuid[] := '{}'::uuid[];
  v_orders jsonb;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;

  if v_user.role = 'viewer' then
    raise exception 'Seu perfil possui somente permissão de consulta.' using errcode = '42501';
  end if;
  if not coalesce(p_confirmed_removed_from_oven, false) then
    raise exception 'Confirme que a ferramenta foi retirada do forno antes de iniciar a produção.';
  end if;
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then
    raise exception 'Selecione ao menos um item para iniciar a produção.';
  end if;

  select min(po.organization_id::text)::uuid, min(po.machine_code), min(po.tool_code), count(*)
    into v_org, v_machine, v_tool, v_available_count
  from public.production_orders po
  where po.id = any(p_order_ids)
    and po.is_active
    and po.status in ('planned', 'released');

  if v_available_count <> array_length(p_order_ids, 1) then
    raise exception 'Um dos itens já foi iniciado, concluído ou retirado da programação. Atualize a busca antes de continuar.';
  end if;
  if v_org is distinct from v_user.organization_id then
    raise exception 'Acesso não autorizado para esta organização.' using errcode = '42501';
  end if;
  if (select count(distinct po.organization_id) from public.production_orders po where po.id = any(p_order_ids)) <> 1
     or (select count(distinct po.machine_code) from public.production_orders po where po.id = any(p_order_ids)) <> 1
     or (select count(distinct upper(po.tool_code)) from public.production_orders po where po.id = any(p_order_ids)) <> 1 then
    raise exception 'Agrupe somente itens da mesma ferramenta e da mesma prensa.';
  end if;
  if v_user.role = 'operator'
     and cardinality(v_user.machine_codes) > 0
     and not (v_machine = any(v_user.machine_codes)) then
    raise exception 'Seu usuário não possui acesso à prensa selecionada.' using errcode = '42501';
  end if;

  select count(*) into v_expected_count
  from public.production_orders po
  where po.id = any(p_order_ids) and po.requires_tool_heating;

  if v_expected_count > 0 then
    if exists (
      select 1
      from public.production_orders po
      where po.id = any(p_order_ids)
        and po.requires_tool_heating
        and not exists (
          select 1
          from public.tool_heating_cycle_orders co
          join public.tool_heating_cycles c on c.id = co.cycle_id
          where co.production_order_id = po.id
            and c.status in ('heating', 'released')
        )
    ) then
      raise exception 'A ferramenta não possui um ciclo de forno ativo ou liberado. Registre o aquecimento antes de iniciar.';
    end if;

    select exists (
      select 1
      from public.tool_heating_cycle_orders co
      join public.tool_heating_cycles c on c.id = co.cycle_id
      where co.production_order_id = any(p_order_ids)
        and c.status = 'heating'
        and clock_timestamp() < c.expected_ready_at
    ) into v_early;

    if v_early and char_length(v_reason) < 8 then
      raise exception 'Explique por que a produção será iniciada antes das 4 horas mínimas de forno (mínimo de 8 caracteres).';
    end if;

    with changed as (
      update public.tool_heating_cycles c
         set status = 'released',
             released_at = clock_timestamp(),
             released_by_name = v_user.display_name,
             release_notes = case
               when v_early then 'LIBERAÇÃO ANTECIPADA PARA INÍCIO DE PRODUÇÃO — ' || v_reason
               else 'Ferramenta retirada do forno e confirmada pelo operador ao iniciar produção.'
             end
       where c.status = 'heating'
         and exists (
           select 1 from public.tool_heating_cycle_orders co
           where co.cycle_id = c.id and co.production_order_id = any(p_order_ids)
         )
       returning c.id, c.organization_id
    )
    select coalesce(array_agg(id), '{}'::uuid[]) into v_released_cycles from changed;

    insert into public.tool_heating_history (organization_id, cycle_id, event_type, actor_name, notes, snapshot)
    select c.organization_id, c.id, 'released', v_user.display_name,
           case when v_early then 'Liberação antecipada para início de produção — ' || v_reason
                else 'Retirada do forno confirmada ao iniciar produção.' end,
           to_jsonb(c)
    from public.tool_heating_cycles c
    where c.id = any(v_released_cycles);
  end if;

  with updated as (
    update public.production_orders po
       set status = 'in_progress',
           started_by_name = v_user.display_name,
           last_status_reason = case
             when v_early then 'Produção iniciada com liberação antecipada do forno por ' || v_user.display_name || ': ' || v_reason
             else 'Produção iniciada após confirmação de retirada do forno por ' || v_user.display_name
           end
     where po.id = any(p_order_ids)
       and po.is_active
       and po.status in ('planned', 'released')
     returning po.*
  )
  select jsonb_agg(to_jsonb(updated)) into v_orders from updated;

  if v_orders is null or jsonb_array_length(v_orders) <> array_length(p_order_ids, 1) then
    raise exception 'Um dos itens não pôde ser iniciado. Atualize a busca antes de continuar.';
  end if;

  insert into private.local_user_audit (organization_id, actor_user_id, event_type, details)
  values (
    v_org, v_actor, 'production_started_with_oven_confirmation',
    jsonb_build_object(
      'order_ids', p_order_ids,
      'machine_code', v_machine,
      'tool_code', v_tool,
      'released_cycle_ids', v_released_cycles,
      'early_release', v_early,
      'justification', nullif(v_reason, '')
    )
  );

  return jsonb_build_object(
    'orders', v_orders,
    'released_cycle_ids', v_released_cycles,
    'early_release', v_early
  );
end;
$$;

revoke all on function public.local_start_production(text, uuid[], boolean, text) from public, anon, authenticated;
grant execute on function public.local_start_production(text, uuid[], boolean, text) to anon, authenticated;
