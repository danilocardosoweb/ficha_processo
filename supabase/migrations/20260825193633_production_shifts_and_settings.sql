create table public.work_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 0,
  machine_codes text[] not null default '{}',
  display_order smallint not null default 1,
  is_active boolean not null default true,
  created_by_name text,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint work_shifts_code_length check (char_length(btrim(code)) between 1 and 20),
  constraint work_shifts_name_length check (char_length(btrim(name)) between 2 and 80),
  constraint work_shifts_distinct_times check (start_time <> end_time),
  constraint work_shifts_break_range check (break_minutes between 0 and 720),
  constraint work_shifts_order_positive check (display_order > 0),
  unique (organization_id, code)
);

create index work_shifts_active_order_idx
  on public.work_shifts (organization_id, display_order, start_time)
  where is_active = true;

alter table public.work_shifts enable row level security;
revoke all on public.work_shifts from public, anon, authenticated;

insert into public.machine_load_settings (organization_id, machine_code)
select m.organization_id, m.code
from public.machines m
where m.is_active = true
on conflict (organization_id, machine_code) do nothing;

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
  v_actor := private.require_local_session(p_token, true);
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
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.local_save_work_shift(
  p_token text,
  p_id uuid,
  p_code text,
  p_name text,
  p_start_time time,
  p_end_time time,
  p_break_minutes integer,
  p_machine_codes text[],
  p_display_order smallint,
  p_is_active boolean
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
  v_before jsonb;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id, display_name into v_org, v_actor_name from private.local_users where id = v_actor;
  if char_length(btrim(coalesce(p_code, ''))) not between 1 and 20 then raise exception 'Código do turno inválido.'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80 then raise exception 'Nome do turno inválido.'; end if;
  if p_start_time = p_end_time then raise exception 'Os horários inicial e final precisam ser diferentes.'; end if;
  if coalesce(p_break_minutes, 0) not between 0 and 720 then raise exception 'Intervalo inválido.'; end if;
  if exists (
    select 1 from unnest(coalesce(p_machine_codes, '{}')) code
    where not exists (select 1 from public.machines m where m.organization_id = v_org and m.code = code and m.is_active = true)
  ) then raise exception 'Uma das prensas informadas não está disponível.'; end if;

  if p_id is null then
    insert into public.work_shifts (organization_id, code, name, start_time, end_time, break_minutes, machine_codes, display_order, is_active, created_by_name, updated_by_name)
    values (v_org, upper(btrim(p_code)), btrim(p_name), p_start_time, p_end_time, coalesce(p_break_minutes, 0), coalesce(p_machine_codes, '{}'), coalesce(p_display_order, 1), coalesce(p_is_active, true), v_actor_name, v_actor_name)
    returning id into v_id;
    insert into private.local_user_audit (organization_id, actor_user_id, event_type, details)
    values (v_org, v_actor, 'work_shift_created', jsonb_build_object('shift_id', v_id, 'code', upper(btrim(p_code))));
  else
    select to_jsonb(s) into v_before from public.work_shifts s where s.id = p_id and s.organization_id = v_org for update;
    if v_before is null then raise exception 'Turno não encontrado.'; end if;
    update public.work_shifts
       set code = upper(btrim(p_code)), name = btrim(p_name), start_time = p_start_time, end_time = p_end_time,
           break_minutes = coalesce(p_break_minutes, 0), machine_codes = coalesce(p_machine_codes, '{}'),
           display_order = coalesce(p_display_order, 1), is_active = coalesce(p_is_active, true),
           updated_by_name = v_actor_name, updated_at = now()
     where id = p_id and organization_id = v_org
     returning id into v_id;
    insert into private.local_user_audit (organization_id, actor_user_id, event_type, details)
    values (v_org, v_actor, 'work_shift_updated', jsonb_build_object('shift_id', v_id, 'before', v_before, 'after', (select to_jsonb(s) from public.work_shifts s where s.id = v_id)));
  end if;
  return v_id;
end;
$$;

create or replace function public.local_save_machine_load_setting(
  p_token text,
  p_machine_code text,
  p_default_productivity_kg_h numeric,
  p_billet_bar_weight_kg numeric,
  p_extrusion_efficiency numeric,
  p_setup_minutes integer,
  p_alloy_change_minutes integer,
  p_tool_heating_minutes integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_before jsonb;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id into v_org from private.local_users where id = v_actor;
  if not exists (select 1 from public.machines m where m.organization_id = v_org and m.code = p_machine_code and m.is_active = true) then raise exception 'Prensa não encontrada.'; end if;
  if coalesce(p_default_productivity_kg_h, 0) <= 0 then raise exception 'A produtividade padrão precisa ser maior que zero.'; end if;
  if coalesce(p_billet_bar_weight_kg, 0) <= 0 then raise exception 'O peso da barra precisa ser maior que zero.'; end if;
  if coalesce(p_extrusion_efficiency, 0) <= 0 or p_extrusion_efficiency > 1 then raise exception 'A eficiência precisa estar entre 0 e 100%%.'; end if;
  select to_jsonb(x) into v_before from public.machine_load_settings x where x.organization_id = v_org and x.machine_code = p_machine_code;
  insert into public.machine_load_settings (organization_id, machine_code, default_productivity_kg_h, billet_bar_weight_kg, extrusion_efficiency, setup_minutes, alloy_change_minutes, tool_heating_minutes, updated_at)
  values (v_org, p_machine_code, p_default_productivity_kg_h, p_billet_bar_weight_kg, p_extrusion_efficiency, p_setup_minutes, p_alloy_change_minutes, p_tool_heating_minutes, now())
  on conflict (organization_id, machine_code) do update set
    default_productivity_kg_h = excluded.default_productivity_kg_h,
    billet_bar_weight_kg = excluded.billet_bar_weight_kg,
    extrusion_efficiency = excluded.extrusion_efficiency,
    setup_minutes = excluded.setup_minutes,
    alloy_change_minutes = excluded.alloy_change_minutes,
    tool_heating_minutes = excluded.tool_heating_minutes,
    updated_at = now();
  insert into private.local_user_audit (organization_id, actor_user_id, event_type, details)
  values (v_org, v_actor, 'machine_load_setting_updated', jsonb_build_object('machine_code', p_machine_code, 'before', v_before, 'after', (select to_jsonb(x) from public.machine_load_settings x where x.organization_id = v_org and x.machine_code = p_machine_code)));
end;
$$;

revoke all on function public.local_list_production_settings(text) from public;
revoke all on function public.local_save_work_shift(text, uuid, text, text, time, time, integer, text[], smallint, boolean) from public;
revoke all on function public.local_save_machine_load_setting(text, text, numeric, numeric, numeric, integer, integer, integer) from public;
grant execute on function public.local_list_production_settings(text) to anon, authenticated;
grant execute on function public.local_save_work_shift(text, uuid, text, text, time, time, integer, text[], smallint, boolean) to anon, authenticated;
grant execute on function public.local_save_machine_load_setting(text, text, numeric, numeric, numeric, integer, integer, integer) to anon, authenticated;
