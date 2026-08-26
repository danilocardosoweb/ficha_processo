drop policy if exists machine_load_settings_write on public.machine_load_settings;
drop policy if exists tool_alloy_options_write on public.tool_alloy_options;

revoke insert, update, delete on public.machine_load_settings from anon, authenticated;
revoke insert, update, delete on public.tool_alloy_options from anon, authenticated;
revoke usage, select on sequence public.tool_alloy_options_id_seq from anon, authenticated;

grant select on public.machine_load_settings to anon, authenticated;
grant select on public.tool_alloy_options to anon, authenticated;
