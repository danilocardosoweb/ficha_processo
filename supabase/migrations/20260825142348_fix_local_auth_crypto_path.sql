-- pgcrypto is installed in the protected extensions schema in hosted Supabase.
-- Pin the search path to trusted schemas so password and token functions resolve safely.
alter function private.require_local_session(text, boolean) set search_path = pg_catalog, extensions;
alter function public.local_login(text, text, text, text) set search_path = pg_catalog, extensions;
alter function public.local_get_session(text) set search_path = pg_catalog, extensions;
alter function public.local_logout(text) set search_path = pg_catalog, extensions;
alter function public.local_list_users(text) set search_path = pg_catalog, extensions;
alter function public.local_create_user(text, text, text, text, text, text[], text) set search_path = pg_catalog, extensions;
alter function public.local_update_user(text, uuid, text, text, text, text[], boolean) set search_path = pg_catalog, extensions;
alter function public.local_reset_password(text, uuid, text) set search_path = pg_catalog, extensions;
alter function public.local_update_profile(text, text, text) set search_path = pg_catalog, extensions;
alter function public.local_change_password(text, text, text) set search_path = pg_catalog, extensions;
