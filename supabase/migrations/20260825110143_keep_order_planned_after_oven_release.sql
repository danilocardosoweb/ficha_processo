-- A liberação do forno habilita o início, mas não inicia nem muda o status da ordem.
create or replace function public.release_tool_heating(
  p_cycle_id uuid,
  p_actor text,
  p_notes text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cycle public.tool_heating_cycles;
  v_early boolean;
  v_actual_minutes integer;
  v_release_note text;
begin
  select * into v_cycle
  from public.tool_heating_cycles
  where id = p_cycle_id
  for update;

  if not found or v_cycle.status <> 'heating' then
    raise exception 'Este aquecimento não está disponível para liberação.';
  end if;

  if ((select auth.uid()) is null and v_cycle.organization_id <> '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
     or ((select auth.uid()) is not null and not exists (
       select 1
       from public.organization_members om
       where om.organization_id = v_cycle.organization_id
         and om.user_id = (select auth.uid())
     )) then
    raise exception 'Acesso não autorizado para esta organização.';
  end if;

  if nullif(trim(p_actor), '') is null then
    raise exception 'Informe o responsável pela liberação.';
  end if;

  if now() >= v_cycle.maximum_due_at then
    raise exception 'Limite de 24 horas excedido. Retire e bloqueie a ferramenta para avaliação.';
  end if;

  v_early := now() < v_cycle.expected_ready_at;
  if v_early and length(coalesce(trim(p_notes), '')) < 8 then
    raise exception 'Informe uma justificativa para liberar antes do tempo mínimo.';
  end if;

  v_actual_minutes := greatest(
    0,
    floor(extract(epoch from (now() - v_cycle.entered_at)) / 60)::integer
  );
  v_release_note := case
    when v_early then concat('LIBERAÇÃO ANTECIPADA — ', trim(p_notes))
    else nullif(trim(p_notes), '')
  end;

  update public.tool_heating_cycles
     set status = 'released',
         released_at = now(),
         released_by_name = trim(p_actor),
         released_early = v_early,
         actual_heating_minutes = v_actual_minutes,
         release_notes = v_release_note
   where id = p_cycle_id;

  update public.production_orders po
     set last_status_reason = case
       when v_early then concat('Ferramenta liberada antecipadamente do forno por ', trim(p_actor), ': ', trim(p_notes))
       else concat('Ferramenta liberada do forno por ', trim(p_actor))
     end
    from public.tool_heating_cycle_orders co
   where co.cycle_id = p_cycle_id
     and po.id = co.production_order_id
     and po.status in ('planned', 'released', 'paused');

  insert into public.tool_heating_history (
    organization_id, cycle_id, event_type, actor_name, notes, snapshot
  )
  select organization_id, id, 'released', trim(p_actor), v_release_note, to_jsonb(c)
  from public.tool_heating_cycles c
  where c.id = p_cycle_id;
end;
$$;

revoke all on function public.release_tool_heating(uuid, text, text) from public;
grant execute on function public.release_tool_heating(uuid, text, text) to anon, authenticated;
