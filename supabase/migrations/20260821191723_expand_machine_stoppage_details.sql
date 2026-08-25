alter table public.machine_stoppages
  add column if not exists problem_area text not null default 'Produção',
  add column if not exists responsible_area text,
  add column if not exists service_order_number text,
  add column if not exists occurrence_date date,
  add column if not exists tool_sequence integer,
  add column if not exists billet_casing text,
  add column if not exists equipment_type text,
  add column if not exists equipment_number text,
  add column if not exists symptoms text,
  add column if not exists intervention_performed text,
  add column if not exists dummy_block_entered text,
  add column if not exists dummy_block_exited text,
  add column if not exists press_count integer,
  add column if not exists dummy_block_side text;

alter table public.machine_stoppages
  drop constraint if exists machine_stoppages_press_count_check;
alter table public.machine_stoppages
  add constraint machine_stoppages_press_count_check
  check (press_count is null or press_count >= 0);

create index if not exists machine_stoppages_service_order_idx
  on public.machine_stoppages (organization_id, service_order_number)
  where service_order_number is not null;

create index if not exists machine_stoppages_occurrence_date_idx
  on public.machine_stoppages (organization_id, occurrence_date desc);

comment on column public.machine_stoppages.problem_area is
  'Área onde o problema foi percebido, equivalente ao campo Problema(na) do legado.';
comment on column public.machine_stoppages.responsible_area is
  'Responsável operacional selecionado no apontamento.';
comment on column public.machine_stoppages.symptoms is
  'Sintomas apresentados antes ou durante a parada.';
comment on column public.machine_stoppages.intervention_performed is
  'Intervenção efetuada para corrigir ou conter a ocorrência.';
