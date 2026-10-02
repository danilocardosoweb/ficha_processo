create table if not exists private.local_user_access_overrides (
  user_id uuid not null references private.local_users(id) on delete cascade,
  area text not null,
  enabled boolean not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, area)
);

revoke all on private.local_user_access_overrides from public, anon, authenticated;

create or replace function public.local_list_user_access_overrides(p_token text)
returns table(user_id uuid, area text, enabled boolean)
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid; v_org uuid;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id into v_org from private.local_users where id = v_actor;
  return query select o.user_id, o.area, o.enabled
    from private.local_user_access_overrides o
    join private.local_users u on u.id = o.user_id
   where u.organization_id = v_org;
end; $$;

create or replace function public.local_set_user_access_overrides(
  p_token text, p_user_id uuid, p_overrides jsonb
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid; v_org uuid; item jsonb;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id into v_org from private.local_users where id = v_actor;
  if not exists (select 1 from private.local_users where id = p_user_id and organization_id = v_org) then
    raise exception 'Usuário não encontrado.';
  end if;
  delete from private.local_user_access_overrides where user_id = p_user_id;
  for item in select * from jsonb_array_elements(coalesce(p_overrides, '[]'::jsonb)) loop
    if jsonb_typeof(item) = 'object' and item ? 'area' and item ? 'enabled' then
      insert into private.local_user_access_overrides(user_id, area, enabled)
      values (p_user_id, item->>'area', (item->>'enabled')::boolean);
    end if;
  end loop;
end; $$;

revoke all on function public.local_list_user_access_overrides(text) from public, anon, authenticated;
revoke all on function public.local_set_user_access_overrides(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.local_list_user_access_overrides(text) to anon, authenticated;
grant execute on function public.local_set_user_access_overrides(text, uuid, jsonb) to anon, authenticated;
