create table private.operational_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  body text not null,
  priority text not null default 'attention',
  audience_type text not null default 'all',
  target_user_id uuid references private.local_users(id) on delete cascade,
  target_role text,
  target_machine_code text,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  requires_ack boolean not null default false,
  is_active boolean not null default true,
  created_by uuid not null references private.local_users(id) on delete restrict,
  created_by_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_messages_title_length check (char_length(btrim(title)) between 3 and 100),
  constraint operational_messages_body_length check (char_length(btrim(body)) between 3 and 1000),
  constraint operational_messages_priority_check check (priority in ('info','attention','urgent','critical')),
  constraint operational_messages_audience_check check (audience_type in ('all','user','role','press')),
  constraint operational_messages_role_check check (target_role is null or target_role in ('admin','pcp','operator','engineering','maintenance','quality','viewer')),
  constraint operational_messages_target_check check (
    (audience_type = 'all' and target_user_id is null and target_role is null and target_machine_code is null)
    or (audience_type = 'user' and target_user_id is not null and target_role is null and target_machine_code is null)
    or (audience_type = 'role' and target_user_id is null and target_role is not null and target_machine_code is null)
    or (audience_type = 'press' and target_user_id is null and target_role is null and nullif(btrim(target_machine_code), '') is not null)
  ),
  constraint operational_messages_period_check check (expires_at is null or expires_at > starts_at)
);

create table private.operational_message_receipts (
  message_id uuid not null references private.operational_messages(id) on delete cascade,
  user_id uuid not null references private.local_users(id) on delete cascade,
  read_at timestamptz,
  acknowledged_at timestamptz,
  dismissed_at timestamptz,
  primary key (message_id, user_id)
);

create index operational_messages_org_created_idx
  on private.operational_messages (organization_id, created_at desc);
create index operational_messages_target_user_idx
  on private.operational_messages (target_user_id, created_at desc) where target_user_id is not null and is_active;
create index operational_messages_active_window_idx
  on private.operational_messages (organization_id, starts_at, expires_at) where is_active;
create index operational_messages_press_idx
  on private.operational_messages (organization_id, target_machine_code, created_at desc) where audience_type = 'press' and is_active;
create index operational_message_receipts_user_idx
  on private.operational_message_receipts (user_id, read_at, acknowledged_at);

alter table private.operational_messages enable row level security;
alter table private.operational_message_receipts enable row level security;
revoke all on private.operational_messages, private.operational_message_receipts from public, anon, authenticated;

