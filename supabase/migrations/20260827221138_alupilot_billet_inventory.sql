-- Physical billet inventory and reservations for AluPilot planning.
-- Direct table access stays closed because this project authenticates through
-- opaque local sessions. All access is mediated by token-aware RPCs.

begin;

create table public.billet_stock_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alloy_code text not null,
  lot_code text not null,
  bar_weight_kg numeric(12,3) not null default 415 check (bar_weight_kg > 0),
  total_bars integer not null default 0 check (total_bars >= 0),
  status text not null default 'available' check (status in ('available', 'blocked', 'depleted')),
  location text,
  received_at timestamptz not null default now(),
  notes text,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, lot_code),
  constraint billet_stock_alloy_not_blank check (btrim(alloy_code) <> ''),
  constraint billet_stock_lot_not_blank check (btrim(lot_code) <> '')
);

create table public.billet_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stock_lot_id uuid not null references public.billet_stock_lots(id) on delete restrict,
  simulation_version_id uuid references public.simulation_versions(id) on delete set null,
  production_order_id uuid references public.production_orders(id) on delete set null,
  reserved_bars integer not null check (reserved_bars > 0),
  consumed_bars integer not null default 0 check (consumed_bars >= 0 and consumed_bars <= reserved_bars),
  status text not null default 'active' check (status in ('active', 'released', 'consumed', 'cancelled')),
  notes text,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index billet_stock_lots_org_alloy_idx
  on public.billet_stock_lots (organization_id, alloy_code, status, received_at);
create index billet_reservations_active_lot_idx
  on public.billet_reservations (stock_lot_id, status)
  where status = 'active';
create index billet_reservations_scenario_idx
  on public.billet_reservations (simulation_version_id)
  where simulation_version_id is not null;

create trigger billet_stock_lots_updated_at
before update on public.billet_stock_lots
for each row execute function private.set_updated_at();

create trigger billet_reservations_updated_at
before update on public.billet_reservations
for each row execute function private.set_updated_at();

create trigger audit_billet_stock_lots_trg
after insert or update or delete on public.billet_stock_lots
for each row execute function public.audit_operational_change();

create trigger audit_billet_reservations_trg
after insert or update or delete on public.billet_reservations
for each row execute function public.audit_operational_change();

alter table public.billet_stock_lots enable row level security;
alter table public.billet_reservations enable row level security;

revoke all on public.billet_stock_lots from public, anon, authenticated;
revoke all on public.billet_reservations from public, anon, authenticated;

