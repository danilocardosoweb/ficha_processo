create index if not exists production_orders_import_batch_idx
  on public.production_orders (import_batch_id);

create index if not exists production_completions_import_batch_idx
  on public.production_completions (import_batch_id);

create index if not exists order_status_history_order_idx
  on public.order_status_history (production_order_id);