create or replace function private.can_receive_operational_message(
  p_message private.operational_messages,
  p_user private.local_users
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select p_message.organization_id = p_user.organization_id
    and p_message.is_active
    and p_message.starts_at <= now()
    and (p_message.expires_at is null or p_message.expires_at > now())
    and (
      p_message.audience_type = 'all'
      or (p_message.audience_type = 'user' and p_message.target_user_id = p_user.id)
      or (p_message.audience_type = 'role' and p_message.target_role = p_user.role)
      or (p_message.audience_type = 'press' and p_message.target_machine_code = any(coalesce(p_user.machine_codes, '{}'::text[])))
    );
$$;

create or replace function public.local_list_operational_messages(p_token text)
returns table (
  id uuid, title text, body text, priority text, audience_type text,
  target_label text, starts_at timestamptz, expires_at timestamptz,
  requires_ack boolean, created_by_name text, created_at timestamptz,
  read_at timestamptz, acknowledged_at timestamptz, dismissed_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where private.local_users.id = v_actor;
  return query
  select m.id, m.title, m.body, m.priority, m.audience_type,
    case m.audience_type
      when 'all' then 'Toda a operação'
      when 'user' then coalesce(tu.display_name, 'Usuário')
      when 'role' then m.target_role
      when 'press' then 'Prensa ' || m.target_machine_code
    end,
    m.starts_at, m.expires_at, m.requires_ack, m.created_by_name, m.created_at,
    r.read_at, r.acknowledged_at, r.dismissed_at
  from private.operational_messages m
  left join private.local_users tu on tu.id = m.target_user_id
  left join private.operational_message_receipts r on r.message_id = m.id and r.user_id = v_actor
  where private.can_receive_operational_message(m, v_user)
    and r.dismissed_at is null
  order by
    case m.priority when 'critical' then 1 when 'urgent' then 2 when 'attention' then 3 else 4 end,
    m.created_at desc
  limit 100;
end;
$$;

create or replace function public.local_list_operational_message_targets(p_token text)
returns table (id uuid, display_name text, username text, role text, machine_codes text[])
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_role text;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id, private.local_users.role into v_org, v_role from private.local_users where private.local_users.id = v_actor;
  if v_role not in ('admin', 'pcp') then raise exception 'Acesso não autorizado.' using errcode = '42501'; end if;
  return query
  select u.id, u.display_name, u.username, u.role, u.machine_codes
  from private.local_users u
  where u.organization_id = v_org and u.is_active
  order by u.display_name;
end;
$$;

create or replace function public.local_create_operational_message(
  p_token text,
  p_title text,
  p_body text,
  p_priority text,
  p_audience_type text,
  p_target_user_id uuid default null,
  p_target_role text default null,
  p_target_machine_code text default null,
  p_expires_at timestamptz default null,
  p_requires_ack boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_id uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where private.local_users.id = v_actor;
  if v_user.role not in ('admin', 'pcp') then raise exception 'Acesso não autorizado.' using errcode = '42501'; end if;
  if p_priority not in ('info','attention','urgent','critical') then raise exception 'Prioridade inválida.'; end if;
  if p_audience_type not in ('all','user','role','press') then raise exception 'Destino inválido.'; end if;
  if p_audience_type = 'user' and not exists (
    select 1 from private.local_users where id = p_target_user_id and organization_id = v_user.organization_id and is_active
  ) then raise exception 'Usuário de destino inválido.'; end if;

  insert into private.operational_messages (
    organization_id, title, body, priority, audience_type,
    target_user_id, target_role, target_machine_code, expires_at,
    requires_ack, created_by, created_by_name
  ) values (
    v_user.organization_id, btrim(p_title), btrim(p_body), p_priority, p_audience_type,
    case when p_audience_type = 'user' then p_target_user_id end,
    case when p_audience_type = 'role' then p_target_role end,
    case when p_audience_type = 'press' then regexp_replace(btrim(p_target_machine_code), '^P', '', 'i') end,
    p_expires_at, coalesce(p_requires_ack, false), v_actor, v_user.display_name
  ) returning private.operational_messages.id into v_id;

  insert into private.local_user_audit (organization_id, actor_user_id, event_type, details)
  values (v_user.organization_id, v_actor, 'operational_message_created', jsonb_build_object('message_id', v_id, 'audience_type', p_audience_type, 'priority', p_priority));
  return v_id;
end;
$$;

create or replace function public.local_mark_operational_message(p_token text, p_message_id uuid, p_action text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_message private.operational_messages%rowtype;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where private.local_users.id = v_actor;
  select * into v_message from private.operational_messages where id = p_message_id;
  if v_message.id is null or not private.can_receive_operational_message(v_message, v_user) then
    raise exception 'Mensagem não encontrada.' using errcode = '42501';
  end if;
  if p_action not in ('read','acknowledge','dismiss') then raise exception 'Ação inválida.'; end if;
  if p_action = 'dismiss' and v_message.requires_ack then raise exception 'Confirme a leitura antes de dispensar este alerta.'; end if;

  insert into private.operational_message_receipts (message_id, user_id, read_at, acknowledged_at, dismissed_at)
  values (
    p_message_id, v_actor, now(),
    case when p_action = 'acknowledge' then now() end,
    case when p_action = 'dismiss' then now() end
  )
  on conflict (message_id, user_id) do update set
    read_at = coalesce(private.operational_message_receipts.read_at, excluded.read_at),
    acknowledged_at = case when p_action = 'acknowledge' then now() else private.operational_message_receipts.acknowledged_at end,
    dismissed_at = case when p_action = 'dismiss' then now() else private.operational_message_receipts.dismissed_at end;
end;
$$;

create or replace function public.local_list_sent_operational_messages(p_token text)
returns table (
  id uuid, title text, body text, priority text, audience_type text, target_label text,
  expires_at timestamptz, requires_ack boolean, is_active boolean, created_at timestamptz,
  read_count bigint, acknowledged_count bigint
)
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where private.local_users.id = v_actor;
  if v_user.role not in ('admin', 'pcp') then raise exception 'Acesso não autorizado.' using errcode = '42501'; end if;
  return query
  select m.id, m.title, m.body, m.priority, m.audience_type,
    case m.audience_type when 'all' then 'Toda a operação' when 'user' then coalesce(tu.display_name, 'Usuário') when 'role' then m.target_role when 'press' then 'Prensa ' || m.target_machine_code end,
    m.expires_at, m.requires_ack, m.is_active, m.created_at,
    count(r.user_id) filter (where r.read_at is not null),
    count(r.user_id) filter (where r.acknowledged_at is not null)
  from private.operational_messages m
  left join private.local_users tu on tu.id = m.target_user_id
  left join private.operational_message_receipts r on r.message_id = m.id
  where m.organization_id = v_user.organization_id
  group by m.id, tu.display_name
  order by m.created_at desc
  limit 200;
end;
$$;

create or replace function public.local_deactivate_operational_message(p_token text, p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where private.local_users.id = v_actor;
  if v_user.role not in ('admin', 'pcp') then raise exception 'Acesso não autorizado.' using errcode = '42501'; end if;
  update private.operational_messages set is_active = false, updated_at = now()
  where id = p_message_id and organization_id = v_user.organization_id;
  if not found then raise exception 'Mensagem não encontrada.'; end if;
  insert into private.local_user_audit (organization_id, actor_user_id, event_type, details)
  values (v_user.organization_id, v_actor, 'operational_message_deactivated', jsonb_build_object('message_id', p_message_id));
end;
$$;

revoke all on function public.local_list_operational_messages(text) from public, anon, authenticated;
revoke all on function public.local_list_operational_message_targets(text) from public, anon, authenticated;
revoke all on function public.local_create_operational_message(text,text,text,text,text,uuid,text,text,timestamptz,boolean) from public, anon, authenticated;
revoke all on function public.local_mark_operational_message(text,uuid,text) from public, anon, authenticated;
revoke all on function public.local_list_sent_operational_messages(text) from public, anon, authenticated;
revoke all on function public.local_deactivate_operational_message(text,uuid) from public, anon, authenticated;

grant execute on function public.local_list_operational_messages(text) to anon, authenticated;
grant execute on function public.local_list_operational_message_targets(text) to anon, authenticated;
grant execute on function public.local_create_operational_message(text,text,text,text,text,uuid,text,text,timestamptz,boolean) to anon, authenticated;
grant execute on function public.local_mark_operational_message(text,uuid,text) to anon, authenticated;
grant execute on function public.local_list_sent_operational_messages(text) to anon, authenticated;
grant execute on function public.local_deactivate_operational_message(text,uuid) to anon, authenticated;

comment on table private.operational_messages is 'Mensagens operacionais segmentadas por usuário, perfil ou prensa.';
comment on table private.operational_message_receipts is 'Leitura, confirmação e dispensa individual de mensagens operacionais.';
