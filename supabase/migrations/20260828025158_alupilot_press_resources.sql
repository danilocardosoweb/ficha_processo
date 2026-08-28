-- Press-scoped carcass resources used by the AluPilot capacity checks.
-- Holes and BO remain attributes of the tool/setup and are captured in each
-- simulation snapshot; this migration models the finite physical resource.

begin;

create table public.press_carcass_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  machine_code text not null,
  carcass_code text not null,
  total_quantity integer not null default 1 check (total_quantity >= 0),
  unavailable_quantity integer not null default 0 check (unavailable_quantity >= 0 and unavailable_quantity <= total_quantity),
  status text not null default 'available' check (status in ('available', 'maintenance', 'blocked', 'inactive')),
  location text,
  notes text,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, machine_code, carcass_code),
  constraint press_carcass_machine_not_blank check (btrim(machine_code) <> ''),
  constraint press_carcass_code_not_blank check (btrim(carcass_code) <> '')
);

create table public.press_carcass_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  carcass_resource_id uuid not null references public.press_carcass_resources(id) on delete restrict,
  simulation_version_id uuid references public.simulation_versions(id) on delete set null,
  production_order_id uuid references public.production_orders(id) on delete set null,
  quantity integer not null default 1 check (quantity > 0),
  starts_at timestamptz,
  ends_at timestamptz,
  status text not null default 'active' check (status in ('active', 'released', 'cancelled')),
  notes text,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint press_carcass_reservation_period check (starts_at is null or ends_at is null or ends_at >= starts_at)
);

create index press_carcass_resource_lookup_idx on public.press_carcass_resources (organization_id, machine_code, carcass_code, status);
create index press_carcass_reservation_lookup_idx on public.press_carcass_reservations (carcass_resource_id, status, starts_at, ends_at) where status = 'active';

create trigger press_carcass_resources_updated_at before update on public.press_carcass_resources for each row execute function private.set_updated_at();
create trigger press_carcass_reservations_updated_at before update on public.press_carcass_reservations for each row execute function private.set_updated_at();
create trigger audit_press_carcass_resources_trg after insert or update or delete on public.press_carcass_resources for each row execute function public.audit_operational_change();
create trigger audit_press_carcass_reservations_trg after insert or update or delete on public.press_carcass_reservations for each row execute function public.audit_operational_change();

alter table public.press_carcass_resources enable row level security;
alter table public.press_carcass_reservations enable row level security;
revoke all on public.press_carcass_resources from public, anon, authenticated;
revoke all on public.press_carcass_reservations from public, anon, authenticated;

create or replace function public.local_list_press_carcass_resources(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_org uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'machineCode', c.machine_code, 'carcassCode', c.carcass_code,
      'totalQuantity', c.total_quantity, 'unavailableQuantity', c.unavailable_quantity,
      'reservedQuantity', coalesce(r.reserved_quantity, 0),
      'availableQuantity', case when c.status = 'available' then greatest(c.total_quantity - c.unavailable_quantity - coalesce(r.reserved_quantity, 0), 0) else 0 end,
      'status', c.status, 'location', c.location, 'notes', c.notes, 'updatedAt', c.updated_at
    ) order by c.machine_code, c.carcass_code)
    from public.press_carcass_resources c
    left join lateral (
      select coalesce(sum(cr.quantity), 0)::integer reserved_quantity
      from public.press_carcass_reservations cr
      where cr.carcass_resource_id = c.id and cr.status = 'active'
        and (cr.ends_at is null or cr.ends_at > now())
    ) r on true
    where c.organization_id = v_org
  ), '[]'::jsonb);
end;
$$;

create or replace function public.local_upsert_press_carcass_resource(
  p_token text, p_id uuid, p_machine_code text, p_carcass_code text,
  p_total_quantity integer, p_unavailable_quantity integer, p_status text,
  p_location text, p_notes text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_org uuid; v_role text; v_name text; v_id uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id, role::text, coalesce(full_name, username) into v_org, v_role, v_name from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp', 'engineering') then raise exception 'Perfil sem permissão para alterar carcaças.'; end if;
  if btrim(coalesce(p_machine_code, '')) = '' or btrim(coalesce(p_carcass_code, '')) = '' then raise exception 'Informe prensa e carcaça.'; end if;
  if p_total_quantity < 0 or p_unavailable_quantity < 0 or p_unavailable_quantity > p_total_quantity then raise exception 'Quantidades inválidas.'; end if;
  if p_status not in ('available', 'maintenance', 'blocked', 'inactive') then raise exception 'Status inválido.'; end if;
  if p_id is null then
    insert into public.press_carcass_resources (organization_id, machine_code, carcass_code, total_quantity, unavailable_quantity, status, location, notes, created_by_user_id, updated_by_user_id, updated_by_name)
    values (v_org, btrim(p_machine_code), upper(btrim(p_carcass_code)), p_total_quantity, p_unavailable_quantity, p_status, nullif(btrim(coalesce(p_location, '')), ''), nullif(btrim(coalesce(p_notes, '')), ''), v_actor, v_actor, v_name)
    returning id into v_id;
  else
    update public.press_carcass_resources set machine_code = btrim(p_machine_code), carcass_code = upper(btrim(p_carcass_code)), total_quantity = p_total_quantity,
      unavailable_quantity = p_unavailable_quantity, status = p_status, location = nullif(btrim(coalesce(p_location, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_by_user_id = v_actor, updated_by_name = v_name
    where id = p_id and organization_id = v_org returning id into v_id;
    if v_id is null then raise exception 'Carcaça não encontrada.'; end if;
  end if;
  return v_id;
end;
$$;

revoke all on function public.local_list_press_carcass_resources(text) from public;
revoke all on function public.local_upsert_press_carcass_resource(text, uuid, text, text, integer, integer, text, text, text) from public;
grant execute on function public.local_list_press_carcass_resources(text) to anon, authenticated;
grant execute on function public.local_upsert_press_carcass_resource(text, uuid, text, text, integer, integer, text, text, text) to anon, authenticated;

commit;
