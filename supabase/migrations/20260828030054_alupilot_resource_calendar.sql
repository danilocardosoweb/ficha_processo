-- Planned unavailability calendar used by the deterministic simulator.
begin;

create table public.resource_unavailability_periods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  resource_type text not null check (resource_type in ('press', 'oven', 'tool', 'carcass')),
  resource_code text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  notes text,
  created_by_user_id uuid,
  updated_by_user_id uuid,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resource_unavailability_code_not_blank check (btrim(resource_code) <> ''),
  constraint resource_unavailability_reason_not_blank check (btrim(reason) <> ''),
  constraint resource_unavailability_period_valid check (ends_at > starts_at)
);

create index resource_unavailability_calendar_idx on public.resource_unavailability_periods (organization_id, resource_type, resource_code, starts_at, ends_at) where status = 'active';
create trigger resource_unavailability_updated_at before update on public.resource_unavailability_periods for each row execute function private.set_updated_at();
create trigger audit_resource_unavailability_trg after insert or update or delete on public.resource_unavailability_periods for each row execute function public.audit_operational_change();
alter table public.resource_unavailability_periods enable row level security;
revoke all on public.resource_unavailability_periods from public, anon, authenticated;

create or replace function public.local_list_resource_unavailability(p_token text, p_from timestamptz default now(), p_to timestamptz default now() + interval '90 days')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_org uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', p.id, 'resourceType', p.resource_type, 'resourceCode', p.resource_code,
    'startsAt', p.starts_at, 'endsAt', p.ends_at, 'reason', p.reason,
    'status', p.status, 'notes', p.notes, 'updatedAt', p.updated_at
  ) order by p.starts_at)
  from public.resource_unavailability_periods p
  where p.organization_id = v_org and p.ends_at >= p_from and p.starts_at <= p_to), '[]'::jsonb);
end;
$$;

create or replace function public.local_upsert_resource_unavailability(
  p_token text, p_id uuid, p_resource_type text, p_resource_code text,
  p_starts_at timestamptz, p_ends_at timestamptz, p_reason text, p_status text, p_notes text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_org uuid; v_role text; v_name text; v_id uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id, role::text, coalesce(full_name, username) into v_org, v_role, v_name from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp', 'maintenance') then raise exception 'Perfil sem permissão para alterar indisponibilidades.'; end if;
  if p_resource_type not in ('press', 'oven', 'tool', 'carcass') then raise exception 'Tipo de recurso inválido.'; end if;
  if btrim(coalesce(p_resource_code, '')) = '' or btrim(coalesce(p_reason, '')) = '' then raise exception 'Informe recurso e motivo.'; end if;
  if p_ends_at <= p_starts_at then raise exception 'O fim deve ser posterior ao início.'; end if;
  if p_status not in ('active', 'cancelled') then raise exception 'Status inválido.'; end if;
  if p_id is null then
    insert into public.resource_unavailability_periods (organization_id, resource_type, resource_code, starts_at, ends_at, reason, status, notes, created_by_user_id, updated_by_user_id, updated_by_name)
    values (v_org, p_resource_type, upper(btrim(p_resource_code)), p_starts_at, p_ends_at, btrim(p_reason), p_status, nullif(btrim(coalesce(p_notes, '')), ''), v_actor, v_actor, v_name)
    returning id into v_id;
  else
    update public.resource_unavailability_periods set resource_type = p_resource_type, resource_code = upper(btrim(p_resource_code)), starts_at = p_starts_at,
      ends_at = p_ends_at, reason = btrim(p_reason), status = p_status, notes = nullif(btrim(coalesce(p_notes, '')), ''), updated_by_user_id = v_actor, updated_by_name = v_name
    where id = p_id and organization_id = v_org returning id into v_id;
    if v_id is null then raise exception 'Indisponibilidade não encontrada.'; end if;
  end if;
  return v_id;
end;
$$;

revoke all on function public.local_list_resource_unavailability(text, timestamptz, timestamptz) from public;
revoke all on function public.local_upsert_resource_unavailability(text, uuid, text, text, timestamptz, timestamptz, text, text, text) from public;
grant execute on function public.local_list_resource_unavailability(text, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.local_upsert_resource_unavailability(text, uuid, text, text, timestamptz, timestamptz, text, text, text) to anon, authenticated;

commit;
