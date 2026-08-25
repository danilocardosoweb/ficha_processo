-- The open/local V1 uses the anon database role. The RPC authorization branch
-- references these two columns even when auth.uid() is null. RLS stays enabled
-- and there is no anon SELECT policy, so membership rows are not exposed.
grant select (organization_id, user_id)
  on public.organization_members
  to anon;
