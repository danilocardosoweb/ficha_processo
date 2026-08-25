create table if not exists public.operational_catalogs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  catalog_type text not null check (catalog_type in (
    'stoppage_type', 'stoppage_reason', 'billet_casing', 'cooling_mode', 'alloy'
  )),
  code text not null,
  label text not null,
  group_code text,
  responsible_department text,
  routes_to_maintenance boolean not null default false,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, catalog_type, code)
);

create index if not exists operational_catalogs_lookup_idx
  on public.operational_catalogs (organization_id, catalog_type, is_active, sort_order, label);
create index if not exists operational_catalogs_group_idx
  on public.operational_catalogs (organization_id, catalog_type, group_code)
  where is_active;

alter table public.operational_catalogs enable row level security;
grant select, insert, update on public.operational_catalogs to anon, authenticated;

drop policy if exists operational_catalogs_v1_select on public.operational_catalogs;
create policy operational_catalogs_v1_select on public.operational_catalogs
  for select to anon
  using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);

drop policy if exists operational_catalogs_v1_insert on public.operational_catalogs;
create policy operational_catalogs_v1_insert on public.operational_catalogs
  for insert to anon
  with check (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);

drop policy if exists operational_catalogs_v1_update on public.operational_catalogs;
create policy operational_catalogs_v1_update on public.operational_catalogs
  for update to anon
  using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
  with check (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);

drop policy if exists operational_catalogs_authenticated_select on public.operational_catalogs;
create policy operational_catalogs_authenticated_select on public.operational_catalogs
  for select to authenticated
  using (organization_id in (select private.authorized_org_ids()));

drop policy if exists operational_catalogs_authenticated_insert on public.operational_catalogs;
create policy operational_catalogs_authenticated_insert on public.operational_catalogs
  for insert to authenticated
  with check (organization_id in (select private.authorized_org_ids()));

drop policy if exists operational_catalogs_authenticated_update on public.operational_catalogs;
create policy operational_catalogs_authenticated_update on public.operational_catalogs
  for update to authenticated
  using (organization_id in (select private.authorized_org_ids()))
  with check (organization_id in (select private.authorized_org_ids()));

alter table public.machine_stoppages
  add column if not exists reason_catalog_id uuid references public.operational_catalogs(id) on delete set null,
  add column if not exists responsible_department text;

create index if not exists machine_stoppages_reason_catalog_idx
  on public.machine_stoppages (reason_catalog_id)
  where reason_catalog_id is not null;

insert into public.operational_catalogs (
  organization_id, catalog_type, code, label, group_code,
  responsible_department, routes_to_maintenance, sort_order, metadata
)
select
  '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid,
  values_table.catalog_type,
  values_table.code,
  values_table.label,
  values_table.group_code,
  values_table.department,
  values_table.routes_to_maintenance,
  values_table.sort_order,
  values_table.metadata
