-- Uma vaga aceita somente uma ferramenta ativa. O índice parcial criado na
-- migração anterior é a barreira final contra duas operações simultâneas.
-- Esta migração acrescenta a realocação auditada de prensa/forno sem reiniciar
-- o relógio de aquecimento.

alter table public.tool_heating_history
  drop constraint if exists tool_heating_history_event_type_check;
alter table public.tool_heating_history
  add constraint tool_heating_history_event_type_check
  check (event_type in ('entered','released','cancelled','reallocated'));

drop function if exists public.start_tool_heating(uuid[], text, uuid, integer, text, text);

create function public.start_tool_heating(
  p_order_ids uuid[],
  p_actor text,
  p_oven_id uuid,
  p_oven_position integer,
  p_tool_type text,
  p_target_machine text,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cycle_id uuid;
  v_org uuid;
  v_import uuid;
  v_source_machine text;
  v_tool text;
  v_count integer;
  v_oven public.tool_ovens;
  v_required integer;
  v_target_temperature numeric(5,1);
begin
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then
    raise exception 'Selecione ao menos um item da Simplificada.';
  end if;
  if nullif(trim(p_actor), '') is null then
    raise exception 'Informe o responsável pela entrada no forno.';
  end if;
  if p_tool_type not in ('solid', 'tubular') then
    raise exception 'Informe se a ferramenta é sólida ou tubular.';
  end if;
  if nullif(trim(p_target_machine), '') is null then
    raise exception 'Selecione a prensa de destino.';
  end if;

  select * into v_oven
    from public.tool_ovens
   where id = p_oven_id and is_active
   for share;
  if not found then
    raise exception 'Forno não encontrado ou inativo.';
  end if;
  if p_oven_position not between 1 and v_oven.position_count then
    raise exception 'Selecione uma posição válida do forno.';
  end if;

  select min(po.organization_id::text)::uuid,
         min(po.import_batch_id::text)::uuid,
         min(po.machine_code), min(po.tool_code), count(*)
    into v_org, v_import, v_source_machine, v_tool, v_count
    from public.production_orders po
    join public.simplified_imports si on si.id = po.import_batch_id
   where po.id = any(p_order_ids)
     and po.is_active = true
     and po.status in ('planned','released','paused')
     and si.status = 'processed'
     and si.is_active = true
     and si.deleted_at is null;

  if v_count <> array_length(p_order_ids, 1) then
    raise exception 'Um ou mais itens não estão disponíveis numa Simplificada ativa.';
  end if;
  if v_oven.organization_id <> v_org then
    raise exception 'O forno e os itens pertencem a organizações diferentes.';
  end if;
  if ((select auth.uid()) is null and v_org <> '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
     or ((select auth.uid()) is not null and not exists (
       select 1 from public.organization_members om
       where om.organization_id = v_org and om.user_id = (select auth.uid())
     )) then
    raise exception 'Acesso não autorizado para esta organização.';
  end if;
  if not exists (
    select 1 from public.machines m
     where m.organization_id = v_org and m.code = trim(p_target_machine) and m.is_active
  ) then
    raise exception 'Prensa de destino não encontrada ou inativa.';
  end if;
  if (select count(distinct po.organization_id) from public.production_orders po where po.id = any(p_order_ids)) <> 1
     or (select count(distinct po.machine_code) from public.production_orders po where po.id = any(p_order_ids)) <> 1
     or (select count(distinct upper(po.tool_code)) from public.production_orders po where po.id = any(p_order_ids)) <> 1 then
    raise exception 'Agrupe somente itens da mesma ferramenta e da mesma prensa de origem.';
  end if;
  if exists (
    select 1 from public.tool_heating_cycle_orders co
    join public.tool_heating_cycles c on c.id = co.cycle_id
    where co.production_order_id = any(p_order_ids) and c.status in ('heating','released')
  ) then
    raise exception 'Um dos itens já possui aquecimento ativo ou já foi liberado.';
  end if;
  if exists (
    select 1 from public.tool_heating_cycles c
     where c.oven_id = p_oven_id
       and c.oven_position = p_oven_position
       and c.status = 'heating'
  ) then
    raise exception 'Vaga ocupada: retire ou realoque a ferramenta atual antes de usar esta posição.';
  end if;

  v_required := case when p_tool_type = 'tubular'
    then v_oven.tubular_minimum_minutes else v_oven.solid_minimum_minutes end;
  v_target_temperature := case when p_tool_type = 'tubular'
    then v_oven.tubular_target_temperature_c else v_oven.solid_target_temperature_c end;

  insert into public.tool_heating_cycles (
    organization_id, import_batch_id, machine_code, tool_code,
    oven_code, oven_id, oven_position, tool_type, target_temperature_c,
    required_minutes, entered_at, expected_ready_at, maximum_due_at,
    entered_by_name, notes
  ) values (
    v_org, v_import, trim(p_target_machine), v_tool,
    v_oven.name, v_oven.id, p_oven_position, p_tool_type, v_target_temperature,
    v_required, now(), now() + make_interval(mins => v_required),
    now() + make_interval(mins => v_oven.maximum_minutes),
    trim(p_actor), nullif(trim(p_notes), '')
  ) returning id into v_cycle_id;

  insert into public.tool_heating_cycle_orders (cycle_id, production_order_id)
  select v_cycle_id, unnest(p_order_ids);

  update public.production_orders
     set machine_code = trim(p_target_machine),
         last_status_reason = case
           when machine_code is distinct from trim(p_target_machine)
             then concat('Prensa alterada de ', machine_code, ' para ', trim(p_target_machine), ' por ', trim(p_actor), ' na entrada do forno')
           else last_status_reason
         end
   where id = any(p_order_ids);

  insert into public.tool_heating_history (organization_id, cycle_id, event_type, actor_name, notes, snapshot)
  select v_org, v_cycle_id, 'entered', trim(p_actor), nullif(trim(p_notes), ''),
         jsonb_build_object(
           'cycle', to_jsonb(c),
           'source_machine', v_source_machine,
           'target_machine', trim(p_target_machine),
           'order_ids', to_jsonb(p_order_ids)
         )
  from public.tool_heating_cycles c where c.id = v_cycle_id;

  return v_cycle_id;
exception
  when unique_violation then
    raise exception 'Vaga ocupada por outro usuário. Atualize o quadro e escolha outra posição.';
end;
$$;

create function public.reallocate_tool_heating(
  p_cycle_id uuid,
  p_target_machine text,
  p_oven_id uuid,
  p_oven_position integer,
  p_actor text,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cycle public.tool_heating_cycles;
  v_before jsonb;
  v_after jsonb;
  v_oven public.tool_ovens;
  v_target_temperature numeric(5,1);
begin
  if nullif(trim(p_actor), '') is null then
    raise exception 'Informe o responsável pela alteração.';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 4 then
    raise exception 'Informe o motivo da realocação.';
  end if;
  if nullif(trim(p_target_machine), '') is null then
    raise exception 'Selecione a prensa de destino.';
  end if;

  select * into v_cycle
    from public.tool_heating_cycles
   where id = p_cycle_id
   for update;
  if not found or v_cycle.status not in ('heating','released') then
    raise exception 'Esta ferramenta não está disponível para realocação.';
  end if;
  v_before := to_jsonb(v_cycle);

  if ((select auth.uid()) is null and v_cycle.organization_id <> '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
     or ((select auth.uid()) is not null and not exists (
       select 1 from public.organization_members om
       where om.organization_id = v_cycle.organization_id and om.user_id = (select auth.uid())
     )) then
    raise exception 'Acesso não autorizado para esta organização.';
  end if;
  if not exists (
    select 1 from public.machines m
     where m.organization_id = v_cycle.organization_id
       and m.code = trim(p_target_machine) and m.is_active
  ) then
    raise exception 'Prensa de destino não encontrada ou inativa.';
  end if;
  if exists (
    select 1 from public.tool_heating_cycle_orders co
    join public.production_orders po on po.id = co.production_order_id
    where co.cycle_id = p_cycle_id and po.status not in ('planned','released','paused')
  ) then
    raise exception 'A produção já foi iniciada ou encerrada; a prensa não pode mais ser alterada.';
  end if;

  if v_cycle.status = 'heating' then
    select * into v_oven
      from public.tool_ovens
     where id = p_oven_id
       and organization_id = v_cycle.organization_id
       and is_active
     for share;
    if not found then
      raise exception 'Forno de destino não encontrado ou inativo.';
    end if;
    if p_oven_position not between 1 and v_oven.position_count then
      raise exception 'Selecione uma posição válida do forno.';
    end if;
    if exists (
      select 1 from public.tool_heating_cycles c
       where c.oven_id = p_oven_id
         and c.oven_position = p_oven_position
         and c.status = 'heating'
         and c.id <> p_cycle_id
    ) then
      raise exception 'Vaga ocupada: retire ou realoque a ferramenta atual antes de usar esta posição.';
    end if;

    v_target_temperature := case when v_cycle.tool_type = 'tubular'
      then v_oven.tubular_target_temperature_c else v_oven.solid_target_temperature_c end;

    update public.tool_heating_cycles
       set machine_code = trim(p_target_machine),
           oven_id = v_oven.id,
           oven_code = v_oven.name,
           oven_position = p_oven_position,
           target_temperature_c = v_target_temperature
     where id = p_cycle_id;
  else
    update public.tool_heating_cycles
       set machine_code = trim(p_target_machine)
     where id = p_cycle_id;
  end if;

  update public.production_orders po
     set machine_code = trim(p_target_machine),
         last_status_reason = concat(
           'Realocada da prensa ', v_cycle.machine_code,
           ' para ', trim(p_target_machine), ' por ', trim(p_actor),
           '. Motivo: ', trim(p_reason)
         )
    from public.tool_heating_cycle_orders co
   where co.cycle_id = p_cycle_id and po.id = co.production_order_id;

  select to_jsonb(c) into v_after
    from public.tool_heating_cycles c
   where c.id = p_cycle_id;

  insert into public.tool_heating_history (
    organization_id, cycle_id, event_type, actor_name, notes, snapshot
  ) values (
    v_cycle.organization_id, p_cycle_id, 'reallocated', trim(p_actor), trim(p_reason),
    jsonb_build_object(
      'before', v_before,
      'after', v_after,
      'reason', trim(p_reason)
    )
  );
exception
  when unique_violation then
    raise exception 'Vaga ocupada por outro usuário. Atualize o quadro e escolha outra posição.';
end;
$$;

revoke all on function public.start_tool_heating(uuid[], text, uuid, integer, text, text, text) from public;
revoke all on function public.reallocate_tool_heating(uuid, text, uuid, integer, text, text) from public;
grant execute on function public.start_tool_heating(uuid[], text, uuid, integer, text, text, text) to anon, authenticated;
grant execute on function public.reallocate_tool_heating(uuid, text, uuid, integer, text, text) to anon, authenticated;
