create policy tool_heating_cycle_orders_authenticated_insert on public.tool_heating_cycle_orders
  for insert to authenticated with check (exists (
    select 1 from public.tool_heating_cycles c
    join public.production_orders po on po.id = production_order_id
    where c.id = cycle_id and c.organization_id = po.organization_id
      and c.organization_id in (select private.authorized_org_ids())
  ));
create policy tool_heating_cycle_orders_v1_insert on public.tool_heating_cycle_orders
  for insert to anon with check (exists (
    select 1 from public.tool_heating_cycles c
    join public.production_orders po on po.id = production_order_id
    where c.id = cycle_id and c.organization_id = po.organization_id
      and c.organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid
  ));
create policy tool_heating_history_authenticated_insert on public.tool_heating_history
  for insert to authenticated with check (organization_id in (select private.authorized_org_ids()));
create policy tool_heating_history_v1_insert on public.tool_heating_history
  for insert to anon with check (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);

grant select,insert on public.tool_heating_cycle_orders, public.tool_heating_history to anon, authenticated;
alter function public.start_tool_heating(uuid[], integer, text, text, text) security invoker;
alter function public.release_tool_heating(uuid, text, text) security invoker;
alter function public.cancel_tool_heating(uuid, text, text) security invoker;

create index if not exists tool_heating_history_org_idx
  on public.tool_heating_history (organization_id, occurred_at desc);
