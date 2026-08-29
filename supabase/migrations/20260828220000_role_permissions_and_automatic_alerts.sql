begin;

-- Gerente entra na hierarquia sem invalidar operadores já cadastrados.
alter table private.local_users drop constraint if exists local_users_role_check;
alter table private.local_users add constraint local_users_role_check
  check (role in ('admin','manager','pcp','operator','engineering','maintenance','quality','viewer'));

alter table private.operational_messages drop constraint if exists operational_messages_role_check;
alter table private.operational_messages add constraint operational_messages_role_check
  check (target_role is null or target_role in ('admin','manager','pcp','operator','engineering','maintenance','quality','viewer'));

alter table private.operational_messages
  alter column created_by drop not null,
  add column if not exists source_type text not null default 'manual',
  add column if not exists source_key text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

alter table private.operational_messages drop constraint if exists operational_messages_source_type_check;
alter table private.operational_messages add constraint operational_messages_source_type_check
  check (source_type in ('manual','heating','production','stoppage'));

create unique index if not exists operational_messages_source_key_uq
  on private.operational_messages (organization_id, source_key)
  where source_key is not null;
create index if not exists operational_messages_automatic_active_idx
  on private.operational_messages (organization_id, source_type, is_active, created_at desc)
  where source_type <> 'manual';

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
  if p_role not in ('admin','manager','pcp','operator','engineering','maintenance','quality','viewer') then raise exception 'Perfil inválido.'; end if;
  insert into private.local_users (organization_id, username, email, display_name, password_hash, role, machine_codes, created_by, updated_by)
  values (v_org, lower(btrim(p_username)), nullif(lower(btrim(p_email)), ''), btrim(p_display_name), extensions.crypt(p_password, extensions.gen_salt('bf', 12)), p_role, coalesce(p_machine_codes, '{}'), v_actor, v_actor)
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
  if p_role not in ('admin','manager','pcp','operator','engineering','maintenance','quality','viewer') then raise exception 'Perfil inválido.'; end if;
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

create or replace function private.generate_automatic_operational_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle record;
  v_role text;
  v_hour integer;
  v_key text;
  v_inserted integer := 0;
begin
  update private.operational_messages m
     set is_active = false, updated_at = now()
   where m.source_type = 'heating'
     and m.is_active
     and not exists (
       select 1 from public.tool_heating_cycles c
        where c.id::text = m.metadata->>'cycle_id' and c.status = 'heating'
     );

  for v_cycle in
    select c.id, c.organization_id, c.machine_code, c.tool_code,
      c.expected_ready_at, c.maximum_due_at,
      greatest(0, floor(extract(epoch from (now() - c.expected_ready_at)) / 3600))::integer as overdue_hour
    from public.tool_heating_cycles c
    where c.status = 'heating' and c.expected_ready_at <= now()
  loop
    v_hour := v_cycle.overdue_hour;
    foreach v_role in array array['admin','manager','pcp']::text[] loop
      v_key := 'heating:' || v_cycle.id::text || ':hour:' || v_hour::text || ':role:' || v_role;

      update private.operational_messages
         set is_active = false, updated_at = now()
       where organization_id = v_cycle.organization_id
         and source_type = 'heating'
         and target_role = v_role
         and metadata->>'cycle_id' = v_cycle.id::text
         and source_key <> v_key
         and is_active;

      insert into private.operational_messages (
        organization_id, title, body, priority, audience_type, target_role,
        requires_ack, is_active, created_by, created_by_name,
        source_type, source_key, metadata
      ) values (
        v_cycle.organization_id,
        case when v_hour = 0
          then 'Ferramenta ' || v_cycle.tool_code || ' pronta para produção'
          else v_cycle.tool_code || ' está pronta há mais de ' || v_hour || 'h'
        end,
        case when v_hour = 0
          then 'A ferramenta atingiu o prazo mínimo de temperatura de 4h na Prensa ' || v_cycle.machine_code || '. Verifique a sequência e libere quando estiver pronta para uso.'
          else 'A ferramenta ' || v_cycle.tool_code || ' está há mais de ' || v_hour || 'h além do prazo mínimo de temperatura (4h), na Prensa ' || v_cycle.machine_code || '. Avalie a prioridade de produção e o limite de permanência.'
        end,
        case when v_hour >= 3 then 'critical' when v_hour >= 1 then 'urgent' else 'attention' end,
        'role', v_role, v_hour >= 3, true, null, 'AluPilot',
        'heating', v_key,
        jsonb_build_object('cycle_id', v_cycle.id, 'tool_code', v_cycle.tool_code, 'machine_code', v_cycle.machine_code, 'overdue_hour', v_hour, 'expected_ready_at', v_cycle.expected_ready_at, 'maximum_due_at', v_cycle.maximum_due_at)
      )
      on conflict (organization_id, source_key) where source_key is not null
      do update set is_active = true, updated_at = now();
      if found then v_inserted := v_inserted + 1; end if;
    end loop;
  end loop;
  return v_inserted;
