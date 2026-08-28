begin;

-- Operational requirements imported with each Simplificada must be first-class
-- fields. The original JSON source remains intact for traceability.
alter table public.production_orders
  add column if not exists holes integer,
  add column if not exists bo_code text,
  add column if not exists carcass_code text;

alter table public.production_orders
  drop constraint if exists production_orders_holes_positive;

alter table public.production_orders
  add constraint production_orders_holes_positive
  check (holes is null or holes > 0);

update public.production_orders
set
  holes = coalesce(
    holes,
    case
      when btrim(coalesce(source_data ->> 'furos', '')) ~ '^[0-9]+([.,][0-9]+)?$'
        then greatest(round(replace(source_data ->> 'furos', ',', '.')::numeric)::integer, 1)
      else null
    end
  ),
  bo_code = coalesce(
    nullif(btrim(bo_code), ''),
    nullif(btrim(source_data ->> 'bo'), '')
  );

update public.production_orders as production_order
set carcass_code = coalesce(
  nullif(btrim(production_order.carcass_code), ''),
  nullif(btrim(production_order.source_data ->> 'carcaca'), ''),
  nullif(btrim(production_order.source_data ->> 'carcassCode'), ''),
  (
    select nullif(btrim(process_sheet.parameters #>> '{billet,casing}'), '')
    from public.process_sheets as process_sheet
    where process_sheet.organization_id = production_order.organization_id
      and process_sheet.is_active = true
      and upper(btrim(process_sheet.tool_code)) = upper(btrim(production_order.tool_code))
      and (process_sheet.machine_code is null or process_sheet.machine_code = production_order.machine_code)
      and nullif(btrim(process_sheet.parameters #>> '{billet,casing}'), '') is not null
    order by
      case when process_sheet.machine_code = production_order.machine_code then 0 else 1 end,
      process_sheet.updated_at desc
    limit 1
  )
)
where nullif(btrim(production_order.carcass_code), '') is null;

comment on column public.production_orders.holes is
  'Quantidade de furos informada pela Simplificada para a execução planejada.';
comment on column public.production_orders.bo_code is
  'BO informado pela Simplificada para a ferramenta na execução planejada.';
comment on column public.production_orders.carcass_code is
  'Carcaça requerida pela execução, herdada da ordem ou da ficha de processo.';

-- Carcasses are a shared physical pool. They can serve either press, but the
-- same unit cannot be reserved by two overlapping operations.
alter table public.press_carcass_resources
  drop constraint if exists press_carcass_resources_organization_id_machine_code_carcass_code_key;

update public.press_carcass_resources
set machine_code = 'SHARED'
where machine_code <> 'SHARED';

alter table public.press_carcass_resources
  add constraint press_carcass_resources_organization_carcass_code_key
  unique (organization_id, carcass_code);

comment on column public.press_carcass_resources.machine_code is
  'Compatibilidade legada. SHARED indica o estoque único utilizado pelas duas prensas.';

drop index if exists public.press_carcass_resource_lookup_idx;
create index press_carcass_resource_lookup_idx
  on public.press_carcass_resources (organization_id, carcass_code, status);

create or replace function public.local_list_press_carcass_resources(p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_org uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'machineCode', 'SHARED',
      'sharedAcrossMachines', true,
      'carcassCode', c.carcass_code,
      'totalQuantity', c.total_quantity,
      'unavailableQuantity', c.unavailable_quantity,
      'reservedQuantity', coalesce(r.reserved_quantity, 0),
      'availableQuantity', case when c.status = 'available' then greatest(c.total_quantity - c.unavailable_quantity - coalesce(r.reserved_quantity, 0), 0) else 0 end,
      'status', c.status,
      'location', c.location,
      'notes', c.notes,
      'updatedAt', c.updated_at
    ) order by c.carcass_code)
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
  select organization_id, role::text, coalesce(display_name, username)
    into v_org, v_role, v_name
  from private.local_users where id = v_actor;
  if v_role not in ('admin', 'pcp', 'engineering') then raise exception 'Perfil sem permissão para alterar carcaças.'; end if;
  if btrim(coalesce(p_carcass_code, '')) = '' then raise exception 'Informe a carcaça.'; end if;
  if p_total_quantity < 0 or p_unavailable_quantity < 0 or p_unavailable_quantity > p_total_quantity then raise exception 'Quantidades inválidas.'; end if;
  if p_status not in ('available', 'maintenance', 'blocked', 'inactive') then raise exception 'Status inválido.'; end if;
  if p_id is null then
    insert into public.press_carcass_resources (
      organization_id, machine_code, carcass_code, total_quantity,
      unavailable_quantity, status, location, notes,
      created_by_user_id, updated_by_user_id, updated_by_name
    ) values (
      v_org, 'SHARED', upper(btrim(p_carcass_code)), p_total_quantity,
      p_unavailable_quantity, p_status, nullif(btrim(coalesce(p_location, '')), ''),
      nullif(btrim(coalesce(p_notes, '')), ''), v_actor, v_actor, v_name
    ) returning id into v_id;
  else
    update public.press_carcass_resources set
      machine_code = 'SHARED',
      carcass_code = upper(btrim(p_carcass_code)),
      total_quantity = p_total_quantity,
      unavailable_quantity = p_unavailable_quantity,
      status = p_status,
      location = nullif(btrim(coalesce(p_location, '')), ''),
      notes = nullif(btrim(coalesce(p_notes, '')), ''),
      updated_by_user_id = v_actor,
      updated_by_name = v_name
    where id = p_id and organization_id = v_org
    returning id into v_id;
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
