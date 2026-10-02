-- Mantém o comportamento já existente: encerrar uma parada vinculada também
-- encerra o chamado de manutenção que foi aberto automaticamente por ela.
create or replace function public.local_close_machine_stoppage(
  p_token text, p_stoppage_id uuid, p_ended_at timestamptz, p_closing_observation text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid; v_user private.local_users%rowtype; v_row public.machine_stoppages%rowtype; v_duration numeric;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor and is_active;
  if v_user.id is null or v_user.role not in ('admin', 'manager', 'operator', 'maintenance', 'pcp') then
    raise exception 'Acesso não autorizado.' using errcode = '42501';
  end if;
  select * into v_row from public.machine_stoppages where id = p_stoppage_id and organization_id = v_user.organization_id and not is_deleted for update;
  if v_row.id is null then raise exception 'Parada não encontrada.' using errcode = 'P0002'; end if;
  if v_row.status <> 'open' then raise exception 'Esta parada já foi encerrada.' using errcode = 'P0001'; end if;
  if p_ended_at is null or p_ended_at < v_row.started_at then raise exception 'O término não pode ser anterior ao início da parada.' using errcode = '22007'; end if;
  if p_ended_at > now() + interval '1 minute' then raise exception 'O término não pode estar no futuro.' using errcode = '22007'; end if;
  v_duration := round((extract(epoch from (p_ended_at - v_row.started_at)) / 60.0)::numeric, 2);
  update public.machine_stoppages
     set status = 'closed', ended_at = p_ended_at, duration_minutes = v_duration,
         closing_observation = nullif(btrim(coalesce(p_closing_observation, '')), ''),
         closed_by_name = v_user.display_name, closed_by_user_id = v_actor,
         updated_by_name = v_user.display_name, updated_by_user_id = v_actor
   where id = v_row.id;
  if v_row.maintenance_work_order_id is not null then
    update public.maintenance_work_orders
       set status = 'completed', completed_at = p_ended_at
     where id = v_row.maintenance_work_order_id
       and status in ('open', 'in_progress', 'waiting');
  end if;
end;
$$;
