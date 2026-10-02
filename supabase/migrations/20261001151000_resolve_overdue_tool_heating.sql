-- A ferramenta que ultrapassa o limite de forno exige decisão humana.
-- Nenhuma rota libera ou cancela o ciclo sem motivo registrado.

alter table public.tool_heating_history
  drop constraint if exists tool_heating_history_event_type_check;
alter table public.tool_heating_history
  add constraint tool_heating_history_event_type_check
  check (event_type in ('entered', 'released', 'cancelled', 'released_at_risk', 'cooling_and_polishing'));

create or replace function public.resolve_tool_heating_limit(
  p_cycle_id uuid,
  p_actor text,
  p_action text,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cycle public.tool_heating_cycles;
  v_actual_minutes integer;
begin
  select * into v_cycle
  from public.tool_heating_cycles
  where id = p_cycle_id
  for update;

  if not found or v_cycle.status <> 'heating' then
    raise exception 'Este aquecimento não está disponível para decisão.';
  end if;

  if ((select auth.uid()) is null and v_cycle.organization_id <> '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
     or ((select auth.uid()) is not null and not exists (
       select 1 from public.organization_members om
       where om.organization_id = v_cycle.organization_id
         and om.user_id = (select auth.uid())
     )) then
    raise exception 'Acesso não autorizado para esta organização.';
  end if;

  if nullif(trim(p_actor), '') is null or length(trim(coalesce(p_reason, ''))) < 8 then
    raise exception 'Informe responsável e justificativa com pelo menos 8 caracteres.';
  end if;

  if now() < v_cycle.maximum_due_at then
    raise exception 'A ferramenta ainda não atingiu o limite máximo de permanência.';
  end if;

  if p_action not in ('release_at_risk', 'cool_and_polish') then
    raise exception 'Decisão de limite inválida.';
  end if;

  v_actual_minutes := greatest(0, floor(extract(epoch from (now() - v_cycle.entered_at)) / 60)::integer);

  if p_action = 'release_at_risk' then
    update public.tool_heating_cycles
       set status = 'released',
           released_at = now(),
           released_by_name = trim(p_actor),
           released_early = false,
           actual_heating_minutes = v_actual_minutes,
           release_notes = concat('LIBERAÇÃO SOB RISCO APÓS LIMITE — ', trim(p_reason))
     where id = p_cycle_id;

    update public.production_orders po
       set last_status_reason = concat('Ferramenta liberada sob risco após limite de forno por ', trim(p_actor), ': ', trim(p_reason))
      from public.tool_heating_cycle_orders co
     where co.cycle_id = p_cycle_id
       and po.id = co.production_order_id
       and po.status in ('planned', 'released', 'paused');

    insert into public.tool_heating_history (organization_id, cycle_id, event_type, actor_name, notes, snapshot)
    select organization_id, id, 'released_at_risk', trim(p_actor), trim(p_reason), to_jsonb(c)
    from public.tool_heating_cycles c where c.id = p_cycle_id;
  else
    update public.tool_heating_cycles
       set status = 'cancelled',
           cancelled_at = now(),
           cancelled_by_name = trim(p_actor),
           cancellation_reason = concat('RESFRIAR E POLIR — ', trim(p_reason))
     where id = p_cycle_id;

    update public.production_orders po
       set last_status_reason = concat('Ferramenta retirada do forno para resfriar e polir por ', trim(p_actor), ': ', trim(p_reason))
      from public.tool_heating_cycle_orders co
     where co.cycle_id = p_cycle_id
       and po.id = co.production_order_id
       and po.status in ('planned', 'released', 'paused');

    insert into public.tool_heating_history (organization_id, cycle_id, event_type, actor_name, notes, snapshot)
    select organization_id, id, 'cooling_and_polishing', trim(p_actor), trim(p_reason), to_jsonb(c)
    from public.tool_heating_cycles c where c.id = p_cycle_id;
  end if;
end;
$$;

revoke all on function public.resolve_tool_heating_limit(uuid, text, text, text) from public;
grant execute on function public.resolve_tool_heating_limit(uuid, text, text, text) to anon, authenticated;
