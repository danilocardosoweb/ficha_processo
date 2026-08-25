alter table public.production_orders
  add column if not exists requires_tool_heating boolean not null default false;

update public.production_orders
   set requires_tool_heating = true
 where import_batch_id is not null;

create table public.tool_heating_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_batch_id uuid references public.simplified_imports(id) on delete set null,
  machine_code text not null,
  tool_code text not null,
  oven_code text,
  status text not null default 'heating'
    check (status in ('heating','released','cancelled')),
  required_minutes integer not null check (required_minutes between 1 and 1440),
  entered_at timestamptz not null default now(),
  expected_ready_at timestamptz not null,
  released_at timestamptz,
  cancelled_at timestamptz,
  entered_by_name text not null check (length(trim(entered_by_name)) > 0),
  released_by_name text,
  cancelled_by_name text,
  notes text,
  release_notes text,
  cancellation_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expected_ready_at > entered_at),
  check ((status <> 'released') or (released_at is not null and released_by_name is not null)),
  check ((status <> 'cancelled') or (cancelled_at is not null and cancelled_by_name is not null and cancellation_reason is not null))
);

create unique index tool_heating_cycles_active_tool_idx
  on public.tool_heating_cycles (organization_id, machine_code, upper(tool_code))
  where status = 'heating';
create index tool_heating_cycles_board_idx
  on public.tool_heating_cycles (organization_id, status, expected_ready_at);
create index tool_heating_cycles_import_idx
  on public.tool_heating_cycles (import_batch_id, entered_at desc);

create table public.tool_heating_cycle_orders (
  cycle_id uuid not null references public.tool_heating_cycles(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (cycle_id, production_order_id)
);
create index tool_heating_cycle_orders_order_idx
  on public.tool_heating_cycle_orders (production_order_id, cycle_id);

create or replace function private.align_tool_heating_import_batch()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if (select count(distinct po.import_batch_id)
        from public.tool_heating_cycle_orders co
        join public.production_orders po on po.id = co.production_order_id
       where co.cycle_id = new.cycle_id) > 1 then
    update public.tool_heating_cycles set import_batch_id = null where id = new.cycle_id;
  end if;
  return new;
end;
$$;
create trigger align_tool_heating_import_batch
after insert on public.tool_heating_cycle_orders
for each row execute function private.align_tool_heating_import_batch();

create table public.tool_heating_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cycle_id uuid not null references public.tool_heating_cycles(id) on delete cascade,
  event_type text not null check (event_type in ('entered','released','cancelled')),
  actor_name text not null,
  notes text,
  snapshot jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index tool_heating_history_cycle_idx
  on public.tool_heating_history (cycle_id, occurred_at desc);

create trigger tool_heating_cycles_updated_at
before update on public.tool_heating_cycles
for each row execute function private.set_updated_at();

alter table public.tool_heating_cycles enable row level security;
alter table public.tool_heating_cycle_orders enable row level security;
alter table public.tool_heating_history enable row level security;

create policy tool_heating_cycles_authenticated_select on public.tool_heating_cycles
  for select to authenticated using (organization_id in (select private.authorized_org_ids()));
create policy tool_heating_cycles_authenticated_insert on public.tool_heating_cycles
  for insert to authenticated with check (organization_id in (select private.authorized_org_ids()));
create policy tool_heating_cycles_authenticated_update on public.tool_heating_cycles
  for update to authenticated using (organization_id in (select private.authorized_org_ids()))
  with check (organization_id in (select private.authorized_org_ids()));
create policy tool_heating_cycles_v1_select on public.tool_heating_cycles
  for select to anon using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);
create policy tool_heating_cycles_v1_insert on public.tool_heating_cycles
  for insert to anon with check (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);
create policy tool_heating_cycles_v1_update on public.tool_heating_cycles
  for update to anon using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
  with check (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);

create policy tool_heating_cycle_orders_authenticated_select on public.tool_heating_cycle_orders
  for select to authenticated using (exists (
    select 1 from public.tool_heating_cycles c
    where c.id = cycle_id and c.organization_id in (select private.authorized_org_ids())
  ));
create policy tool_heating_cycle_orders_v1_select on public.tool_heating_cycle_orders
  for select to anon using (exists (
    select 1 from public.tool_heating_cycles c
    where c.id = cycle_id and c.organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid
  ));
create policy tool_heating_cycle_orders_authenticated_insert on public.tool_heating_cycle_orders
  for insert to authenticated with check (exists (
    select 1 from public.tool_heating_cycles c
    join public.production_orders po on po.id = production_order_id
    where c.id = cycle_id and c.organization_id = po.organization_id
      and c.organization_id in (select private.authorized_org_ids())
  ));
create policy tool_heating_cycle_orders_v1_insert on public.tool_heating_cycle_orders
  for insert to anon with check (exists (
    select 1 from public.tool_heating_cycles c
    join public.production_orders po on po.id = production_order_id
    where c.id = cycle_id and c.organization_id = po.organization_id
      and c.organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid
  ));

