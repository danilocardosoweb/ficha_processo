create index local_users_created_by_idx on private.local_users (created_by) where created_by is not null;
create index local_users_updated_by_idx on private.local_users (updated_by) where updated_by is not null;
create index local_user_audit_actor_idx on private.local_user_audit (actor_user_id, occurred_at desc) where actor_user_id is not null;
