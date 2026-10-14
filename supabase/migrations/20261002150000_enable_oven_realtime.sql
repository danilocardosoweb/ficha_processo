-- The oven board loads one initial snapshot and then receives only changes.
-- RLS remains the authorization boundary for every published table.
do $$
begin
  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'production_orders'
  ) then
    alter publication supabase_realtime add table public.production_orders;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'tool_heating_cycles'
  ) then
    alter publication supabase_realtime add table public.tool_heating_cycles;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'tool_heating_cycle_orders'
  ) then
    alter publication supabase_realtime add table public.tool_heating_cycle_orders;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'tool_ovens'
  ) then
    alter publication supabase_realtime add table public.tool_ovens;
  end if;

  if not exists (
    select 1
      from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'simplified_imports'
  ) then
    alter publication supabase_realtime add table public.simplified_imports;
  end if;
end $$;
