create or replace function public.local_reset_password(
  p_token text,
  p_user_id uuid,
  p_password text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_updated integer;
  v_password_verified boolean;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id into v_org from private.local_users where id = v_actor;

  if char_length(coalesce(p_password, '')) < 8 then
    raise exception 'A senha temporária deve possuir pelo menos 8 caracteres.';
  end if;

  update private.local_users
     set password_hash = extensions.crypt(p_password, extensions.gen_salt('bf', 12)),
         must_change_password = true,
         failed_login_attempts = 0,
         locked_until = null,
         updated_at = now(),
         updated_by = v_actor
   where id = p_user_id and organization_id = v_org;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then raise exception 'Usuário não encontrado.'; end if;

  select extensions.crypt(p_password, password_hash) = password_hash
    into v_password_verified
    from private.local_users
   where id = p_user_id and organization_id = v_org;
  if v_password_verified is distinct from true then
    raise exception 'Não foi possível confirmar a gravação da nova senha.';
  end if;

  update private.local_sessions set revoked_at = now()
   where user_id = p_user_id and revoked_at is null;
  insert into private.local_user_audit
    (organization_id, actor_user_id, target_user_id, event_type, details)
  values
    (v_org, v_actor, p_user_id, 'password_reset', jsonb_build_object('password_verified', true));
end;
$$;

revoke all on function public.local_reset_password(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.local_reset_password(text, uuid, text)
  to anon, authenticated;
