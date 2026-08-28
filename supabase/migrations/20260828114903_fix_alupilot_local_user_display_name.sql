begin;

-- The local authentication model stores the operator name in display_name.
-- Early AluPilot functions referred to the non-existent full_name column.
-- Recreate only those functions, preserving their signatures, grants and
-- security settings, so existing installations and fresh databases converge.
do $$
declare
  v_function record;
  v_definition text;
  v_replaced integer := 0;
begin
  for v_function in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.proname in (
        'local_list_simulation_scenarios',
        'local_upsert_billet_stock_lot',
        'local_reserve_billet_stock',
        'local_release_billet_reservation',
        'local_upsert_press_carcass_resource',
        'local_upsert_resource_unavailability'
      )
  loop
    v_definition := pg_get_functiondef(v_function.oid);

    if position('full_name' in v_definition) > 0 then
      execute replace(v_definition, 'full_name', 'display_name');
      v_replaced := v_replaced + 1;
    end if;
  end loop;

  if v_replaced <> 6 then
    raise exception
      'Expected to update 6 AluPilot functions, but updated %.',
      v_replaced;
  end if;
end;
$$;

commit;
