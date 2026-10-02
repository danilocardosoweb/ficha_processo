create table if not exists public.production_calendar_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  saturday_enabled boolean not null default false,
  sunday_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by_name text
);
alter table public.production_calendar_settings enable row level security;
revoke all on public.production_calendar_settings from public, anon, authenticated;

create or replace function public.local_save_weekend_calendar(p_token text, p_saturday_enabled boolean, p_sunday_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_org uuid;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id into v_org from private.local_users where id = v_actor;
  insert into public.production_calendar_settings(organization_id,saturday_enabled,sunday_enabled,updated_by_name)
  values(v_org,coalesce(p_saturday_enabled,false),coalesce(p_sunday_enabled,false),(select display_name from private.local_users where id=v_actor))
  on conflict (organization_id) do update set saturday_enabled=excluded.saturday_enabled,sunday_enabled=excluded.sunday_enabled,updated_at=now(),updated_by_name=excluded.updated_by_name;
end; $$;
grant execute on function public.local_save_weekend_calendar(text,boolean,boolean) to anon, authenticated;

create or replace function public.local_get_weekend_calendar(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_org uuid; v_result jsonb;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id into v_org from private.local_users where id=v_actor;
  select jsonb_build_object('saturday_enabled', coalesce(saturday_enabled,false), 'sunday_enabled', coalesce(sunday_enabled,false)) into v_result from public.production_calendar_settings where organization_id=v_org;
  return coalesce(v_result, '{"saturday_enabled":false,"sunday_enabled":false}'::jsonb);
end; $$;
grant execute on function public.local_get_weekend_calendar(text) to anon, authenticated;
