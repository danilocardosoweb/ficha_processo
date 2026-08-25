create index operational_messages_created_by_idx
  on private.operational_messages (created_by, created_at desc);
