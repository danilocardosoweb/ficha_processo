-- SELECT ... FOR SHARE is evaluated as a row-locking operation. Under the
-- local/anon access model it also requires an UPDATE-visible row, so an oven
-- that was visible in the board disappeared inside the RPC. Slot concurrency
-- remains protected by tool_heating_cycles_active_position_idx.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.start_tool_heating(uuid[],text,uuid,integer,text,text,text)'::regprocedure
  ) into v_definition;
  v_definition := regexp_replace(v_definition, '\s+FOR SHARE;', ';', 'gi');
  execute v_definition;

  select pg_get_functiondef(
    'public.reallocate_tool_heating(uuid,text,uuid,integer,text,text)'::regprocedure
  ) into v_definition;
  v_definition := regexp_replace(v_definition, '\s+FOR SHARE;', ';', 'gi');
  execute v_definition;
end;
$$;
