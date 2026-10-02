create table public.production_overtime_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  work_date date not null,
  start_time time not null,
  end_time time not null,
  machine_codes text[] not null default '{}',
  reason text not null,
  is_active boolean not null default true,
  created_by_name text,
  cancelled_by_name text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_overtime_periods_distinct_times check (start_time <> end_time),
  constraint production_overtime_periods_reason_length check (char_length(btrim(reason)) between 8 and 500)
);

create index production_overtime_periods_org_date_idx
  on public.production_overtime_periods (organization_id, work_date, start_time)
  where is_active = true;

alter table public.production_overtime_periods enable row level security;
revoke all on public.production_overtime_periods from public, anon, authenticated;

create or replace function public.local_list_production_settings(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
begin
  -- A consulta da carga é liberada para usuários autenticados; somente os RPCs
  -- de inclusão e cancelamento abaixo exigem permissão administrativa.
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  return jsonb_build_object(
    'shifts', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.display_order, s.start_time)
      from public.work_shifts s where s.organization_id = v_org
    ), '[]'::jsonb),
    'settings', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.machine_code)
      from public.machine_load_settings x where x.organization_id = v_org
    ), '[]'::jsonb),
    'machines', coalesce((
      select jsonb_agg(jsonb_build_object('code', m.code, 'name', m.name) order by m.code)
      from public.machines m where m.organization_id = v_org and m.is_active = true
    ), '[]'::jsonb),
    'overtime_periods', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.work_date desc, o.start_time desc)
      from public.production_overtime_periods o where o.organization_id = v_org
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.local_register_overtime_period(
  p_token text,
  p_work_date date,
  p_start_time time,
  p_end_time time,
  p_machine_codes text[],
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_actor_name text;
  v_id uuid;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id, display_name into v_org, v_actor_name from private.local_users where id = v_actor;
  if p_work_date is null then raise exception 'Informe a data da hora extra.'; end if;
  if p_start_time is null or p_end_time is null or p_start_time = p_end_time then raise exception 'Os horários inicial e final precisam ser diferentes.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 8 and 500 then raise exception 'Informe um motivo entre 8 e 500 caracteres.'; end if;
  if exists (
    select 1 from unnest(coalesce(p_machine_codes, '{}')) code
    where not exists (select 1 from public.machines m where m.organization_id = v_org and m.code = code and m.is_active = true)
  ) then raise exception 'Uma das prensas informadas não está disponível.'; end if;

  insert into public.production_overtime_periods (organization_id, work_date, start_time, end_time, machine_codes, reason, created_by_name)
  values (v_org, p_work_date, p_start_time, p_end_time, coalesce(p_machine_codes, '{}'), btrim(p_reason), v_actor_name)
  returning id into v_id;

  insert into private.local_user_audit (organization_id, actor_user_id, event_type, details)
  values (v_org, v_actor, 'production_overtime_registered', jsonb_build_object('overtime_period_id', v_id, 'work_date', p_work_date, 'start_time', p_start_time, 'end_time', p_end_time, 'machine_codes', coalesce(p_machine_codes, '{}'), 'reason', btrim(p_reason)));
  return v_id;
end;
$$;

create or replace function public.local_cancel_overtime_period(p_token text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_actor_name text;
  v_before jsonb;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id, display_name into v_org, v_actor_name from private.local_users where id = v_actor;
  select to_jsonb(o) into v_before from public.production_overtime_periods o where o.id = p_id and o.organization_id = v_org for update;
  if v_before is null then raise exception 'Hora extra não encontrada.'; end if;
  update public.production_overtime_periods
     set is_active = false, cancelled_by_name = v_actor_name, cancelled_at = now(), updated_at = now()
   where id = p_id and organization_id = v_org and is_active = true;
  if not found then raise exception 'Esta hora extra já foi cancelada.'; end if;
  insert into private.local_user_audit (organization_id, actor_user_id, event_type, details)
  values (v_org, v_actor, 'production_overtime_cancelled', jsonb_build_object('overtime_period_id', p_id, 'before', v_before));
end;
$$;

revoke all on function public.local_register_overtime_period(text, date, time, time, text[], text) from public;
revoke all on function public.local_cancel_overtime_period(text, uuid) from public;
grant execute on function public.local_register_overtime_period(text, date, time, time, text[], text) to anon, authenticated;
grant execute on function public.local_cancel_overtime_period(text, uuid) to anon, authenticated;