from (values
  ('stoppage_type','E','EQUIPAMENTO',null,'Manutenção',true,10,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_type','F','FERRAMENTA',null,'Produção',false,20,'{"internal_category":"tooling"}'::jsonb),
  ('stoppage_type','O','OUTROS',null,'Produção',false,30,'{"internal_category":"other"}'::jsonb),
  ('stoppage_type','PL','PLANEJADA',null,'Produção',false,40,'{"internal_category":"setup"}'::jsonb),
  ('stoppage_type','UTL','UTILIDADES',null,'Produção',false,50,'{"internal_category":"process"}'::jsonb),
  ('stoppage_type','NPR','NÃO PROGRAMADA',null,'Produção',false,60,'{"internal_category":"other"}'::jsonb),

  ('stoppage_reason','01','FORNO DE TARUGO','E','Manutenção',true,10,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','02','CARREGADOR DE TARUGO','E','Manutenção',true,20,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','03','PRENSA','E','Manutenção',true,30,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','04','SERRA QUENTE','E','Manutenção',true,40,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','05','PULLER','E','Manutenção',true,50,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','06','MESA ROL. PULLER','E','Manutenção',true,60,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','07','MESA RESFRIAMENTO','E','Manutenção',true,70,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','08','ESTICADEIRA','E','Manutenção',true,80,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','09','MESA SERRA FRIO','E','Manutenção',true,90,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','10','ENCESTADOR','E','Manutenção',true,100,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','11','SERRA FRIO','E','Manutenção',true,110,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','12','CAIXA DE TRAVESSAS','E','Manutenção',true,120,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','13','FORNO DE FERRAMENTA','E','Manutenção',true,130,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','14','MANUTENÇÃO PLANEJADA','PL','Produção',false,140,'{"internal_category":"setup"}'::jsonb),
  ('stoppage_reason','15','MAGAZINE DE TARUGOS','E','Manutenção',true,150,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','16','TORRE DE RESFRIAMENTO','E','Manutenção',true,160,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','17','MESA CHEIA','E','Produção',false,170,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','18','TARUGO FRIO','UTL','Produção',false,180,'{"internal_category":"material"}'::jsonb),
  ('stoppage_reason','19','FERR. SEM TEMPO DE FORNO (S/PED.)','UTL','Produção',false,190,'{"internal_category":"tooling"}'::jsonb),
  ('stoppage_reason','20','BUCHA FRIA','E','Manutenção',true,200,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','21','FALTA DE GÁS','UTL','Produção',false,210,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','22','FALTA DE ENERGIA','UTL','Produção',false,220,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','23','FALTA DE AR','UTL','Produção',false,230,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','24','FALTA DE PROGRAMAÇÃO','UTL','Produção',false,240,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','25','FALTA DE MATÉRIA-PRIMA','UTL','Produção',false,250,'{"internal_category":"material"}'::jsonb),
  ('stoppage_reason','26','EXPERIÊNCIA','F','Produção',false,260,'{"internal_category":"tooling"}'::jsonb),
  ('stoppage_reason','27','REFEIÇÃO','PL','Produção',false,270,'{"internal_category":"setup"}'::jsonb),
  ('stoppage_reason','28','HOUSEKEEPING','UTL','Produção',false,280,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','29','FALTA DE FUNCIONÁRIOS','UTL','Produção',false,290,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','30','REUNIÃO','UTL','Produção',false,300,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','31','FALTA DE RACK','UTL','Produção',false,310,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','32','FALTA DE PEDIDO','UTL','Produção',false,320,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','33','VAZAR TARUGO','F','Manutenção',true,330,'{"internal_category":"tooling"}'::jsonb),
  ('stoppage_reason','34','CHAPÉU','E','Manutenção',true,340,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','35','FERRAMENTA','F','Produção',false,350,'{"internal_category":"tooling"}'::jsonb),
  ('stoppage_reason','36','TROCA DE FERRAMENTA','F','Produção',false,360,'{"internal_category":"setup"}'::jsonb),
  ('stoppage_reason','37','LIMPEZA NA FACE DA BUCHA','E','Manutenção',true,370,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','38','INCHOU TARUGO','E','Manutenção',true,380,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','39','TALHA ELÉTRICA','E','Manutenção',true,390,'{"internal_category":"electrical"}'::jsonb),
  ('stoppage_reason','40','DISCO DE LIMPEZA','UTL','Produção',false,400,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','41','ESTEIRA DE TALÃO','E','Manutenção',true,410,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','42','PROBLEMA DATASUL','UTL','Produção',false,420,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','43','TROCA DUMMY BLOCK','E','Manutenção',true,430,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','44','PROBLEMA QUENCH','E','Manutenção',true,440,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','45','PRENSA DESLIGADA','PL','Produção',false,450,'{"internal_category":"setup"}'::jsonb),
  ('stoppage_reason','46','NÃO PROGRAMADA','NPR','Produção',false,460,'{"internal_category":"other"}'::jsonb),
  ('stoppage_reason','47','AQUECIMENTO DO FORNO DE BARRAS','UTL','Produção',false,470,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','48','FALHA OPERACIONAL','UTL','Produção',false,480,'{"internal_category":"process"}'::jsonb),
  ('stoppage_reason','49','TROCA DE PRENSA','PL','Produção',false,490,'{"internal_category":"setup"}'::jsonb),
  ('stoppage_reason','50','FACA DE TALÃO','E','Manutenção',true,500,'{"internal_category":"mechanical"}'::jsonb),
  ('stoppage_reason','51','FERRAMENTA NÃO PLANEJADA','UTL','Produção',false,510,'{"internal_category":"tooling"}'::jsonb),

  ('billet_casing','120x200','120x200',null,'Engenharia',false,10,'{}'::jsonb),
  ('billet_casing','130x228','130x228',null,'Engenharia',false,20,'{}'::jsonb),
  ('billet_casing','130x250','130x250',null,'Engenharia',false,30,'{}'::jsonb),
  ('billet_casing','150x200','150x200',null,'Engenharia',false,40,'{}'::jsonb),
  ('billet_casing','150x227','150x227',null,'Engenharia',false,50,'{}'::jsonb),
  ('billet_casing','150x250','150x250',null,'Engenharia',false,60,'{}'::jsonb),
  ('billet_casing','151x200','151x200',null,'Engenharia',false,70,'{}'::jsonb),
  ('billet_casing','170x200','170x200',null,'Engenharia',false,80,'{}'::jsonb),
  ('billet_casing','170x227','170x227',null,'Engenharia',false,90,'{}'::jsonb),
  ('billet_casing','170x228','170x228',null,'Engenharia',false,100,'{}'::jsonb),
  ('billet_casing','170x250','170x250',null,'Engenharia',false,110,'{}'::jsonb),
  ('billet_casing','170x300','170x300',null,'Engenharia',false,120,'{}'::jsonb),
  ('billet_casing','170x350','170x350',null,'Engenharia',false,130,'{}'::jsonb),
  ('billet_casing','170x357','170x357',null,'Engenharia',false,140,'{}'::jsonb),
  ('billet_casing','170x399','170x399',null,'Engenharia',false,150,'{}'::jsonb),
  ('billet_casing','209x300','209x300',null,'Engenharia',false,160,'{}'::jsonb),
  ('billet_casing','209x399','209x399',null,'Engenharia',false,170,'{}'::jsonb),
  ('billet_casing','228x232','228x232',null,'Engenharia',false,180,'{}'::jsonb),

  ('cooling_mode','VENTILADOR_1','Ventilador 1',null,'Engenharia',false,10,'{}'::jsonb),
  ('cooling_mode','VENTILADOR_1_2','Ventilador 1,2',null,'Engenharia',false,20,'{}'::jsonb),
  ('cooling_mode','VENTILADOR_1_2_3','Ventilador 1,2 e 3',null,'Engenharia',false,30,'{}'::jsonb),
  ('cooling_mode','VENTILADOR_2','Ventilador 2',null,'Engenharia',false,40,'{}'::jsonb),
  ('cooling_mode','VENTILADOR_2_3','Ventilador 2 e 3',null,'Engenharia',false,50,'{}'::jsonb),
  ('cooling_mode','VENTILADOR_3','Ventilador 3',null,'Engenharia',false,60,'{}'::jsonb),
  ('cooling_mode','VENTILADOR_1_3','Ventilador 1 e 3',null,'Engenharia',false,70,'{}'::jsonb),
  ('cooling_mode','VENTILADOR_1_2_3_CAPA','Ventilador 1,2,3 e Capa',null,'Engenharia',false,80,'{}'::jsonb),
  ('cooling_mode','SPRAY','Spray',null,'Engenharia',false,90,'{}'::jsonb),
  ('cooling_mode','QUENCHING','Quenching',null,'Engenharia',false,100,'{}'::jsonb),

  ('alloy','6460','6460',null,'Engenharia',false,10,'{}'::jsonb),
  ('alloy','6060','6060',null,'Engenharia',false,20,'{}'::jsonb),
  ('alloy','6063','6063',null,'Engenharia',false,30,'{}'::jsonb),
  ('alloy','6351','6351',null,'Engenharia',false,40,'{}'::jsonb),
  ('alloy','6005','6005',null,'Engenharia',false,50,'{}'::jsonb),
  ('alloy','6082','6082',null,'Engenharia',false,60,'{}'::jsonb),
  ('alloy','6101','6101',null,'Engenharia',false,70,'{}'::jsonb),
  ('alloy','6061','6061',null,'Engenharia',false,80,'{}'::jsonb)
) as values_table(
  catalog_type, code, label, group_code, department,
  routes_to_maintenance, sort_order, metadata
)
on conflict (organization_id, catalog_type, code) do update
set label = excluded.label,
    group_code = excluded.group_code,
    responsible_department = excluded.responsible_department,
    routes_to_maintenance = excluded.routes_to_maintenance,
    sort_order = excluded.sort_order,
    metadata = excluded.metadata,
    is_active = true,
    updated_at = now();
