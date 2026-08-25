create index if not exists process_sheet_change_history_actor_idx
  on public.process_sheet_change_history (changed_by_user_id)
  where changed_by_user_id is not null;
