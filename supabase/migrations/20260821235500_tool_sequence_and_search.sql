-- A coluna revision da planilha representa, na realidade, a sequencia fisica
-- da ferramenta. Mantemos revision apenas para compatibilidade com a V1.
alter table public.process_sheets
  add column if not exists tool_sequence integer;

update public.process_sheets
set tool_sequence = revision
where tool_sequence is null;

alter table public.process_sheets
  alter column tool_sequence set default 1,
  alter column tool_sequence set not null;

alter table public.process_sheets
  drop constraint if exists process_sheets_tool_sequence_check;
alter table public.process_sheets
  add constraint process_sheets_tool_sequence_check
  check (tool_sequence >= 0);

alter table public.process_sheets
  drop constraint if exists process_sheets_org_machine_tool_alloy_revision_key;
alter table public.process_sheets
  add constraint process_sheets_org_machine_tool_alloy_sequence_key
  unique (organization_id, machine_code, tool_code, alloy_code, tool_sequence);

-- Versoes sem pontuacao para buscas como DIN7501 -> DIN-7501.
alter table public.tools
  add column if not exists matrix_search text
  generated always as (regexp_replace(lower(coalesce(matrix_code, '')), '[^a-z0-9]', '', 'g')) stored;

alter table public.process_sheets
  add column if not exists tool_search text
  generated always as (
    regexp_replace(lower(coalesce(product_code, tool_code, '')), '[^a-z0-9]', '', 'g')
  ) stored;

create index if not exists tools_matrix_search_idx
  on public.tools (organization_id, matrix_search);

create index if not exists process_sheets_tool_search_idx
  on public.process_sheets (organization_id, tool_search);

