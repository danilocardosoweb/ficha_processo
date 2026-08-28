-- Complete the approved resource calendar with the oven slot selected by Simulator V2.
-- The approval RPC writes press/tool/carcass events before changing the scenario status;
-- this trigger appends oven reservations only after that atomic approval succeeds.

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
    v_ends_at := nullif(v_item ->> 'calculatedToolReadyAt', '')::timestamptz;

    if v_slot is not null and v_starts_at is not null and v_ends_at is not null and v_ends_at > v_starts_at then
      insert into public.simulation_resource_events (
        organization_id, simulation_version_id, resource_type, resource_code,
        event_type, starts_at, ends_at, quantity, unit, metadata
      ) values (
        new.organization_id,
        v_version_id,
        'oven',
        coalesce(nullif(v_item ->> 'machineCode', ''), 'SEM-PRENSA') || ':' || v_slot::text,
        'reserved',
        v_starts_at,
        v_ends_at,
        1,
        'slot',
        jsonb_build_object(
          'orderId', v_item ->> 'id',
          'toolCode', v_item ->> 'toolCode',
          'machineCode', v_item ->> 'machineCode',
          'slotNumber', v_slot
        )
      );
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists capture_approved_simulation_oven_reservations_trg
  on public.simulation_scenarios;
create trigger capture_approved_simulation_oven_reservations_trg
after update of status on public.simulation_scenarios
for each row
when (new.status = 'approved' and old.status is distinct from new.status)
execute function public.capture_approved_simulation_oven_reservations();

revoke all on function public.capture_approved_simulation_oven_reservations() from public;
