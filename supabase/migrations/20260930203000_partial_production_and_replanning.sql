-- A produção parcial nunca encerra nem perde o saldo da ordem.
alter table public.production_orders
  add column if not exists partial_reprogrammed_at timestamptz,
  add column if not exists partial_reprogram_reason text;

create table if not exists public.production_partial_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id) on delete restrict,
  machine_code text not null,
  tool_code text not null,
  started_at timestamptz,
  ended_at timestamptz not null default now(),
  produced_kg numeric(14,3) not null default 0 check (produced_kg >= 0),
  produced_quantity numeric(14,3) not null default 0 check (produced_quantity >= 0),
  achieved_productivity_kg_h numeric(14,3),
  reason_type text not null check (reason_type in ('tool_issue', 'produce_later')),
  reason text not null check (char_length(btrim(reason)) >= 8),
  notes text,
  operator_name text not null,
  process_sheet_id uuid references public.process_sheets(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists production_partial_events_order_idx on public.production_partial_events (production_order_id, ended_at desc);
alter table public.production_partial_events enable row level security;
revoke all on table public.production_partial_events from anon, authenticated;

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
      or (old.status = 'in_progress' and new.status = 'planned'
          and new.partial_reprogrammed_at is distinct from old.partial_reprogrammed_at
          and new.partial_reprogrammed_at is not null
          and char_length(btrim(coalesce(new.partial_reprogram_reason, ''))) >= 8)
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
        select 1 from public.tool_heating_cycle_orders co join public.tool_heating_cycles c on c.id = co.cycle_id
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
    elsif old.status = 'in_progress' and new.status = 'planned' then
      -- A etapa já foi registrada em production_partial_events; o saldo recebe uma nova janela ao iniciar de novo.
      new.is_active := true;
      new.actual_start := null;
      new.actual_end := null;
      new.started_by_name := null;
      new.completed_by_name := null;
    elsif old.status = 'completed' and new.status = 'planned' then
      if new.import_batch_id is not null and not exists (
        select 1 from public.simplified_imports si where si.id = new.import_batch_id and si.status = 'processed' and si.deleted_at is null
      ) then
        raise exception 'A Simplificada deste item não está disponível para reprogramação.';
      end if;
      if new.import_batch_id is not null then
        update public.simplified_imports set is_active = true, production_status = 'queued', production_completed_at = null, production_completed_by_name = null where id = new.import_batch_id;
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

create or replace function public.local_record_partial_production(
  p_token text, p_order_ids uuid[], p_produced_kg numeric, p_produced_quantity numeric,
  p_reason_type text, p_reason text, p_notes text default null,
  p_achieved_productivity_kg_h numeric default null, p_process_sheet_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, extensions
as $$
declare
  v_actor uuid; v_user private.local_users%rowtype; v_org uuid; v_machine text; v_tool text;
  v_count integer; v_total_kg numeric := 0; v_total_quantity numeric := 0;
  v_allocated_kg numeric := 0; v_allocated_quantity numeric := 0; v_index integer := 0; v_expected integer;
  v_order public.production_orders%rowtype; v_delta_kg numeric; v_delta_quantity numeric;
  v_status text; v_orders jsonb := '[]'::jsonb; v_now timestamptz := clock_timestamp();
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  if v_user.role = 'viewer' then raise exception 'Seu perfil possui somente permissão de consulta.' using errcode = '42501'; end if;
  if coalesce(array_length(p_order_ids, 1), 0) = 0 then raise exception 'Selecione ao menos um item.'; end if;
  if coalesce(p_produced_kg, 0) <= 0 and coalesce(p_produced_quantity, 0) <= 0 then raise exception 'Informe o resultado produzido nesta etapa.'; end if;
  if p_reason_type not in ('tool_issue', 'produce_later') then raise exception 'Motivo de parcial inválido.'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 8 then raise exception 'Explique o motivo da produção parcial (mínimo de 8 caracteres).'; end if;
  if p_achieved_productivity_kg_h is not null and (p_achieved_productivity_kg_h <= 0 or p_achieved_productivity_kg_h > 2500) then raise exception 'Produtividade informada inválida.'; end if;

  select min(po.organization_id::text)::uuid, min(po.machine_code), min(po.tool_code), count(*), count(*)
    into v_org, v_machine, v_tool, v_count, v_expected
  from public.production_orders po where po.id = any(p_order_ids) and po.is_active and po.status = 'in_progress';
  if v_count <> array_length(p_order_ids, 1) then raise exception 'Um dos itens não está em produção. Atualize a tela antes de apontar.'; end if;
  if v_org is distinct from v_user.organization_id then raise exception 'Acesso não autorizado para esta organização.' using errcode = '42501'; end if;
  if (select count(distinct po.machine_code) from public.production_orders po where po.id = any(p_order_ids)) <> 1
     or (select count(distinct upper(po.tool_code)) from public.production_orders po where po.id = any(p_order_ids)) <> 1 then raise exception 'Aponte somente itens da mesma ferramenta e da mesma prensa.'; end if;
  if v_user.role = 'operator' and cardinality(v_user.machine_codes) > 0 and not (v_machine = any(v_user.machine_codes)) then raise exception 'Seu usuário não possui acesso à prensa selecionada.' using errcode = '42501'; end if;

  select coalesce(sum(greatest(coalesce(target_kg, 0) - coalesce(produced_kg, 0), 0)), 0), coalesce(sum(greatest(coalesce(target_quantity, 0) - coalesce(produced_quantity, 0), 0)), 0)
    into v_total_kg, v_total_quantity from public.production_orders where id = any(p_order_ids);
  if coalesce(p_produced_kg, 0) > v_total_kg + 0.001 or (v_total_quantity > 0 and coalesce(p_produced_quantity, 0) > v_total_quantity + 0.001) then raise exception 'O resultado parcial não pode ultrapassar o saldo planejado.'; end if;
  v_status := case when p_reason_type = 'tool_issue' then 'paused' else 'planned' end;

  for v_order in select * from public.production_orders where id = any(p_order_ids) order by sequence, id for update loop
    v_index := v_index + 1;
    v_delta_kg := case when v_index = v_expected then coalesce(p_produced_kg, 0) - v_allocated_kg when v_total_kg > 0 then least(greatest(v_order.target_kg - v_order.produced_kg, 0), round(coalesce(p_produced_kg, 0) * greatest(v_order.target_kg - v_order.produced_kg, 0) / v_total_kg, 3)) else 0 end;
    v_delta_quantity := case when v_index = v_expected then coalesce(p_produced_quantity, 0) - v_allocated_quantity when v_total_quantity > 0 then least(greatest(v_order.target_quantity - v_order.produced_quantity, 0), round(coalesce(p_produced_quantity, 0) * greatest(v_order.target_quantity - v_order.produced_quantity, 0) / v_total_quantity, 3)) else 0 end;
    v_allocated_kg := v_allocated_kg + v_delta_kg; v_allocated_quantity := v_allocated_quantity + v_delta_quantity;
    insert into public.production_partial_events (organization_id, production_order_id, machine_code, tool_code, started_at, ended_at, produced_kg, produced_quantity, achieved_productivity_kg_h, reason_type, reason, notes, operator_name, process_sheet_id)
    values (v_order.organization_id, v_order.id, v_order.machine_code, v_order.tool_code, v_order.actual_start, v_now, greatest(v_delta_kg, 0), greatest(v_delta_quantity, 0), p_achieved_productivity_kg_h, p_reason_type, btrim(p_reason), nullif(btrim(coalesce(p_notes, '')), ''), v_user.display_name, p_process_sheet_id);
    update public.production_orders po set status = v_status, produced_kg = coalesce(po.produced_kg, 0) + greatest(v_delta_kg, 0), produced_quantity = coalesce(po.produced_quantity, 0) + greatest(v_delta_quantity, 0), process_sheet_id = coalesce(p_process_sheet_id, po.process_sheet_id), achieved_productivity_kg_h = coalesce(p_achieved_productivity_kg_h, po.achieved_productivity_kg_h), partial_reprogrammed_at = case when p_reason_type = 'produce_later' then v_now else po.partial_reprogrammed_at end, partial_reprogram_reason = case when p_reason_type = 'produce_later' then btrim(p_reason) else po.partial_reprogram_reason end, last_status_reason = case when p_reason_type = 'tool_issue' then 'Produção parcial pausada por problema de ferramenta: ' else 'Produção parcial devolvida à programação: ' end || btrim(p_reason) where po.id = v_order.id returning v_orders || jsonb_build_array(to_jsonb(po)) into v_orders;
  end loop;
  insert into private.local_user_audit (organization_id, actor_user_id, event_type, details) values (v_org, v_actor, 'partial_production_recorded', jsonb_build_object('order_ids', p_order_ids, 'reason_type', p_reason_type, 'produced_kg', p_produced_kg, 'produced_quantity', p_produced_quantity, 'reason', btrim(p_reason)));
  return jsonb_build_object('orders', v_orders, 'status', v_status);
end;
$$;
revoke all on function public.local_record_partial_production(text, uuid[], numeric, numeric, text, text, text, numeric, uuid) from public, anon, authenticated;
grant execute on function public.local_record_partial_production(text, uuid[], numeric, numeric, text, text, text, numeric, uuid) to anon, authenticated;
