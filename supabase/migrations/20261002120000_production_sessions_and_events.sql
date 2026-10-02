begin;

-- Linha do tempo oficial da execução. O histórico final existente continua sendo
-- a fotografia da ordem concluída; estas tabelas guardam o caminho até ela.
create table if not exists public.production_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  machine_code text not null,
  tool_code text not null,
  plan_code text,
  status text not null default 'open' check (status in ('open', 'running', 'paused', 'completed', 'cancelled', 'corrected')),
  started_at timestamptz,
  ended_at timestamptz,
  created_by_user_id uuid,
  created_by_name text not null,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at is null or started_at is null or ended_at >= started_at)
);

create table if not exists public.production_session_orders (
  session_id uuid not null references public.production_sessions(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (session_id, production_order_id),
  unique (production_order_id, session_id)
);

create table if not exists public.production_session_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.production_sessions(id) on delete restrict,
  event_type text not null check (event_type in (
    'opened', 'started', 'paused', 'resumed', 'result_recorded',
    'correction_recorded', 'completed', 'cancelled', 'note'
  )),
  occurred_at timestamptz not null default clock_timestamp(),
  actor_user_id uuid,
  actor_name text not null,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, idempotency_key)
);

create index if not exists production_sessions_org_status_idx
  on public.production_sessions (organization_id, status, updated_at desc);
create index if not exists production_sessions_machine_time_idx
  on public.production_sessions (organization_id, machine_code, started_at desc);
create index if not exists production_session_orders_order_idx
  on public.production_session_orders (organization_id, production_order_id, created_at desc);
create index if not exists production_session_events_timeline_idx
  on public.production_session_events (organization_id, session_id, occurred_at, created_at);

alter table public.production_sessions enable row level security;
alter table public.production_session_orders enable row level security;
alter table public.production_session_events enable row level security;

-- A aplicação usa as RPCs abaixo com a sessão local. Não existe escrita direta
-- no navegador e não há UPDATE/DELETE para eventos.
revoke all on table public.production_sessions from anon, authenticated;
revoke all on table public.production_session_orders from anon, authenticated;
revoke all on table public.production_session_events from anon, authenticated;

drop policy if exists production_sessions_authenticated_select on public.production_sessions;
create policy production_sessions_authenticated_select on public.production_sessions
  for select to authenticated
  using (organization_id in (select private.authorized_org_ids()));
drop policy if exists production_session_orders_authenticated_select on public.production_session_orders;
create policy production_session_orders_authenticated_select on public.production_session_orders
  for select to authenticated
  using (organization_id in (select private.authorized_org_ids()));
drop policy if exists production_session_events_authenticated_select on public.production_session_events;
create policy production_session_events_authenticated_select on public.production_session_events
  for select to authenticated
  using (organization_id in (select private.authorized_org_ids()));

create or replace function private.prevent_production_session_event_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  raise exception 'Eventos da sessão são imutáveis: registre uma correção como novo evento.'
    using errcode = '55000';
  return old;
end;
$$;

drop trigger if exists production_session_events_immutable_trg on public.production_session_events;
create trigger production_session_events_immutable_trg
before update or delete on public.production_session_events
for each row execute function private.prevent_production_session_event_mutation();

create or replace function private.sync_production_session_from_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  update public.production_sessions
     set status = case
       when new.event_type = 'opened' then 'open'
       when new.event_type in ('started', 'resumed') then 'running'
       when new.event_type = 'paused' then 'paused'
       when new.event_type = 'completed' then 'completed'
       when new.event_type = 'cancelled' then 'cancelled'
       when new.event_type = 'correction_recorded' then 'corrected'
       else status
     end,
         started_at = case
           when new.event_type in ('started', 'resumed') then coalesce(started_at, new.occurred_at)
           else started_at
         end,
         ended_at = case
           when new.event_type in ('completed', 'cancelled') then coalesce(ended_at, new.occurred_at)
           when new.event_type in ('started', 'resumed', 'paused', 'correction_recorded') then null
           else ended_at
         end,
         updated_at = clock_timestamp()
   where id = new.session_id
     and organization_id = new.organization_id;
  return new;