create policy tool_heating_history_authenticated_select on public.tool_heating_history
  for select to authenticated using (organization_id in (select private.authorized_org_ids()));
create policy tool_heating_history_v1_select on public.tool_heating_history
  for select to anon using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);
create policy tool_heating_history_authenticated_insert on public.tool_heating_history
  for insert to authenticated with check (organization_id in (select private.authorized_org_ids()));
create policy tool_heating_history_v1_insert on public.tool_heating_history
  for insert to anon with check (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);

grant select,insert,update on public.tool_heating_cycles to anon, authenticated;
grant select,insert on public.tool_heating_cycle_orders, public.tool_heating_history to anon, authenticated;
grant usage,select on all sequences in schema public to anon, authenticated;

create or replace function public.start_tool_heating(
  p_order_ids uuid[],
  p_required_minutes integer,
  p_actor text,
  p_oven_code text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cycle_id uuid;
  v_org uuid;
  v_import uuid;
  v_machine text;
  v_tool text;
  v_count integer;
begin
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then
    raise exception 'Selecione ao menos um item da Simplificada.';
  end if;
  if p_required_minutes not between 1 and 1440 then
    raise exception 'Informe um tempo de aquecimento entre 1 e 1440 minutos.';
  end if;
  if nullif(trim(p_actor), '') is null then
    raise exception 'Informe o responsável pela entrada no forno.';
  end if;

  select min(po.organization_id::text)::uuid, min(po.import_batch_id::text)::uuid, min(po.machine_code), min(po.tool_code), count(*)
    into v_org, v_import, v_machine, v_tool, v_count
    from public.production_orders po
    join public.simplified_imports si on si.id = po.import_batch_id
   where po.id = any(p_order_ids)
     and po.is_active = true
     and po.status in ('planned','released','paused')
     and si.status = 'processed'
     and si.is_active = true
     and si.deleted_at is null;

  if v_count <> array_length(p_order_ids, 1) then
    raise exception 'Um ou mais itens não estão disponíveis numa Simplificada ativa.';
  end if;
  if ((select auth.uid()) is null and v_org <> '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
     or ((select auth.uid()) is not null and not exists (
       select 1 from public.organization_members om
       where om.organization_id = v_org and om.user_id = (select auth.uid())
     )) then
    raise exception 'Acesso não autorizado para esta organização.';
  end if;
  if (select count(distinct po.organization_id) from public.production_orders po where po.id = any(p_order_ids)) <> 1
     or (select count(distinct po.machine_code) from public.production_orders po where po.id = any(p_order_ids)) <> 1
     or (select count(distinct upper(po.tool_code)) from public.production_orders po where po.id = any(p_order_ids)) <> 1 then
    raise exception 'Agrupe somente itens da mesma ferramenta e da mesma prensa.';
  end if;
  if exists (
    select 1 from public.tool_heating_cycle_orders co
    join public.tool_heating_cycles c on c.id = co.cycle_id
    where co.production_order_id = any(p_order_ids) and c.status in ('heating','released')
  ) then
    raise exception 'Um dos itens já possui aquecimento ativo ou já foi liberado.';
  end if;

  insert into public.tool_heating_cycles (
    organization_id, import_batch_id, machine_code, tool_code, oven_code,
    required_minutes, entered_at, expected_ready_at, entered_by_name, notes
  ) values (
    v_org, v_import, v_machine, v_tool, nullif(trim(p_oven_code), ''),
    p_required_minutes, now(), now() + make_interval(mins => p_required_minutes), trim(p_actor), nullif(trim(p_notes), '')
  ) returning id into v_cycle_id;

  insert into public.tool_heating_cycle_orders (cycle_id, production_order_id)
  select v_cycle_id, unnest(p_order_ids);

  insert into public.tool_heating_history (organization_id, cycle_id, event_type, actor_name, notes, snapshot)
  select v_org, v_cycle_id, 'entered', trim(p_actor), nullif(trim(p_notes), ''), to_jsonb(c)
  from public.tool_heating_cycles c where c.id = v_cycle_id;

  return v_cycle_id;
end;
$$;

create or replace function public.release_tool_heating(
  p_cycle_id uuid,
  p_actor text,
  p_notes text default null
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cycle public.tool_heating_cycles;
begin
  select * into v_cycle from public.tool_heating_cycles where id = p_cycle_id for update;
  if not found or v_cycle.status <> 'heating' then
    raise exception 'Este aquecimento não está disponível para liberação.';
  end if;
  if ((select auth.uid()) is null and v_cycle.organization_id <> '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
     or ((select auth.uid()) is not null and not exists (
       select 1 from public.organization_members om
       where om.organization_id = v_cycle.organization_id and om.user_id = (select auth.uid())
     )) then
    raise exception 'Acesso não autorizado para esta organização.';
  end if;
  if now() < v_cycle.expected_ready_at then
    raise exception 'O tempo mínimo de aquecimento ainda não foi atingido.';
  end if;
  if nullif(trim(p_actor), '') is null then
    raise exception 'Informe o responsável pela liberação.';
  end if;

  update public.tool_heating_cycles
     set status = 'released', released_at = now(), released_by_name = trim(p_actor),
         release_notes = nullif(trim(p_notes), '')
   where id = p_cycle_id;

  update public.production_orders po
     set status = 'released', last_status_reason = concat('Ferramenta liberada do forno por ', trim(p_actor))
    from public.tool_heating_cycle_orders co
   where co.cycle_id = p_cycle_id and po.id = co.production_order_id and po.status = 'planned';

  insert into public.tool_heating_history (organization_id, cycle_id, event_type, actor_name, notes, snapshot)
  select organization_id, id, 'released', trim(p_actor), nullif(trim(p_notes), ''), to_jsonb(c)
  from public.tool_heating_cycles c where c.id = p_cycle_id;
end;
$$;

create or replace function public.cancel_tool_heating(
  p_cycle_id uuid,
  p_actor text,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org uuid;
begin
  if nullif(trim(p_actor), '') is null or length(trim(coalesce(p_reason, ''))) < 4 then
    raise exception 'Informe o responsável e o motivo do cancelamento.';
  end if;
  select organization_id into v_org from public.tool_heating_cycles where id = p_cycle_id;
  if v_org is null then raise exception 'Aquecimento não encontrado.'; end if;
  if ((select auth.uid()) is null and v_org <> '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
     or ((select auth.uid()) is not null and not exists (
       select 1 from public.organization_members om
       where om.organization_id = v_org and om.user_id = (select auth.uid())
     )) then
    raise exception 'Acesso não autorizado para esta organização.';
  end if;
  update public.tool_heating_cycles
     set status = 'cancelled', cancelled_at = now(), cancelled_by_name = trim(p_actor),
         cancellation_reason = trim(p_reason)
   where id = p_cycle_id and status = 'heating'
   returning organization_id into v_org;
  if not found then raise exception 'Este aquecimento não pode mais ser cancelado.'; end if;
  insert into public.tool_heating_history (organization_id, cycle_id, event_type, actor_name, notes, snapshot)
  select v_org, id, 'cancelled', trim(p_actor), trim(p_reason), to_jsonb(c)
  from public.tool_heating_cycles c where c.id = p_cycle_id;
end;
$$;

revoke all on function public.start_tool_heating(uuid[], integer, text, text, text) from public;
revoke all on function public.release_tool_heating(uuid, text, text) from public;
revoke all on function public.cancel_tool_heating(uuid, text, text) from public;
grant execute on function public.start_tool_heating(uuid[], integer, text, text, text) to anon, authenticated;
grant execute on function public.release_tool_heating(uuid, text, text) to anon, authenticated;
grant execute on function public.cancel_tool_heating(uuid, text, text) to anon, authenticated;

create or replace function private.guard_production_order_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status in ('planned', 'released', 'paused') and new.status in ('in_progress', 'completed', 'cancelled'))
      or (old.status = 'in_progress' and new.status in ('paused', 'completed', 'cancelled'))
      or (old.status = 'completed' and new.status = 'planned'
          and new.reopened_at is not null and new.reprogram_count > old.reprogram_count)
    ) then
      raise exception 'Transição de status não permitida: % para %', old.status, new.status;
    end if;

    if new.status = 'in_progress' then
      if nullif(trim(new.started_by_name), '') is null then
        raise exception 'Informe o operador antes de iniciar a produção';
      end if;
      if new.requires_tool_heating and not exists (
        select 1 from public.tool_heating_cycle_orders co
        join public.tool_heating_cycles c on c.id = co.cycle_id
        where co.production_order_id = new.id and c.status = 'released'
      ) then
        raise exception 'A ferramenta ainda não foi aquecida e liberada pelo Forno.';
      end if;
      new.actual_start := coalesce(new.actual_start, now());
      new.actual_end := null;
      new.is_active := true;
    elsif new.status = 'completed' then
      if nullif(trim(new.completed_by_name), '') is null then
        raise exception 'Informe o operador antes de concluir a produção';
      end if;
      new.actual_start := coalesce(new.actual_start, now());
      new.actual_end := coalesce(new.actual_end, now());
      new.is_active := false;
    elsif old.status = 'completed' and new.status = 'planned' then
      if new.import_batch_id is not null and not exists (
        select 1 from public.simplified_imports si
         where si.id = new.import_batch_id and si.status = 'processed' and si.deleted_at is null
      ) then
        raise exception 'A Simplificada deste item não está disponível para reprogramação.';
      end if;
      if new.import_batch_id is not null then
        update public.simplified_imports set is_active = true, production_status = 'queued',
          production_completed_at = null, production_completed_by_name = null where id = new.import_batch_id;
      end if;
      new.is_active := true;
      new.actual_start := null;
      new.actual_end := null;
      new.started_by_name := null;
      new.completed_by_name := null;
      new.produced_kg := 0;
      new.produced_quantity := 0;
    elsif new.status = 'cancelled' then
      new.is_active := false;
    end if;
  end if;
  return new;
end;
$$;
