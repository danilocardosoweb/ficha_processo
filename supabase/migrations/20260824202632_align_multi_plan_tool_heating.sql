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
drop trigger if exists align_tool_heating_import_batch on public.tool_heating_cycle_orders;
create trigger align_tool_heating_import_batch
after insert on public.tool_heating_cycle_orders
for each row execute function private.align_tool_heating_import_batch();