end;
$$;

create or replace function private.notify_production_execution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_role text;
begin
  foreach v_role in array array['admin','manager','pcp']::text[] loop
    insert into private.operational_messages (
      organization_id, title, body, priority, audience_type, target_role,
      expires_at, requires_ack, created_by, created_by_name,
      source_type, source_key, metadata
    ) values (
      new.organization_id,
      'Apontamento concluído · ' || new.tool_code,
      'Prensa ' || new.machine_code || ' · Ordem ' || new.order_number || E'\nProduzido: ' || trim(to_char(new.produced_kg, 'FM999G999G990D0')) || ' kg' ||
        case when new.achieved_productivity_kg_h is null then '' else ' · Produtividade: ' || trim(to_char(new.achieved_productivity_kg_h, 'FM999G999G990D0')) || ' kg/h' end ||
        ' · Apontado por ' || new.operator_name || '.',
      'info', 'role', v_role, now() + interval '48 hours', false, null, 'AluPilot',
      'production', 'production:' || new.id::text || ':role:' || v_role,
      jsonb_build_object('execution_id', new.id, 'production_order_id', new.production_order_id, 'tool_code', new.tool_code, 'machine_code', new.machine_code)
    ) on conflict (organization_id, source_key) where source_key is not null do nothing;
  end loop;
  return new;
end;
$$;

create or replace function private.notify_machine_stoppage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_role text;
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then return new; end if;
  foreach v_role in array array['admin','manager','pcp','maintenance']::text[] loop
    insert into private.operational_messages (
      organization_id, title, body, priority, audience_type, target_role,
      expires_at, requires_ack, created_by, created_by_name,
      source_type, source_key, metadata
    ) values (
      new.organization_id,
      case when new.status = 'open' then 'Parada aberta · Prensa ' || new.machine_code else 'Parada ' || new.status || ' · Prensa ' || new.machine_code end,
      'Ferramenta ' || new.tool_code || ' · Ordem ' || new.order_number || E'\nMotivo: ' || new.reason || ' · Responsável: ' || coalesce(new.responsible_area, 'não informado') || '.',
      case when new.status = 'open' then 'urgent' else 'info' end,
      'role', v_role, now() + interval '48 hours', false, null, 'AluPilot',
      'stoppage', 'stoppage:' || new.id::text || ':' || new.status || ':role:' || v_role,
      jsonb_build_object('stoppage_id', new.id, 'tool_code', new.tool_code, 'machine_code', new.machine_code, 'status', new.status)
    ) on conflict (organization_id, source_key) where source_key is not null do nothing;
  end loop;
  return new;
end;
$$;

drop trigger if exists notify_production_execution_trg on public.production_execution_history;
create trigger notify_production_execution_trg after insert on public.production_execution_history
for each row execute function private.notify_production_execution();

drop trigger if exists notify_machine_stoppage_trg on public.machine_stoppages;
create trigger notify_machine_stoppage_trg after insert or update of status on public.machine_stoppages
for each row execute function private.notify_machine_stoppage();

