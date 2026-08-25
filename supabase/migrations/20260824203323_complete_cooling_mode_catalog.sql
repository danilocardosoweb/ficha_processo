insert into public.operational_catalogs (
  organization_id,
  catalog_type,
  code,
  label,
  responsible_department,
  routes_to_maintenance,
  sort_order,
  metadata,
  is_active
)
select
  '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid,
  'cooling_mode',
  cooling.code,
  cooling.label,
  'Engenharia',
  false,
  cooling.sort_order,
  '{"source":"standard_catalog"}'::jsonb,
  true
from (values
  ('CAPA', 'Capa', 10),
  ('QUENCHING', 'Quenching', 20),
  ('RESFRIAMENTO', 'Resfriamento', 30),
  ('SEM_AR', 'SEM AR', 40),
  ('SEM_VENTILACAO', 'SEM VENTILAÇÃO', 50),
  ('SOMENTE_CAPA', 'SOMENTE CAPA', 60),
  ('SPRAY', 'Spray', 70),
  ('SPRAY_1_2_3', 'Spray - 1,2e3', 80),
  ('VENTILADOR_2_3_CAPA_CONT', 'Ventilador ,2,3 e Capa Cont', 90),
  ('VENTILADOR_1', 'Ventilador 1', 100),
  ('VENTILADOR_1_2', 'Ventilador 1,2', 110),
  ('VENTILADOR_1_2_3', 'Ventilador 1,2 e 3', 120),
  ('VENTILADOR_1_2_3_CAPA', 'Ventilador 1,2,3 e Capa', 130),
  ('VENTILADOR_2', 'Ventilador 2', 140),
  ('VENTILADOR_2_3', 'Ventilador 2 e 3', 150),
  ('VENTILADOR_2_3_CAPA', 'Ventilador 2,3 e Capa', 160),
  ('VENTILADOR_3', 'Ventilador 3', 170)
) as cooling(code, label, sort_order)
on conflict (organization_id, catalog_type, code) do update
set
  label = excluded.label,
  responsible_department = excluded.responsible_department,
  sort_order = excluded.sort_order,
  metadata = public.operational_catalogs.metadata || excluded.metadata,
  is_active = true,
  updated_at = now();
