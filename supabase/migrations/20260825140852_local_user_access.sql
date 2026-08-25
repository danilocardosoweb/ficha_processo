create schema if not exists private;

create table private.local_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  username text not null,
  email text,
  display_name text not null,
  password_hash text not null,
  role text not null default 'operator',
  machine_codes text[] not null default '{}',
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  failed_login_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references private.local_users(id),
  updated_by uuid references private.local_users(id),
  constraint local_users_username_length check (char_length(btrim(username)) between 3 and 60),
  constraint local_users_display_name_length check (char_length(btrim(display_name)) between 2 and 120),
  constraint local_users_role_check check (role in ('admin','pcp','operator','engineering','maintenance','quality','viewer')),
  constraint local_users_failed_attempts_check check (failed_login_attempts >= 0)
);

create unique index local_users_organization_username_uidx
  on private.local_users (organization_id, lower(username));
create unique index local_users_organization_email_uidx
  on private.local_users (organization_id, lower(email)) where email is not null;
create index local_users_organization_active_idx
  on private.local_users (organization_id, is_active, display_name);

create table private.local_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references private.local_users(id) on delete cascade,
  token_hash bytea not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  ip_address inet,
  user_agent text,
  constraint local_sessions_expiry_check check (expires_at > created_at)
);

create index local_sessions_active_lookup_idx
  on private.local_sessions (token_hash, expires_at) where revoked_at is null;
create index local_sessions_user_idx on private.local_sessions (user_id, created_at desc);

