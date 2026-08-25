create or replace function public.local_list_users(p_token text)
returns table (
  id uuid, username text, email text, display_name text, role text, machine_codes text[],
  is_active boolean, must_change_password boolean, last_login_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare v_actor uuid;
declare v_org uuid;
begin
  v_actor := private.require_local_session(p_token, true);
  select lu.organization_id into v_org from private.local_users lu where lu.id = v_actor;
  return query select u.id, u.username, u.email, u.display_name, u.role, u.machine_codes, u.is_active, u.must_change_password, u.last_login_at, u.created_at, u.updated_at
    from private.local_users u where u.organization_id = v_org order by u.is_active desc, u.display_name;
end;
$$;

revoke all on function public.local_list_users(text) from public, anon, authenticated;
grant execute on function public.local_list_users(text) to anon, authenticated;