create or replace function public.local_list_billet_stock(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;

  return jsonb_build_object(
    'lots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'alloyCode', l.alloy_code,
        'lotCode', l.lot_code,
        'barWeightKg', l.bar_weight_kg,
        'totalBars', l.total_bars,
        'reservedBars', greatest(coalesce(r.reserved_bars, 0), 0),
        'availableBars', greatest(l.total_bars - coalesce(r.reserved_bars, 0), 0),
        'status', l.status,
        'location', l.location,
        'receivedAt', l.received_at,
        'notes', l.notes,
        'updatedAt', l.updated_at
      ) order by l.alloy_code, l.received_at, l.lot_code)
      from public.billet_stock_lots l
      left join lateral (
        select coalesce(sum(br.reserved_bars - br.consumed_bars), 0)::integer as reserved_bars
        from public.billet_reservations br
        where br.stock_lot_id = l.id and br.status = 'active'
      ) r on true
      where l.organization_id = v_org
    ), '[]'::jsonb),
    'summary', coalesce((
      select jsonb_agg(jsonb_build_object(
        'alloyCode', grouped.alloy_code,
        'lotCount', grouped.lot_count,
        'totalBars', grouped.total_bars,
        'reservedBars', grouped.reserved_bars,
        'availableBars', grouped.available_bars,
        'totalWeightKg', grouped.total_weight_kg,
        'availableWeightKg', grouped.available_weight_kg
      ) order by grouped.alloy_code)
      from (
        select
          upper(btrim(l.alloy_code)) as alloy_code,
          count(*)::integer as lot_count,
          sum(l.total_bars)::integer as total_bars,
          sum(coalesce(r.reserved_bars, 0))::integer as reserved_bars,
          sum(case when l.status = 'available' then greatest(l.total_bars - coalesce(r.reserved_bars, 0), 0) else 0 end)::integer as available_bars,
          sum(l.total_bars * l.bar_weight_kg)::numeric as total_weight_kg,
          sum(case when l.status = 'available' then greatest(l.total_bars - coalesce(r.reserved_bars, 0), 0) * l.bar_weight_kg else 0 end)::numeric as available_weight_kg
        from public.billet_stock_lots l
        left join lateral (
          select coalesce(sum(br.reserved_bars - br.consumed_bars), 0)::integer as reserved_bars
          from public.billet_reservations br
          where br.stock_lot_id = l.id and br.status = 'active'
        ) r on true
        where l.organization_id = v_org
        group by upper(btrim(l.alloy_code))
      ) grouped
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.local_upsert_billet_stock_lot(
  p_token text,
  p_id uuid,
  p_alloy_code text,
  p_lot_code text,
  p_bar_weight_kg numeric,
  p_total_bars integer,
  p_status text,
  p_location text,
  p_received_at timestamptz,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_role text;
  v_name text;
  v_id uuid;
  v_reserved integer;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id, role::text, coalesce(full_name, username)
    into v_org, v_role, v_name
  from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp') then raise exception 'Perfil sem permissão para alterar estoque.'; end if;
  if btrim(coalesce(p_alloy_code, '')) = '' or btrim(coalesce(p_lot_code, '')) = '' then raise exception 'Informe liga e lote.'; end if;
  if p_bar_weight_kg <= 0 or p_total_bars < 0 then raise exception 'Peso e quantidade inválidos.'; end if;
  if p_status not in ('available', 'blocked', 'depleted') then raise exception 'Status inválido.'; end if;

  if p_id is null then
    insert into public.billet_stock_lots (
      organization_id, alloy_code, lot_code, bar_weight_kg, total_bars, status,
      location, received_at, notes, created_by_user_id, updated_by_user_id, updated_by_name
    ) values (
      v_org, upper(btrim(p_alloy_code)), btrim(p_lot_code), p_bar_weight_kg, p_total_bars, p_status,
      nullif(btrim(coalesce(p_location, '')), ''), coalesce(p_received_at, now()), nullif(btrim(coalesce(p_notes, '')), ''),
      v_actor, v_actor, v_name
    ) returning id into v_id;
  else
    select coalesce(sum(reserved_bars - consumed_bars), 0)::integer into v_reserved
    from public.billet_reservations
    where stock_lot_id = p_id and organization_id = v_org and status = 'active';
    if p_total_bars < v_reserved then raise exception 'O total não pode ser menor que as barras já reservadas (%).', v_reserved; end if;
    update public.billet_stock_lots set
      alloy_code = upper(btrim(p_alloy_code)), lot_code = btrim(p_lot_code),
      bar_weight_kg = p_bar_weight_kg, total_bars = p_total_bars, status = p_status,
      location = nullif(btrim(coalesce(p_location, '')), ''), received_at = coalesce(p_received_at, received_at),
      notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_by_user_id = v_actor, updated_by_name = v_name
    where id = p_id and organization_id = v_org returning id into v_id;
    if v_id is null then raise exception 'Lote não encontrado.'; end if;
  end if;
  return v_id;
end;
$$;

create or replace function public.local_reserve_billet_stock(
  p_token text,
  p_alloy_code text,
  p_bars integer,
  p_simulation_version_id uuid default null,
  p_production_order_id uuid default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_role text;
  v_name text;
  v_remaining integer := p_bars;
  v_available integer;
  v_take integer;
  v_lot record;
  v_allocations jsonb := '[]'::jsonb;
  v_reservation_id uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id, role::text, coalesce(full_name, username)
    into v_org, v_role, v_name from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp') then raise exception 'Perfil sem permissão para reservar estoque.'; end if;
  if p_bars is null or p_bars <= 0 then raise exception 'Informe uma quantidade de barras maior que zero.'; end if;

  select coalesce(sum(greatest(l.total_bars - coalesce(r.reserved_bars, 0), 0)), 0)::integer into v_available
  from public.billet_stock_lots l
  left join lateral (
    select coalesce(sum(br.reserved_bars - br.consumed_bars), 0)::integer reserved_bars
    from public.billet_reservations br where br.stock_lot_id = l.id and br.status = 'active'
  ) r on true
  where l.organization_id = v_org and l.status = 'available' and upper(btrim(l.alloy_code)) = upper(btrim(p_alloy_code));
  if v_available < p_bars then raise exception 'Estoque insuficiente: % barra(s) disponível(is) para % solicitada(s).', v_available, p_bars; end if;

  for v_lot in
    select l.id, l.lot_code, greatest(l.total_bars - coalesce(r.reserved_bars, 0), 0)::integer available_bars
    from public.billet_stock_lots l
    left join lateral (
      select coalesce(sum(br.reserved_bars - br.consumed_bars), 0)::integer reserved_bars
      from public.billet_reservations br where br.stock_lot_id = l.id and br.status = 'active'
    ) r on true
    where l.organization_id = v_org and l.status = 'available' and upper(btrim(l.alloy_code)) = upper(btrim(p_alloy_code))
    order by l.received_at, l.created_at
    for update of l
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, v_lot.available_bars);
    if v_take <= 0 then continue; end if;
    insert into public.billet_reservations (
      organization_id, stock_lot_id, simulation_version_id, production_order_id,
      reserved_bars, status, notes, created_by_user_id, updated_by_user_id, updated_by_name
    ) values (
      v_org, v_lot.id, p_simulation_version_id, p_production_order_id,
      v_take, 'active', nullif(btrim(coalesce(p_notes, '')), ''), v_actor, v_actor, v_name
    ) returning id into v_reservation_id;
    v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
      'reservationId', v_reservation_id, 'lotId', v_lot.id, 'lotCode', v_lot.lot_code, 'bars', v_take
    ));
    v_remaining := v_remaining - v_take;
  end loop;
  if v_remaining > 0 then
    raise exception 'O estoque mudou durante a reserva. Atualize a tela e tente novamente.';
  end if;
  return jsonb_build_object('alloyCode', upper(btrim(p_alloy_code)), 'bars', p_bars, 'allocations', v_allocations);
end;
$$;

create or replace function public.local_release_billet_reservation(p_token text, p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_role text;
  v_name text;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id, role::text, coalesce(full_name, username)
    into v_org, v_role, v_name from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp') then raise exception 'Perfil sem permissão para liberar reservas.'; end if;
  update public.billet_reservations set status = 'released', updated_by_user_id = v_actor, updated_by_name = v_name
  where id = p_reservation_id and organization_id = v_org and status = 'active';
  return found;
end;
$$;

revoke all on function public.local_list_billet_stock(text) from public;
revoke all on function public.local_upsert_billet_stock_lot(text, uuid, text, text, numeric, integer, text, text, timestamptz, text) from public;
revoke all on function public.local_reserve_billet_stock(text, text, integer, uuid, uuid, text) from public;
revoke all on function public.local_release_billet_reservation(text, uuid) from public;

grant execute on function public.local_list_billet_stock(text) to anon, authenticated;
grant execute on function public.local_upsert_billet_stock_lot(text, uuid, text, text, numeric, integer, text, text, timestamptz, text) to anon, authenticated;
grant execute on function public.local_reserve_billet_stock(text, text, integer, uuid, uuid, text) to anon, authenticated;
grant execute on function public.local_release_billet_reservation(text, uuid) to anon, authenticated;

commit;
