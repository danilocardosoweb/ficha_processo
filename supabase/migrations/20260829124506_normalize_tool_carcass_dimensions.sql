alter table public.tools
  add column if not exists package_measure_mm numeric(12,2),
  add column if not exists carcass_diameter_mm numeric(12,2),
  add column if not exists carcass_code text;

comment on column public.tools.package_measure_mm is
  'Medida Pacote importada do Cadastro de ferramentas; segundo componente da carcaça.';
comment on column public.tools.carcass_diameter_mm is
  'Diâmetro importado do Cadastro de ferramentas; primeiro componente da carcaça.';
comment on column public.tools.carcass_code is
  'Carcaça normalizada no formato DIAMETROxMEDIDA_PACOTE, por exemplo 250X170.';

update public.tools
set
  package_measure_mm = coalesce(nullif(package_measure_mm, 0), nullif(package_width_mm, 0)),
  carcass_diameter_mm = coalesce(nullif(carcass_diameter_mm, 0), nullif(package_height_mm, 0))
where package_measure_mm is null or carcass_diameter_mm is null;

update public.tools
set carcass_code = concat(
  trim_scale(carcass_diameter_mm)::text,
  'X',
  trim_scale(package_measure_mm)::text
)
where nullif(btrim(coalesce(carcass_code, '')), '') is null
  and carcass_diameter_mm is not null
  and package_measure_mm is not null;

alter table public.tools
  drop constraint if exists tools_package_measure_positive,
  drop constraint if exists tools_carcass_diameter_positive,
  drop constraint if exists tools_carcass_code_format;

alter table public.tools
  add constraint tools_package_measure_positive
    check (package_measure_mm is null or package_measure_mm > 0),
  add constraint tools_carcass_diameter_positive
    check (carcass_diameter_mm is null or carcass_diameter_mm > 0),
  add constraint tools_carcass_code_format
    check (carcass_code is null or carcass_code ~ '^[0-9]+([.,][0-9]+)?X[0-9]+([.,][0-9]+)?$');

create index if not exists tools_carcass_lookup_idx
  on public.tools (organization_id, carcass_code)
  where carcass_code is not null;
