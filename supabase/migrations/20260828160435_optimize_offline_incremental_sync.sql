create index if not exists tools_offline_sync_idx
  on public.tools (organization_id, updated_at desc);

create index if not exists machines_offline_sync_idx
  on public.machines (organization_id, updated_at desc);

create index if not exists production_orders_offline_sync_idx
  on public.production_orders (organization_id, updated_at desc);

create index if not exists tool_heating_cycles_offline_sync_idx
  on public.tool_heating_cycles (organization_id, updated_at desc);

create index if not exists operational_catalogs_offline_sync_idx
  on public.operational_catalogs (organization_id, updated_at desc);