end;
$$;

drop trigger if exists sync_production_session_from_event_trg on public.production_session_events;
create trigger sync_production_session_from_event_trg
after insert on public.production_session_events
for each row execute function private.sync_production_session_from_event();

create or replace function private.append_production_session_event(
  p_session_id uuid,
  p_organization_id uuid,
  p_event_type text,
  p_actor_user_id uuid,
  p_actor_name text,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default clock_timestamp()
)
returns public.production_session_events
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_event public.production_session_events%rowtype;
begin
  if nullif(btrim(p_actor_name), '') is null then
    raise exception 'Informe quem realizou o apontamento.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'O apontamento precisa de uma chave de idempotência.';
  end if;
  if not exists (
    select 1 from public.production_sessions
     where id = p_session_id and organization_id = p_organization_id
  ) then
    raise exception 'Sessão de produção não encontrada para esta organização.';
  end if;

  insert into public.production_session_events (
    organization_id, session_id, event_type, occurred_at,
    actor_user_id, actor_name, idempotency_key, payload
  ) values (
    p_organization_id, p_session_id, p_event_type, coalesce(p_occurred_at, clock_timestamp()),
    p_actor_user_id, btrim(p_actor_name), btrim(p_idempotency_key), coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (session_id, idempotency_key) do nothing
  returning * into v_event;
  if v_event.id is null then
    select * into v_event
      from public.production_session_events
     where session_id = p_session_id and idempotency_key = btrim(p_idempotency_key);
  end if;
  return v_event;
end;
$$;

create or replace function private.ensure_production_session(
  p_actor uuid,
  p_order_ids uuid[],
  p_actor_name text,
  p_initial_status text default 'running'
)
returns uuid
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_user private.local_users%rowtype;
  v_org uuid;
  v_machine text;
  v_tool text;
  v_plan text;
  v_session uuid;
  v_count integer;
  v_now timestamptz := clock_timestamp();
begin
  select * into v_user from private.local_users where id = p_actor and is_active;
  if v_user.id is null then raise exception 'Usuário da sessão não encontrado.' using errcode = '28000'; end if;

  select min(organization_id::text)::uuid, min(machine_code), min(tool_code), min(plan_code), count(*)
    into v_org, v_machine, v_tool, v_plan, v_count
  from public.production_orders
  where id = any(p_order_ids) and is_active;
  if v_count <> coalesce(array_length(p_order_ids, 1), 0) then
    raise exception 'As ordens selecionadas não estão disponíveis para a sessão.';
  end if;
  if v_org is distinct from v_user.organization_id then raise exception 'Acesso não autorizado para esta organização.' using errcode = '42501'; end if;
  if v_user.role = 'operator' and cardinality(v_user.machine_codes) > 0
     and not (v_machine = any(v_user.machine_codes)) then
    raise exception 'Seu usuário não possui acesso à prensa selecionada.' using errcode = '42501';
  end if;
  if (select count(distinct machine_code) from public.production_orders where id = any(p_order_ids)) <> 1
     or (select count(distinct upper(tool_code)) from public.production_orders where id = any(p_order_ids)) <> 1 then
    raise exception 'Uma sessão só pode reunir uma ferramenta em uma prensa.';
  end if;

  select s.id into v_session
    from public.production_sessions s
    join public.production_session_orders so on so.session_id = s.id
   where s.organization_id = v_org
     and s.status in ('open', 'running', 'paused')
     and so.production_order_id = any(p_order_ids)
   group by s.id
  having count(distinct so.production_order_id) = coalesce(array_length(p_order_ids, 1), 0)
   order by max(s.updated_at) desc
   limit 1;
  if v_session is not null then return v_session; end if;

  insert into public.production_sessions (
    organization_id, machine_code, tool_code, plan_code, status,
    started_at, created_by_user_id, created_by_name
  ) values (
    v_org, v_machine, v_tool, v_plan, coalesce(nullif(p_initial_status, ''), 'running'),
    case when p_initial_status = 'open' then null else v_now end,
    p_actor, p_actor_name
  ) returning id into v_session;

  insert into public.production_session_orders (session_id, production_order_id, organization_id)
  select v_session, po.id, po.organization_id
    from public.production_orders po
   where po.id = any(p_order_ids);

  perform private.append_production_session_event(
    v_session, v_org, 'opened', p_actor, p_actor_name,
    'session-open:' || v_session::text,
    jsonb_build_object('order_ids', p_order_ids, 'machine_code', v_machine, 'tool_code', v_tool)
  );
  if p_initial_status <> 'open' then
    perform private.append_production_session_event(
      v_session, v_org, 'started', p_actor, p_actor_name,
      'session-start:' || v_session::text,
      jsonb_build_object('order_ids', p_order_ids)
    );
  end if;
  return v_session;
end;
$$;

create or replace function public.local_start_production_session(
  p_token text,
  p_order_ids uuid[],
  p_confirmed_removed_from_oven boolean,
  p_early_release_justification text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog, extensions
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_start jsonb;
  v_session uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  v_start := public.local_start_production(p_token, p_order_ids, p_confirmed_removed_from_oven, p_early_release_justification);
  v_session := private.ensure_production_session(v_actor, p_order_ids, v_user.display_name, 'running');
  return v_start || jsonb_build_object('session_id', v_session);
end;
$$;

create or replace function public.local_resume_production_session(
  p_token text,
  p_order_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_session uuid;
  v_orders jsonb;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  if v_user.role = 'viewer' then raise exception 'Seu perfil possui somente permissão de consulta.' using errcode = '42501'; end if;
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then raise exception 'Selecione ao menos um item para retomar.'; end if;
  if exists (select 1 from public.production_orders where id = any(p_order_ids) and status <> 'paused') then
    raise exception 'Todos os itens precisam estar pausados para retomar.';
  end if;
  v_session := private.ensure_production_session(v_actor, p_order_ids, v_user.display_name, 'paused');
  with changed as (
    update public.production_orders
       set status = 'in_progress', last_status_reason = 'Produção retomada por ' || v_user.display_name
     where id = any(p_order_ids) and is_active and status = 'paused'
     returning *
  ) select jsonb_agg(to_jsonb(changed)) into v_orders from changed;
  perform private.append_production_session_event(
    v_session, v_user.organization_id, 'resumed', v_actor, v_user.display_name,
    'resume:' || v_session::text || ':' || md5(array_to_string(p_order_ids, ',')),
    jsonb_build_object('order_ids', p_order_ids)
  );
  return jsonb_build_object('orders', coalesce(v_orders, '[]'::jsonb), 'session_id', v_session);
end;
$$;

create or replace function public.local_pause_production_session(
  p_token text,
  p_order_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_session uuid;
  v_orders jsonb;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  if v_user.role = 'viewer' then raise exception 'Seu perfil possui somente permissão de consulta.' using errcode = '42501'; end if;
  if char_length(v_reason) < 3 then raise exception 'Informe por que a produção foi pausada.'; end if;
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then raise exception 'Selecione ao menos um item para pausar.'; end if;
  if exists (select 1 from public.production_orders where id = any(p_order_ids) and status not in ('in_progress', 'paused')) then
    raise exception 'Todos os itens precisam estar em produção para pausar.';
  end if;
  v_session := private.ensure_production_session(v_actor, p_order_ids, v_user.display_name, 'running');
  with changed as (
    update public.production_orders
       set status = 'paused', last_status_reason = 'Produção pausada por ' || v_user.display_name || ': ' || v_reason
     where id = any(p_order_ids) and is_active and status = 'in_progress'
     returning *
  ) select jsonb_agg(to_jsonb(changed)) into v_orders from changed;
  perform private.append_production_session_event(
    v_session, v_user.organization_id, 'paused', v_actor, v_user.display_name,
    'pause:' || v_session::text || ':' || md5(array_to_string(p_order_ids, ',') || ':' || v_reason),
    jsonb_build_object('order_ids', p_order_ids, 'reason', v_reason)
  );
  return jsonb_build_object('orders', coalesce(v_orders, '[]'::jsonb), 'session_id', v_session);
end;
$$;

create or replace function public.local_complete_production_session(
  p_token text,
  p_order_ids uuid[],
  p_produced_kg numeric,
  p_produced_quantity numeric,
  p_achieved_productivity_kg_h numeric,
  p_process_sheet_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_session uuid;
  v_order public.production_orders%rowtype;
  v_orders jsonb := '[]'::jsonb;
  v_total_kg numeric := 0;
  v_total_quantity numeric := 0;
  v_allocated_kg numeric := 0;
  v_allocated_quantity numeric := 0;
  v_expected integer;
  v_index integer := 0;
  v_delta_kg numeric;
  v_delta_quantity numeric;
  v_kg numeric := greatest(coalesce(p_produced_kg, 0), 0);
  v_quantity numeric := greatest(coalesce(p_produced_quantity, 0), 0);
  v_now timestamptz := clock_timestamp();
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  if v_user.role = 'viewer' then raise exception 'Seu perfil possui somente permissão de consulta.' using errcode = '42501'; end if;
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then raise exception 'Selecione ao menos um item para concluir.'; end if;
  if v_kg <= 0 and v_quantity <= 0 then raise exception 'Informe o resultado produzido.'; end if;
  if p_achieved_productivity_kg_h <= 0 or p_achieved_productivity_kg_h > 2500 then raise exception 'Produtividade informada inválida.'; end if;
  if exists (select 1 from public.production_orders where id = any(p_order_ids) and status <> 'in_progress') then
    raise exception 'Todos os itens precisam estar em produção para concluir.';
  end if;
  select coalesce(sum(greatest(coalesce(target_kg, 0) - coalesce(produced_kg, 0), 0)), 0),
         coalesce(sum(greatest(coalesce(target_quantity, 0) - coalesce(produced_quantity, 0), 0)), 0), count(*)
    into v_total_kg, v_total_quantity, v_expected
    from public.production_orders where id = any(p_order_ids);
  if v_total_kg > 0 and v_kg + 0.001 < v_total_kg then raise exception 'O peso informado é menor que o saldo da ordem.'; end if;
  if v_total_quantity > 0 and v_quantity + 0.001 < v_total_quantity then raise exception 'A quantidade informada é menor que o saldo da ordem.'; end if;
  v_session := private.ensure_production_session(v_actor, p_order_ids, v_user.display_name, 'running');

  for v_order in select * from public.production_orders where id = any(p_order_ids) order by sequence, id for update loop
    v_index := v_index + 1;
    v_delta_kg := case
      when v_index = v_expected then v_kg - v_allocated_kg
      when v_total_kg > 0 then round(v_kg * greatest(coalesce(v_order.target_kg, 0) - coalesce(v_order.produced_kg, 0), 0) / v_total_kg, 3)
      else 0 end;
    v_delta_quantity := case
      when v_index = v_expected then v_quantity - v_allocated_quantity
      when v_total_quantity > 0 then round(v_quantity * greatest(coalesce(v_order.target_quantity, 0) - coalesce(v_order.produced_quantity, 0), 0) / v_total_quantity, 0)
      else 0 end;
    v_delta_kg := greatest(v_delta_kg, 0);
    v_delta_quantity := greatest(v_delta_quantity, 0);
    v_allocated_kg := v_allocated_kg + v_delta_kg;
    v_allocated_quantity := v_allocated_quantity + v_delta_quantity;
    update public.production_orders
       set status = 'completed',
           produced_kg = round(coalesce(produced_kg, 0) + v_delta_kg, 3),
           produced_quantity = round(coalesce(produced_quantity, 0) + v_delta_quantity),
           completed_by_name = v_user.display_name,
           actual_end = v_now,
           process_sheet_id = coalesce(p_process_sheet_id, process_sheet_id),
           achieved_productivity_kg_h = p_achieved_productivity_kg_h,
           last_status_reason = 'Produção concluída por ' || v_user.display_name || case when nullif(btrim(coalesce(p_notes, '')), '') is null then '' else ' · ' || btrim(p_notes) end
     where id = v_order.id
     returning * into v_order;
    v_orders := v_orders || jsonb_build_array(to_jsonb(v_order));
  end loop;

  perform private.append_production_session_event(
    v_session, v_user.organization_id, 'result_recorded', v_actor, v_user.display_name,
    'result:' || v_session::text || ':' || md5(array_to_string(p_order_ids, ',') || ':' || v_now::text),
    jsonb_build_object('order_ids', p_order_ids, 'produced_kg', v_kg, 'produced_quantity', v_quantity, 'productivity_kg_h', p_achieved_productivity_kg_h, 'notes', nullif(btrim(coalesce(p_notes, '')), '')),
    v_now
  );
  perform private.append_production_session_event(
    v_session, v_user.organization_id, 'completed', v_actor, v_user.display_name,
    'complete:' || v_session::text || ':' || md5(v_now::text),
    jsonb_build_object('order_ids', p_order_ids), v_now
  );
  return jsonb_build_object('orders', v_orders, 'session_id', v_session);
end;
$$;

create or replace function public.local_record_partial_production_session(
  p_token text, p_order_ids uuid[], p_produced_kg numeric, p_produced_quantity numeric,
  p_reason_type text, p_reason text, p_notes text default null,
  p_achieved_productivity_kg_h numeric default null, p_process_sheet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_session uuid;
  v_result jsonb;
  v_event_type text;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  v_session := private.ensure_production_session(v_actor, p_order_ids, v_user.display_name, 'running');
  v_result := public.local_record_partial_production(p_token, p_order_ids, p_produced_kg, p_produced_quantity, p_reason_type, p_reason, p_notes, p_achieved_productivity_kg_h, p_process_sheet_id);
  perform private.append_production_session_event(
    v_session, v_user.organization_id, 'result_recorded', v_actor, v_user.display_name,
    'partial-result:' || v_session::text || ':' || md5(clock_timestamp()::text),
    jsonb_build_object('order_ids', p_order_ids, 'produced_kg', p_produced_kg, 'produced_quantity', p_produced_quantity, 'reason_type', p_reason_type, 'reason', btrim(p_reason), 'notes', nullif(btrim(coalesce(p_notes, '')), ''))
  );
  v_event_type := case when p_reason_type = 'tool_issue' then 'paused' else 'completed' end;
  perform private.append_production_session_event(
    v_session, v_user.organization_id, v_event_type, v_actor, v_user.display_name,
    'partial-state:' || v_session::text || ':' || md5(clock_timestamp()::text),
    jsonb_build_object('order_ids', p_order_ids, 'partial', true, 'reason_type', p_reason_type)
  );
  return v_result || jsonb_build_object('session_id', v_session);
end;
$$;

create or replace function public.local_reopen_production_session(
  p_token text,
  p_order_id uuid,
  p_reason text default 'Item reprogramado para correção operacional.'
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_order public.production_orders%rowtype;
  v_session uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  if v_user.role = 'viewer' then raise exception 'Seu perfil possui somente permissão de consulta.' using errcode = '42501'; end if;
  if char_length(v_reason) < 5 then raise exception 'Informe o motivo da correção.'; end if;
  select * into v_order from public.production_orders where id = p_order_id and organization_id = v_user.organization_id for update;
  if v_order.id is null then raise exception 'Ordem não encontrada.'; end if;
  if v_order.status <> 'completed' then raise exception 'Somente uma ordem concluída pode ser reprogramada.'; end if;
  update public.production_orders
     set status = 'planned',
         is_active = true,
         reopened_at = clock_timestamp(),
         reopened_by_name = v_user.display_name,
         reprogram_count = coalesce(reprogram_count, 0) + 1,
         last_status_reason = 'Item reprogramado por ' || v_user.display_name || ': ' || v_reason
   where id = p_order_id
   returning * into v_order;
  v_session := private.ensure_production_session(v_actor, array[p_order_id], v_user.display_name, 'open');
  perform private.append_production_session_event(
    v_session, v_user.organization_id, 'correction_recorded', v_actor, v_user.display_name,
    'correction:' || v_session::text || ':' || md5(clock_timestamp()::text),
    jsonb_build_object('order_id', p_order_id, 'reason', v_reason, 'from_status', 'completed', 'to_status', 'planned')
  );
  return jsonb_build_object('order', to_jsonb(v_order), 'session_id', v_session);
end;
$$;

create or replace function public.local_record_manual_production_result(
  p_token text,
  p_order_id uuid,
  p_produced_kg numeric,
  p_produced_quantity numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_order public.production_orders%rowtype;
  v_session uuid;
  v_now timestamptz := clock_timestamp();
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  if v_user.role = 'viewer' then raise exception 'Seu perfil possui somente permissão de consulta.' using errcode = '42501'; end if;
  if coalesce(p_produced_kg, 0) <= 0 and coalesce(p_produced_quantity, 0) <= 0 then raise exception 'Informe o resultado produzido.'; end if;
  select * into v_order from public.production_orders where id = p_order_id and organization_id = v_user.organization_id for update;
  if v_order.id is null then raise exception 'Ordem não encontrada.'; end if;
  if v_order.status not in ('planned', 'released', 'in_progress', 'paused') then raise exception 'A ordem já foi encerrada.'; end if;
  if v_order.status <> 'in_progress' then
    update public.production_orders
       set status = 'in_progress',
           started_by_name = v_user.display_name,
           last_status_reason = 'Produção iniciada para registro manual por ' || v_user.display_name
     where id = p_order_id;
  end if;
  v_session := private.ensure_production_session(v_actor, array[p_order_id], v_user.display_name, 'running');
  update public.production_orders
     set status = 'completed',
         is_active = false,
         completed_by_name = v_user.display_name,
         produced_kg = greatest(coalesce(p_produced_kg, 0), 0),
         produced_quantity = greatest(round(coalesce(p_produced_quantity, 0)), 0),
         actual_start = coalesce(actual_start, v_now),
         actual_end = v_now,
         last_status_reason = 'Resultado manual registrado por ' || v_user.display_name
   where id = p_order_id
   returning * into v_order;
  perform private.append_production_session_event(
    v_session, v_user.organization_id, 'result_recorded', v_actor, v_user.display_name,
    'manual-result:' || v_session::text || ':' || md5(v_now::text),
    jsonb_build_object('order_id', p_order_id, 'produced_kg', p_produced_kg, 'produced_quantity', p_produced_quantity), v_now
  );
  perform private.append_production_session_event(
    v_session, v_user.organization_id, 'completed', v_actor, v_user.display_name,
    'manual-complete:' || v_session::text || ':' || md5(v_now::text),
    jsonb_build_object('order_id', p_order_id, 'manual', true), v_now
  );
  return jsonb_build_object('order', to_jsonb(v_order), 'session_id', v_session);
end;
$$;

create or replace function public.local_cancel_production_order(
  p_token text,
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_order public.production_orders%rowtype;
  v_session uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_now timestamptz := clock_timestamp();
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  if v_user.role = 'viewer' then raise exception 'Seu perfil possui somente permissão de consulta.' using errcode = '42501'; end if;
  if char_length(v_reason) < 3 then raise exception 'Informe por que o item foi encerrado sem produção.'; end if;
  select * into v_order from public.production_orders where id = p_order_id and organization_id = v_user.organization_id for update;
  if v_order.id is null then raise exception 'Ordem não encontrada.'; end if;
  if v_order.status not in ('planned', 'released', 'in_progress', 'paused') then raise exception 'A ordem já foi encerrada.'; end if;
  v_session := private.ensure_production_session(v_actor, array[p_order_id], v_user.display_name, 'running');
  update public.production_orders
     set status = 'cancelled', is_active = false,
         completed_by_name = v_user.display_name,
         last_status_reason = 'Item encerrado sem produção por ' || v_user.display_name || ': ' || v_reason
   where id = p_order_id
   returning * into v_order;
  perform private.append_production_session_event(
    v_session, v_user.organization_id, 'cancelled', v_actor, v_user.display_name,
    'cancel:' || v_session::text || ':' || md5(v_now::text),
    jsonb_build_object('order_id', p_order_id, 'reason', v_reason), v_now
  );
  return jsonb_build_object('order', to_jsonb(v_order), 'session_id', v_session);
end;
$$;

create or replace function public.local_get_production_session(
  p_token text,
  p_session_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_session jsonb;
  v_orders jsonb;
  v_events jsonb;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  select to_jsonb(s) into v_session from public.production_sessions s where s.id = p_session_id and s.organization_id = v_org;
  if v_session is null then raise exception 'Sessão de produção não encontrada.'; end if;
  select coalesce(jsonb_agg(to_jsonb(po) order by po.sequence, po.id), '[]'::jsonb)
    into v_orders
    from public.production_session_orders so
    join public.production_orders po on po.id = so.production_order_id
   where so.session_id = p_session_id and so.organization_id = v_org;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at, e.created_at), '[]'::jsonb)
    into v_events
    from public.production_session_events e
   where e.session_id = p_session_id and e.organization_id = v_org;
  return jsonb_build_object('session', v_session, 'orders', v_orders, 'events', v_events);
end;
$$;

revoke all on function public.local_start_production_session(text, uuid[], boolean, text) from public, anon, authenticated;
revoke all on function public.local_resume_production_session(text, uuid[]) from public, anon, authenticated;
revoke all on function public.local_pause_production_session(text, uuid[], text) from public, anon, authenticated;
revoke all on function public.local_complete_production_session(text, uuid[], numeric, numeric, numeric, uuid, text) from public, anon, authenticated;
revoke all on function public.local_record_partial_production_session(text, uuid[], numeric, numeric, text, text, text, numeric, uuid) from public, anon, authenticated;
revoke all on function public.local_get_production_session(text, uuid) from public, anon, authenticated;
revoke all on function public.local_reopen_production_session(text, uuid, text) from public, anon, authenticated;
revoke all on function public.local_record_manual_production_result(text, uuid, numeric, numeric) from public, anon, authenticated;
revoke all on function public.local_cancel_production_order(text, uuid, text) from public, anon, authenticated;
grant execute on function public.local_start_production_session(text, uuid[], boolean, text) to anon, authenticated;
grant execute on function public.local_resume_production_session(text, uuid[]) to anon, authenticated;
grant execute on function public.local_pause_production_session(text, uuid[], text) to anon, authenticated;
grant execute on function public.local_complete_production_session(text, uuid[], numeric, numeric, numeric, uuid, text) to anon, authenticated;
grant execute on function public.local_record_partial_production_session(text, uuid[], numeric, numeric, text, text, text, numeric, uuid) to anon, authenticated;
grant execute on function public.local_get_production_session(text, uuid) to anon, authenticated;
grant execute on function public.local_reopen_production_session(text, uuid, text) to anon, authenticated;
grant execute on function public.local_record_manual_production_result(text, uuid, numeric, numeric) to anon, authenticated;
grant execute on function public.local_cancel_production_order(text, uuid, text) to anon, authenticated;

commit;
