begin;

-- Catálogos industriais configuráveis. Entidades ricas (prensas, ferramentas,
-- turnos e tarugos) continuam nos seus cadastros próprios; esta tabela guarda
-- listas estáveis de códigos e opções operacionais.
alter table public.operational_catalogs
  drop constraint if exists operational_catalogs_catalog_type_check;
alter table public.operational_catalogs
  add constraint operational_catalogs_catalog_type_check
  check (catalog_type in (
    'stoppage_type', 'stoppage_reason', 'billet_casing', 'cooling_mode', 'alloy',
    'occurrence_type', 'occurrence_area', 'occurrence_category', 'occurrence_cause',
    'occurrence_action', 'occurrence_impact', 'occurrence_destination',
    'occurrence_attachment_type', 'quality_defect', 'quality_cause',
    'quality_disposition', 'maintenance_intervention', 'maintenance_cause',
    'maintenance_priority', 'maintenance_destination', 'process_route',
    'packaging_type', 'billet_supplier'
  ));

insert into public.operational_catalogs (
  organization_id, catalog_type, code, label, responsible_department,
  routes_to_maintenance, sort_order, metadata
)
select
  '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid,
  seed.catalog_type, seed.code, seed.label, seed.department,
  seed.routes_to_maintenance, seed.sort_order, '{}'::jsonb