drop function if exists public.local_list_operational_messages(text);
create function public.local_list_operational_messages(p_token text)
returns table (
  id uuid, title text, body text, priority text, audience_type text,
  target_label text, starts_at timestamptz, expires_at timestamptz,
  requires_ack boolean, created_by_name text, created_at timestamptz,
  read_at timestamptz, acknowledged_at timestamptz, dismissed_at timestamptz,
  source_type text, metadata jsonb
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
  perform private.generate_automatic_operational_messages();
  return query
  select m.id, m.title, m.body, m.priority, m.audience_type,
    case m.audience_type
      when 'all' then 'Toda a operação'
      when 'user' then coalesce(tu.display_name, 'Usuário')
      when 'role' then case m.target_role when 'admin' then 'Administradores' when 'manager' then 'Gerentes' when 'pcp' then 'PCP' when 'engineering' then 'Engenharia' when 'maintenance' then 'Manutenção' when 'quality' then 'Qualidade' when 'viewer' then 'Consulta' else 'Operação' end
      when 'press' then 'Prensa ' || m.target_machine_code
    end,
    m.starts_at, m.expires_at, m.requires_ack, m.created_by_name, m.created_at,
    r.read_at, r.acknowledged_at, r.dismissed_at, m.source_type, m.metadata
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

-- Gerente pode publicar e administrar avisos, sem receber administração de usuários.
create or replace function public.local_list_operational_message_targets(p_token text)
returns table (id uuid, display_name text, username text, role text, machine_codes text[])
language plpgsql security definer set search_path = pg_catalog, extensions
as $$
declare v_actor uuid; v_org uuid; v_role text;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id, private.local_users.role into v_org, v_role from private.local_users where private.local_users.id = v_actor;
  if v_role not in ('admin','manager','pcp') then raise exception 'Acesso não autorizado.' using errcode = '42501'; end if;
  return query select u.id, u.display_name, u.username, u.role, u.machine_codes from private.local_users u where u.organization_id = v_org and u.is_active order by u.display_name;
end;
$$;

create or replace function public.local_create_operational_message(
  p_token text, p_title text, p_body text, p_priority text, p_audience_type text,
  p_target_user_id uuid default null, p_target_role text default null,
  p_target_machine_code text default null, p_expires_at timestamptz default null,
  p_requires_ack boolean default false
)
returns uuid language plpgsql security definer set search_path = pg_catalog, extensions
as $$
declare v_actor uuid; v_user private.local_users%rowtype; v_id uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where private.local_users.id = v_actor;
  if v_user.role not in ('admin','manager','pcp') then raise exception 'Acesso não autorizado.' using errcode = '42501'; end if;
  if p_priority not in ('info','attention','urgent','critical') then raise exception 'Prioridade inválida.'; end if;
  if p_audience_type not in ('all','user','role','press') then raise exception 'Destino inválido.'; end if;
  if p_audience_type = 'user' and not exists (select 1 from private.local_users where id = p_target_user_id and organization_id = v_user.organization_id and is_active) then raise exception 'Usuário de destino inválido.'; end if;
  insert into private.operational_messages (organization_id,title,body,priority,audience_type,target_user_id,target_role,target_machine_code,expires_at,requires_ack,created_by,created_by_name,source_type)
  values (v_user.organization_id,btrim(p_title),btrim(p_body),p_priority,p_audience_type,case when p_audience_type='user' then p_target_user_id end,case when p_audience_type='role' then p_target_role end,case when p_audience_type='press' then regexp_replace(btrim(p_target_machine_code),'^P','','i') end,p_expires_at,coalesce(p_requires_ack,false),v_actor,v_user.display_name,'manual') returning id into v_id;
  insert into private.local_user_audit (organization_id,actor_user_id,event_type,details) values (v_user.organization_id,v_actor,'operational_message_created',jsonb_build_object('message_id',v_id,'audience_type',p_audience_type,'priority',p_priority));
  return v_id;
end;
$$;

create or replace function public.local_list_sent_operational_messages(p_token text)
returns table (id uuid,title text,body text,priority text,audience_type text,target_label text,expires_at timestamptz,requires_ack boolean,is_active boolean,created_at timestamptz,read_count bigint,acknowledged_count bigint)
language plpgsql security definer set search_path = pg_catalog, extensions
as $$
declare v_actor uuid; v_user private.local_users%rowtype;
begin
  v_actor := private.require_local_session(p_token,false); select * into v_user from private.local_users where id=v_actor;
  if v_user.role not in ('admin','manager','pcp') then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
  return query select m.id,m.title,m.body,m.priority,m.audience_type,case m.audience_type when 'all' then 'Toda a operação' when 'user' then coalesce(tu.display_name,'Usuário') when 'role' then m.target_role when 'press' then 'Prensa '||m.target_machine_code end,m.expires_at,m.requires_ack,m.is_active,m.created_at,count(r.user_id) filter(where r.read_at is not null),count(r.user_id) filter(where r.acknowledged_at is not null)
  from private.operational_messages m left join private.local_users tu on tu.id=m.target_user_id left join private.operational_message_receipts r on r.message_id=m.id where m.organization_id=v_user.organization_id and m.source_type='manual' group by m.id,tu.display_name order by m.created_at desc limit 200;
end;
$$;

create or replace function public.local_deactivate_operational_message(p_token text,p_message_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,extensions
as $$
declare v_actor uuid; v_user private.local_users%rowtype;
begin
  v_actor:=private.require_local_session(p_token,false); select * into v_user from private.local_users where id=v_actor;
  if v_user.role not in ('admin','manager','pcp') then raise exception 'Acesso não autorizado.' using errcode='42501'; end if;
  update private.operational_messages set is_active=false,updated_at=now() where id=p_message_id and organization_id=v_user.organization_id;
  if not found then raise exception 'Mensagem não encontrada.'; end if;
  insert into private.local_user_audit(organization_id,actor_user_id,event_type,details) values(v_user.organization_id,v_actor,'operational_message_deactivated',jsonb_build_object('message_id',p_message_id));
end;
$$;

revoke all on function private.generate_automatic_operational_messages() from public, anon, authenticated;
revoke all on function private.notify_production_execution() from public, anon, authenticated;
revoke all on function private.notify_machine_stoppage() from public, anon, authenticated;
revoke all on function public.local_list_operational_messages(text) from public, anon, authenticated;
grant execute on function public.local_list_operational_messages(text) to anon, authenticated;

create extension if not exists pg_cron;
do $$
declare v_job bigint;
begin
  select jobid into v_job from cron.job where jobname = 'alupilot-heating-alerts';
  if v_job is not null then perform cron.unschedule(v_job); end if;
end $$;
select cron.schedule('alupilot-heating-alerts', '*/5 * * * *', 'select private.generate_automatic_operational_messages();');

comment on function private.generate_automatic_operational_messages() is 'Gera um único alerta ativo por ferramenta, perfil e marco horário após o aquecimento mínimo.';

commit;
