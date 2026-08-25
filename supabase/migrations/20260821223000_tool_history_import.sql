-- Estrutura detalhada para importar F_Historico_Ferramentas.xlsx.
alter table public.tools
  add column if not exists matrix_code text,
  add column if not exists sequence_number integer,
  add column if not exists holes integer,
  add column if not exists ba_cp text,
  add column if not exists bo text,
  add column if not exists bat text,
  add column if not exists ft text,
  add column if not exists theoretical_linear_weight_kg_m numeric(14,4),
  add column if not exists actual_linear_weight_kg_m numeric(14,4),
  add column if not exists useful_life_kg numeric(14,3),
  add column if not exists produced_kg numeric(14,3),
  add column if not exists remaining_kg numeric(14,3),
  add column if not exists useful_life_pct numeric(8,2),
  add column if not exists actual_efficiency_pct numeric(8,2),
  add column if not exists productivity_kg_h text,
  add column if not exists source_status text,
  add column if not exists source_available boolean,
  add column if not exists observation text,
  add column if not exists machine_codes text,
  add column if not exists last_used_at date,
  add column if not exists registered_at date,
  add column if not exists supplier text,
  add column if not exists nitriding_life_kg numeric(14,3),
  add column if not exists box text,
  add column if not exists package_width_mm numeric(12,2),
  add column if not exists package_height_mm numeric(12,2),
  add column if not exists source_active boolean,
  add column if not exists production_line text,
  add column if not exists programming_notes text,
  add column if not exists approved_at date,
  add column if not exists delivered_at date,
  add column if not exists customer text,
  add column if not exists allocated_balance_kg numeric(14,3),
  add column if not exists source_file text,
  add column if not exists source_row integer,
  add column if not exists source_data jsonb not null default '{}'::jsonb;

create index if not exists tools_matrix_browse_idx
  on public.tools (organization_id, matrix_code, sequence_number)
  where matrix_code is not null;

create index if not exists tools_source_status_idx
  on public.tools (organization_id, source_status)
  where source_status is not null;

alter table public.tools
  drop constraint if exists tools_sequence_number_check;
alter table public.tools
  add constraint tools_sequence_number_check
  check (sequence_number is null or sequence_number >= 0);

alter table public.tools
  drop constraint if exists tools_source_row_check;
alter table public.tools
  add constraint tools_source_row_check
  check (source_row is null or source_row > 0);
