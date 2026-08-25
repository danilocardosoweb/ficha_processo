-- Preserva a identidade das fichas legadas por prensa e a rastreabilidade da planilha.
alter table public.process_sheets
  add column if not exists temper text,
  add column if not exists source_system text not null default 'manual',
  add column if not exists source_file text,
  add column if not exists source_row integer;

alter table public.process_sheets
  drop constraint if exists process_sheets_organization_id_tool_code_alloy_code_revision_key;

-- O PostgreSQL limita identificadores a 63 bytes e abreviou o nome gerado na V1.
alter table public.process_sheets
  drop constraint if exists process_sheets_organization_id_tool_code_alloy_code_revisio_key;

alter table public.process_sheets
  add constraint process_sheets_org_machine_tool_alloy_revision_key
  unique (organization_id, machine_code, tool_code, alloy_code, revision);

alter table public.process_sheets
  drop constraint if exists process_sheets_source_row_check;

alter table public.process_sheets
  add constraint process_sheets_source_row_check
  check (source_row is null or source_row >= 2);

create unique index if not exists process_sheets_source_identity_idx
  on public.process_sheets (organization_id, source_system, source_file, source_row)
  where source_file is not null and source_row is not null;

create index if not exists process_sheets_browse_idx
  on public.process_sheets (organization_id, updated_at desc, id desc);