from (values
  ('occurrence_category', 'PROCESSO', 'Processo de extrusão', 'Produção', true, 10),
  ('occurrence_category', 'FERRAMENTA', 'Ferramenta / matriz', 'Engenharia', true, 20),
  ('occurrence_category', 'MATERIAL', 'Material / tarugo', 'Produção', false, 30),
  ('occurrence_category', 'QUALIDADE', 'Qualidade', 'Qualidade', false, 40),
  ('occurrence_category', 'MANUTENCAO', 'Manutenção', 'Manutenção', true, 50),
  ('occurrence_category', 'SEGURANCA', 'Segurança', 'Segurança', true, 60),
  ('occurrence_category', 'LOGISTICA', 'Logística / embalagem', 'PCP', false, 70),
  ('occurrence_cause', 'MATRIZ_DESGASTE', 'Desgaste ou condição da matriz', 'Engenharia', true, 10),
  ('occurrence_cause', 'PARAMETRO', 'Parâmetro de processo', 'Produção', false, 20),
  ('occurrence_cause', 'TEMPERATURA', 'Temperatura fora do padrão', 'Produção', false, 30),
  ('occurrence_cause', 'VELOCIDADE', 'Velocidade / produtividade', 'Produção', false, 40),
  ('occurrence_cause', 'TARUGO', 'Tarugo ou lote de material', 'Produção', false, 50),
  ('occurrence_cause', 'QUENCH', 'Resfriamento / quench', 'Produção', true, 60),
  ('occurrence_cause', 'MECANICA', 'Falha mecânica', 'Manutenção', true, 70),
  ('occurrence_cause', 'ELETRICA', 'Falha elétrica / automação', 'Manutenção', true, 80),
  ('occurrence_cause', 'INDEFINIDA', 'Ainda não determinada', 'Produção', false, 90),
  ('occurrence_action', 'AJUSTAR_PARAMETRO', 'Ajustar parâmetro', 'Produção', false, 10),
  ('occurrence_action', 'TROCAR_MATRIZ', 'Trocar ferramenta / matriz', 'Engenharia', true, 20),
  ('occurrence_action', 'INSPECIONAR', 'Inspecionar e medir', 'Qualidade', false, 30),
  ('occurrence_action', 'MANUTENCAO', 'Abrir atendimento de manutenção', 'Manutenção', true, 40),
  ('occurrence_action', 'SEGREGAR_MATERIAL', 'Segregar material', 'Qualidade', false, 50),
  ('occurrence_action', 'LIMPAR_RECONFIGURAR', 'Limpar e reconfigurar', 'Produção', false, 60),
  ('occurrence_action', 'ESCALAR', 'Escalar para engenharia / PCP', 'PCP', false, 70),
  ('occurrence_impact', 'SEM_IMPACTO', 'Sem impacto produtivo', 'Produção', false, 10),
  ('occurrence_impact', 'RITMO_REDUZIDO', 'Ritmo reduzido', 'Produção', false, 20),
  ('occurrence_impact', 'PARADA', 'Parada de máquina', 'Produção', true, 30),
  ('occurrence_impact', 'REFUGO', 'Refugo / sucata', 'Qualidade', false, 40),
  ('occurrence_impact', 'ATRASO', 'Atraso no plano', 'PCP', false, 50),
  ('occurrence_destination', 'PRODUCAO', 'Produção', 'Produção', false, 10),
  ('occurrence_destination', 'MANUTENCAO', 'Manutenção', 'Manutenção', true, 20),
  ('occurrence_destination', 'QUALIDADE', 'Qualidade', 'Qualidade', false, 30),
  ('occurrence_destination', 'ENGENHARIA', 'Engenharia', 'Engenharia', false, 40),
  ('occurrence_destination', 'PCP', 'PCP', 'PCP', false, 50),
  ('occurrence_destination', 'SEGURANCA', 'Segurança', 'Segurança', true, 60),
  ('occurrence_attachment_type', 'FOTO', 'Foto / vídeo', 'Produção', false, 10),
  ('occurrence_attachment_type', 'MEDICAO', 'Medição / laudo', 'Qualidade', false, 20),
  ('occurrence_attachment_type', 'ORDEM_SERVICO', 'Ordem de serviço', 'Manutenção', true, 30),
  ('occurrence_attachment_type', 'DOCUMENTO', 'Documento / relatório', 'Engenharia', false, 40),
  ('quality_defect', 'LINHA_MATRIZ', 'Linha de matriz', 'Qualidade', false, 10),
  ('quality_defect', 'RISCO', 'Risco / marca superficial', 'Qualidade', false, 20),
  ('quality_defect', 'BOLHA', 'Bolha / inclusão', 'Qualidade', false, 30),
  ('quality_defect', 'EMPENO', 'Empeno / torção', 'Qualidade', false, 40),
  ('quality_defect', 'DIMENSIONAL', 'Fora de dimensão / tolerância', 'Qualidade', false, 50),
  ('quality_defect', 'MANCHA', 'Mancha / variação de acabamento', 'Qualidade', false, 60),
  ('quality_defect', 'TRINCA', 'Trinca / ruptura', 'Qualidade', false, 70),
  ('quality_defect', 'REBARBA', 'Rebarba / corte', 'Qualidade', false, 80),
  ('quality_cause', 'TARUGO', 'Qualidade do tarugo', 'Qualidade', false, 10),
  ('quality_cause', 'MATRIZ', 'Projeto, desgaste ou correção da matriz', 'Engenharia', false, 20),
  ('quality_cause', 'TEMPERATURA', 'Temperatura / homogeneização', 'Produção', false, 30),
  ('quality_cause', 'VELOCIDADE', 'Velocidade de extrusão', 'Produção', false, 40),
  ('quality_cause', 'QUENCH', 'Quench / resfriamento', 'Produção', false, 50),
  ('quality_cause', 'MANUSEIO', 'Manuseio / embalagem', 'Produção', false, 60),
  ('quality_disposition', 'LIBERAR', 'Liberar', 'Qualidade', false, 10),
  ('quality_disposition', 'REINSPECIONAR', 'Reinspecionar', 'Qualidade', false, 20),
  ('quality_disposition', 'RETRABALHAR', 'Retrabalhar', 'Produção', false, 30),
  ('quality_disposition', 'BLOQUEAR', 'Bloquear lote', 'Qualidade', false, 40),
  ('quality_disposition', 'SUCATEAR', 'Sucatear', 'Qualidade', false, 50),
  ('maintenance_intervention', 'CORRETIVA', 'Manutenção corretiva', 'Manutenção', true, 10),
  ('maintenance_intervention', 'PREVENTIVA', 'Manutenção preventiva', 'Manutenção', false, 20),
  ('maintenance_intervention', 'PREDITIVA', 'Manutenção preditiva', 'Manutenção', false, 30),
  ('maintenance_intervention', 'SETUP', 'Setup / troca', 'Manutenção', false, 40),
  ('maintenance_intervention', 'INSPECAO', 'Inspeção técnica', 'Manutenção', false, 50),
  ('maintenance_cause', 'MECANICA', 'Mecânica', 'Manutenção', true, 10),
  ('maintenance_cause', 'ELETRICA', 'Elétrica / automação', 'Manutenção', true, 20),
  ('maintenance_cause', 'HIDRAULICA', 'Hidráulica / pneumática', 'Manutenção', true, 30),
  ('maintenance_cause', 'INSTRUMENTACAO', 'Instrumentação / sensor', 'Manutenção', true, 40),
  ('maintenance_cause', 'FERRAMENTA', 'Ferramenta / matriz', 'Engenharia', true, 50),
  ('maintenance_priority', 'BAIXA', 'Baixa', 'Manutenção', false, 10),
  ('maintenance_priority', 'MEDIA', 'Média', 'Manutenção', false, 20),
  ('maintenance_priority', 'ALTA', 'Alta', 'Manutenção', true, 30),
  ('maintenance_priority', 'CRITICA', 'Crítica', 'Manutenção', true, 40),
  ('maintenance_destination', 'PRENSA', 'Prensa / extrusão', 'Manutenção', true, 10),
  ('maintenance_destination', 'FORNO', 'Forno de ferramentas', 'Manutenção', true, 20),
  ('maintenance_destination', 'PUXADOR', 'Puxador / puller', 'Manutenção', true, 30),
  ('maintenance_destination', 'SERRA', 'Serra / corte', 'Manutenção', true, 40),
  ('maintenance_destination', 'QUENCH', 'Quench / resfriamento', 'Manutenção', true, 50),
  ('process_route', 'DIRETO', 'Extrusão direta', 'Produção', false, 10),
  ('process_route', 'ANODIZACAO', 'Extrusão + anodização', 'Produção', false, 20),
  ('process_route', 'PINTURA', 'Extrusão + pintura', 'Produção', false, 30),
  ('process_route', 'CORTE', 'Extrusão + corte especial', 'Produção', false, 40),
  ('packaging_type', 'PALETE', 'Palete', 'Produção', false, 10),
  ('packaging_type', 'FARDO', 'Fardo', 'Produção', false, 20),
  ('packaging_type', 'INDIVIDUAL', 'Individual', 'Produção', false, 30)
) as seed(catalog_type, code, label, department, routes_to_maintenance, sort_order)
where exists (select 1 from public.organizations where id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
on conflict (organization_id, catalog_type, code) do nothing;

alter table public.operational_occurrences
  add column if not exists occurrence_category_id uuid references public.operational_catalogs(id) on delete set null,
  add column if not exists occurrence_cause_id uuid references public.operational_catalogs(id) on delete set null,
  add column if not exists occurrence_action_id uuid references public.operational_catalogs(id) on delete set null,
  add column if not exists occurrence_impact_id uuid references public.operational_catalogs(id) on delete set null,
  add column if not exists occurrence_destination_id uuid references public.operational_catalogs(id) on delete set null,
  add column if not exists quality_defect_id uuid references public.operational_catalogs(id) on delete set null,
  add column if not exists quality_disposition_id uuid references public.operational_catalogs(id) on delete set null,
  add column if not exists root_cause text check (root_cause is null or char_length(btrim(root_cause)) <= 4000),
  add column if not exists corrective_action text check (corrective_action is null or char_length(btrim(corrective_action)) <= 4000);

create index if not exists operational_occurrences_context_idx
  on public.operational_occurrences(organization_id, occurrence_category_id, occurrence_cause_id, occurrence_impact_id);

commit;
