-- Registra uma ferramenta aquecida fora do fluxo monitorado sem ocupar vaga de forno.
-- A confirmação é autenticada pela sessão local e fica ligada às ordens selecionadas.
alter table public.tool_heating_cycles
  add column if not exists heating_source text not null default 'oven',
  add column if not exists preheated_confirmation_reason text;

alter table public.tool_heating_cycles
  drop constraint if exists tool_heating_cycles_heating_source_check;
alter table public.tool_heating_cycles
  add constraint tool_heating_cycles_heating_source_check
  check (heating_source in ('oven', 'confirmed_preheated'));

create or replace function public.local_confirm_preheated_tool(
  p_token text,
  p_order_ids uuid[],
  p_justification text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_cycle_id uuid;
  v_org uuid;
  v_import uuid;
  v_machine text;
  v_tool text;
  v_count integer;
  v_reason text := btrim(coalesce(p_justification, ''));
  v_now timestamptz := clock_timestamp();
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user
  from private.local_users
  where id = v_actor;

  if coalesce(array_length(p_order_ids, 1), 0) = 0 then
    raise exception 'Selecione ao menos um item da Simplificada.';
  end if;
  if char_length(v_reason) < 8 then
    raise exception 'Explique por que a ferramenta já está aquecida (mínimo de 8 caracteres).';
  end if;

  select min(po.organization_id::text)::uuid,
         min(po.import_batch_id::text)::uuid,
         min(po.machine_code),
         min(po.tool_code),
         count(*)
    into v_org, v_import, v_machine, v_tool, v_count
  from public.production_orders po
  join public.simplified_imports si on si.id = po.import_batch_id
  where po.id = any(p_order_ids)
    and po.is_active
    and po.status in ('planned', 'released', 'paused')
    and si.status = 'processed'
    and si.is_active
    and si.deleted_at is null;

  if v_count <> array_length(p_order_ids, 1) then
    raise exception 'Um ou mais itens não estão disponíveis numa Simplificada ativa.';
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
  if exists (
    select 1
    from public.tool_heating_cycles c
    left join public.tool_heating_cycle_orders co on co.cycle_id = c.id
    where c.organization_id = v_org
      and c.machine_code = v_machine
      and upper(c.tool_code) = upper(v_tool)
      and c.status in ('heating', 'released')
      and (co.production_order_id = any(p_order_ids) or c.status = 'heating')
  ) then
    raise exception 'A ferramenta já possui aquecimento registrado ou já foi liberada.';
  end if;

  insert into public.tool_heating_cycles (
    organization_id, import_batch_id, machine_code, tool_code,
    oven_id, oven_code, oven_position, status, required_minutes,
    entered_at, expected_ready_at, maximum_due_at, released_at,
    entered_by_name, released_by_name, notes, release_notes,
    actual_heating_minutes, heating_source, preheated_confirmation_reason
  ) values (
    v_org, v_import, v_machine, v_tool,
    null, null, null, 'released', 240,
    v_now - interval '4 hours', v_now - interval '1 second', v_now + interval '20 hours', v_now,
    v_user.display_name, v_user.display_name,
    'Aquecimento prévio informado pelo operador.',
    'LIBERAÇÃO POR AQUECIMENTO CONFIRMADO — ' || v_reason,
    240, 'confirmed_preheated', v_reason
  ) returning id into v_cycle_id;

  insert into public.tool_heating_cycle_orders (cycle_id, production_order_id)
  select v_cycle_id, unnest(p_order_ids);

  update public.production_orders po
     set last_status_reason = concat(
       'Ferramenta informada como aquecida por ', v_user.display_name, ': ', v_reason
     )
   where po.id = any(p_order_ids)
     and po.organization_id = v_org;

  insert into public.tool_heating_history (
    organization_id, cycle_id, event_type, actor_name, notes, snapshot
  )
  select v_org, v_cycle_id, 'released', v_user.display_name,
         'Aquecimento confirmado fora do controle do forno — ' || v_reason,
         to_jsonb(c)
  from public.tool_heating_cycles c
  where c.id = v_cycle_id;

  insert into private.local_user_audit (
    organization_id, actor_user_id, event_type, details
  ) values (
    v_org, v_actor, 'tool_preheated_confirmed',
    jsonb_build_object(
      'cycle_id', v_cycle_id,
      'tool_code', v_tool,
      'machine_code', v_machine,
      'order_ids', p_order_ids,
      'justification', v_reason
    )
  );

  return v_cycle_id;
end;
$$;

revoke all on function public.local_confirm_preheated_tool(text, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.local_confirm_preheated_tool(text, uuid[], text)
  to anon, authenticated;
