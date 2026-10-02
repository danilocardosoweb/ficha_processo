-- A reserva aprovada deve representar a vaga física ocupada até a retirada da
-- ferramenta para extrusão. A prontidão térmica não libera a posição do forno.

create or replace function public.capture_approved_simulation_oven_reservations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version_id uuid;
  v_result jsonb;
  v_item jsonb;
  v_slot integer;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_oven_code text;
  v_oven_position integer;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  select v.id, v.result_snapshot
    into v_version_id, v_result
  from public.simulation_versions v
  where v.scenario_id = new.id
    and v.version_number = new.current_version;

  if v_version_id is null then
    return new;
  end if;

  delete from public.simulation_resource_events
  where simulation_version_id = v_version_id
    and resource_type = 'oven';

  for v_item in
    select item.value
    from jsonb_array_elements(coalesce(v_result -> 'machines', '[]'::jsonb)) machine,
         jsonb_array_elements(coalesce(machine.value -> 'items', '[]'::jsonb)) item
  loop
    v_slot := nullif(v_item ->> 'ovenSlotNumber', '')::integer;
    v_starts_at := nullif(v_item ->> 'toolHeatingStartAt', '')::timestamptz;
    v_ends_at := coalesce(
      nullif(v_item ->> 'toolOvenExitAt', '')::timestamptz,
      nullif(v_item ->> 'extrusionStartAt', '')::timestamptz,
      nullif(v_item ->> 'calculatedToolReadyAt', '')::timestamptz
    );
    v_oven_code := coalesce(nullif(v_item ->> 'ovenCode', ''), 'VAGA');
    v_oven_position := coalesce(nullif(v_item ->> 'ovenPosition', '')::integer, v_slot);

    if v_slot is not null and v_starts_at is not null and v_ends_at is not null and v_ends_at > v_starts_at then
      insert into public.simulation_resource_events (
        organization_id, simulation_version_id, resource_type, resource_code,
        event_type, starts_at, ends_at, quantity, unit, metadata
      ) values (
        new.organization_id,
        v_version_id,
        'oven',
        coalesce(nullif(v_item ->> 'machineCode', ''), 'SEM-PRENSA') || ':' || v_oven_code || ':' || coalesce(v_oven_position::text, v_slot::text),
        'reserved',
        v_starts_at,
        v_ends_at,
        1,
        'slot',
        jsonb_build_object(
          'orderId', v_item ->> 'id',
          'toolCode', v_item ->> 'toolCode',
          'machineCode', v_item ->> 'machineCode',
          'ovenCode', v_oven_code,
          'ovenPosition', v_oven_position,
          'slotNumber', v_slot,
          'toolOvenExitAt', v_ends_at
        )
      );
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.capture_approved_simulation_oven_reservations() from public;
