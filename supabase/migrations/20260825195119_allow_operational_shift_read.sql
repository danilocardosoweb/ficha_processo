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
  -- Any authenticated local user may read the production calendar.
  -- Write RPCs remain restricted to administrators.
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
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.local_list_production_settings(text) from public;
grant execute on function public.local_list_production_settings(text) to anon, authenticated;