create table private.local_user_audit (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  actor_user_id uuid references private.local_users(id) on delete set null,
  target_user_id uuid references private.local_users(id) on delete set null,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index local_user_audit_org_time_idx
  on private.local_user_audit (organization_id, occurred_at desc);
create index local_user_audit_target_time_idx
  on private.local_user_audit (target_user_id, occurred_at desc);

alter table private.local_users enable row level security;
alter table private.local_sessions enable row level security;
alter table private.local_user_audit enable row level security;

revoke all on schema private from public, anon, authenticated;
revoke all on all tables in schema private from public, anon, authenticated;

create or replace function private.require_local_session(p_token text, p_admin boolean default false)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  if nullif(btrim(p_token), '') is null then
    raise exception 'Sessão inválida.' using errcode = '28000';
  end if;

  select u.id
    into v_user_id
    from private.local_sessions s
    join private.local_users u on u.id = s.user_id
   where s.token_hash = digest(p_token, 'sha256')
     and s.revoked_at is null
     and s.expires_at > now()
     and u.is_active
     and (not p_admin or u.role = 'admin')
   limit 1;

  if v_user_id is null then
    raise exception 'Sessão inválida ou acesso não autorizado.' using errcode = '28000';
  end if;

  update private.local_sessions
     set last_seen_at = now()
   where token_hash = digest(p_token, 'sha256')
     and revoked_at is null;

  return v_user_id;
end;
$$;

create or replace function public.local_login(
  p_login text,
  p_password text,
  p_ip text default null,
  p_user_agent text default null
)
returns table (
  session_token text,
  user_id uuid,
  organization_id uuid,
  username text,
  display_name text,
  role text,
  machine_codes text[],
  must_change_password boolean,
  error_code text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user private.local_users%rowtype;
  v_token text;
  v_ip inet;
begin
  delete from private.local_sessions where expires_at <= now() or revoked_at is not null and revoked_at < now() - interval '7 days';

  select * into v_user
    from private.local_users u
   where lower(u.username) = lower(btrim(p_login))
      or lower(coalesce(u.email, '')) = lower(btrim(p_login))
   order by u.is_active desc
   limit 1;

  if v_user.id is null then
    perform crypt(coalesce(p_password, ''), gen_salt('bf', 10));
    return query select null::text, null::uuid, null::uuid, null::text, null::text, null::text, null::text[], false, 'INVALID_CREDENTIALS'::text;
    return;
  end if;

  if not v_user.is_active then
    return query select null::text, v_user.id, v_user.organization_id, v_user.username, v_user.display_name, v_user.role, v_user.machine_codes, v_user.must_change_password, 'INACTIVE'::text;
    return;
  end if;

  if v_user.locked_until is not null and v_user.locked_until > now() then
    return query select null::text, v_user.id, v_user.organization_id, v_user.username, v_user.display_name, v_user.role, v_user.machine_codes, v_user.must_change_password, 'LOCKED'::text;
    return;
  end if;

  if crypt(coalesce(p_password, ''), v_user.password_hash) <> v_user.password_hash then
    update private.local_users u
       set failed_login_attempts = u.failed_login_attempts + 1,
           locked_until = case when u.failed_login_attempts + 1 >= 5 then now() + interval '15 minutes' else null end,
           updated_at = now()
     where u.id = v_user.id;
    insert into private.local_user_audit (organization_id, actor_user_id, target_user_id, event_type)
    values (v_user.organization_id, v_user.id, v_user.id, 'login_failed');
    return query select null::text, v_user.id, v_user.organization_id, v_user.username, v_user.display_name, v_user.role, v_user.machine_codes, v_user.must_change_password, 'INVALID_CREDENTIALS'::text;
    return;
  end if;

  begin v_ip := nullif(p_ip, '')::inet; exception when others then v_ip := null; end;
  v_token := encode(gen_random_bytes(32), 'hex');
  insert into private.local_sessions (user_id, token_hash, expires_at, ip_address, user_agent)
  values (v_user.id, digest(v_token, 'sha256'), now() + interval '12 hours', v_ip, left(p_user_agent, 500));
  update private.local_users set failed_login_attempts = 0, locked_until = null, last_login_at = now(), updated_at = now() where id = v_user.id;
  insert into private.local_user_audit (organization_id, actor_user_id, target_user_id, event_type)
  values (v_user.organization_id, v_user.id, v_user.id, 'login_success');

  return query select v_token, v_user.id, v_user.organization_id, v_user.username, v_user.display_name, v_user.role, v_user.machine_codes, v_user.must_change_password, null::text;
end;
$$;

create or replace function public.local_get_session(p_token text)
returns table (
  user_id uuid,
  organization_id uuid,
  username text,
  email text,
  display_name text,
  role text,
  machine_codes text[],
  must_change_password boolean,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  return query
  select u.id, u.organization_id, u.username, u.email, u.display_name, u.role, u.machine_codes, u.must_change_password, s.expires_at
    from private.local_users u
    join private.local_sessions s on s.user_id = u.id
   where u.id = v_actor and s.token_hash = digest(p_token, 'sha256') and s.revoked_at is null;
end;
$$;

create or replace function public.local_logout(p_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid;
declare v_org uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  update private.local_sessions set revoked_at = now() where token_hash = digest(p_token, 'sha256') and revoked_at is null;
  insert into private.local_user_audit (organization_id, actor_user_id, target_user_id, event_type) values (v_org, v_actor, v_actor, 'logout');
end;
$$;

create or replace function public.local_list_users(p_token text)
returns table (
  id uuid, username text, email text, display_name text, role text, machine_codes text[],
  is_active boolean, must_change_password boolean, last_login_at timestamptz,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid;
declare v_org uuid;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id into v_org from private.local_users where id = v_actor;
  return query select u.id, u.username, u.email, u.display_name, u.role, u.machine_codes, u.is_active, u.must_change_password, u.last_login_at, u.created_at, u.updated_at
    from private.local_users u where u.organization_id = v_org order by u.is_active desc, u.display_name;
end;
$$;

create or replace function public.local_create_user(
  p_token text, p_username text, p_email text, p_display_name text, p_role text,
  p_machine_codes text[], p_password text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid;
declare v_org uuid;
declare v_id uuid;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id into v_org from private.local_users where id = v_actor;
  if char_length(coalesce(p_password, '')) < 8 then raise exception 'A senha temporária deve possuir pelo menos 8 caracteres.'; end if;
  if p_role not in ('admin','pcp','operator','engineering','maintenance','quality','viewer') then raise exception 'Perfil inválido.'; end if;
  insert into private.local_users (organization_id, username, email, display_name, password_hash, role, machine_codes, created_by, updated_by)
  values (v_org, lower(btrim(p_username)), nullif(lower(btrim(p_email)), ''), btrim(p_display_name), crypt(p_password, gen_salt('bf', 12)), p_role, coalesce(p_machine_codes, '{}'), v_actor, v_actor)
  returning id into v_id;
  insert into private.local_user_audit (organization_id, actor_user_id, target_user_id, event_type, details)
  values (v_org, v_actor, v_id, 'user_created', jsonb_build_object('role', p_role, 'machine_codes', coalesce(p_machine_codes, '{}')));
  return v_id;
end;
$$;

create or replace function public.local_update_user(
  p_token text, p_user_id uuid, p_email text, p_display_name text, p_role text,
  p_machine_codes text[], p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid;
declare v_org uuid;
declare v_before jsonb;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id into v_org from private.local_users where id = v_actor;
  if p_role not in ('admin','pcp','operator','engineering','maintenance','quality','viewer') then raise exception 'Perfil inválido.'; end if;
  if p_user_id = v_actor and not p_is_active then raise exception 'Você não pode desativar o próprio usuário.'; end if;
  select jsonb_build_object('email', email, 'display_name', display_name, 'role', role, 'machine_codes', machine_codes, 'is_active', is_active)
    into v_before from private.local_users where id = p_user_id and organization_id = v_org;
  if v_before is null then raise exception 'Usuário não encontrado.'; end if;
  update private.local_users set email = nullif(lower(btrim(p_email)), ''), display_name = btrim(p_display_name), role = p_role,
    machine_codes = coalesce(p_machine_codes, '{}'), is_active = p_is_active, updated_at = now(), updated_by = v_actor
  where id = p_user_id and organization_id = v_org;
  if not p_is_active then update private.local_sessions set revoked_at = now() where user_id = p_user_id and revoked_at is null; end if;
  insert into private.local_user_audit (organization_id, actor_user_id, target_user_id, event_type, details)
  values (v_org, v_actor, p_user_id, 'user_updated', jsonb_build_object('before', v_before, 'after', jsonb_build_object('email', p_email, 'display_name', p_display_name, 'role', p_role, 'machine_codes', coalesce(p_machine_codes, '{}'), 'is_active', p_is_active)));
end;
$$;

create or replace function public.local_reset_password(p_token text, p_user_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid;
declare v_org uuid;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id into v_org from private.local_users where id = v_actor;
  if char_length(coalesce(p_password, '')) < 8 then raise exception 'A senha temporária deve possuir pelo menos 8 caracteres.'; end if;
  update private.local_users set password_hash = crypt(p_password, gen_salt('bf', 12)), must_change_password = true,
    failed_login_attempts = 0, locked_until = null, updated_at = now(), updated_by = v_actor
  where id = p_user_id and organization_id = v_org;
  if not found then raise exception 'Usuário não encontrado.'; end if;
  update private.local_sessions set revoked_at = now() where user_id = p_user_id and revoked_at is null;
  insert into private.local_user_audit (organization_id, actor_user_id, target_user_id, event_type) values (v_org, v_actor, p_user_id, 'password_reset');
end;
$$;

create or replace function public.local_update_profile(p_token text, p_display_name text, p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid;
declare v_org uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  update private.local_users set display_name = btrim(p_display_name), email = nullif(lower(btrim(p_email)), ''), updated_at = now(), updated_by = v_actor where id = v_actor;
  insert into private.local_user_audit (organization_id, actor_user_id, target_user_id, event_type) values (v_org, v_actor, v_actor, 'profile_updated');
end;
$$;

create or replace function public.local_change_password(p_token text, p_current_password text, p_new_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid;
declare v_user private.local_users%rowtype;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  if crypt(coalesce(p_current_password, ''), v_user.password_hash) <> v_user.password_hash then raise exception 'Senha atual incorreta.'; end if;
  if char_length(coalesce(p_new_password, '')) < 8 then raise exception 'A nova senha deve possuir pelo menos 8 caracteres.'; end if;
  update private.local_users set password_hash = crypt(p_new_password, gen_salt('bf', 12)), must_change_password = false, updated_at = now(), updated_by = v_actor where id = v_actor;
  insert into private.local_user_audit (organization_id, actor_user_id, target_user_id, event_type) values (v_user.organization_id, v_actor, v_actor, 'password_changed');
end;
$$;

revoke all on function public.local_login(text,text,text,text) from public, anon, authenticated;
revoke all on function public.local_get_session(text) from public, anon, authenticated;
revoke all on function public.local_logout(text) from public, anon, authenticated;
revoke all on function public.local_list_users(text) from public, anon, authenticated;
revoke all on function public.local_create_user(text,text,text,text,text,text[],text) from public, anon, authenticated;
revoke all on function public.local_update_user(text,uuid,text,text,text,text[],boolean) from public, anon, authenticated;
revoke all on function public.local_reset_password(text,uuid,text) from public, anon, authenticated;
revoke all on function public.local_update_profile(text,text,text) from public, anon, authenticated;
revoke all on function public.local_change_password(text,text,text) from public, anon, authenticated;

grant execute on function public.local_login(text,text,text,text) to anon, authenticated;
grant execute on function public.local_get_session(text) to anon, authenticated;
grant execute on function public.local_logout(text) to anon, authenticated;
grant execute on function public.local_list_users(text) to anon, authenticated;
grant execute on function public.local_create_user(text,text,text,text,text,text[],text) to anon, authenticated;
grant execute on function public.local_update_user(text,uuid,text,text,text,text[],boolean) to anon, authenticated;
grant execute on function public.local_reset_password(text,uuid,text) to anon, authenticated;
grant execute on function public.local_update_profile(text,text,text) to anon, authenticated;
grant execute on function public.local_change_password(text,text,text) to anon, authenticated;

comment on table private.local_users is 'Usuários locais do AlumMES. Senhas armazenadas somente como hash bcrypt.';
comment on table private.local_sessions is 'Sessões locais com token opaco armazenado somente como hash SHA-256.';
comment on table private.local_user_audit is 'Trilha de auditoria de acessos e administração de usuários.';
