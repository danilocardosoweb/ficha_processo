-- Permite apontar quebra de prensa sem ordem/ferramenta vinculada.
alter table public.machine_stoppages
  alter column production_order_id drop not null,
  alter column order_number set default '',
  alter column tool_code set default '';

alter table public.production_events
  alter column production_order_id drop not null;

create index if not exists machine_stoppages_unlinked_machine_idx
  on public.machine_stoppages (organization_id, machine_code, started_at desc)
  where production_order_id is null;
