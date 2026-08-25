drop index if exists public.simplified_imports_file_hash_key;

create unique index simplified_imports_processed_file_hash_key
  on public.simplified_imports (organization_id, file_hash)
  where file_hash is not null and status = 'processed';
