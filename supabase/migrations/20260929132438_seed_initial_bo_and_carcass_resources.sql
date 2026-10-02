-- Estoque inicial informado pela fábrica. Os códigos dos BOs foram
-- representados pela dimensão da carcaça até que o cadastro físico seja
-- substituído pelos códigos individuais.
with seed(bo_code, quantity) as (values
  ('200X170', 2), ('227X170', 1), ('228X130', 14), ('228X170', 5),
  ('250X170', 24), ('300X170', 8), ('300X209', 1), ('357X170', 1)
)
insert into public.bo_resources (organization_id, bo_code, total_quantity, unavailable_quantity, status, location, notes)
select '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid, bo_code, quantity, 0, 'available', 'Estoque inicial', 'Carga inicial informada pela fábrica.'
from seed
on conflict (organization_id, bo_code) do update
set total_quantity = excluded.total_quantity,
    unavailable_quantity = excluded.unavailable_quantity,
    status = 'available',
    location = excluded.location,
    notes = excluded.notes,
    updated_at = now();

with seed(carcass_code, quantity) as (values
  ('200X170', 2), ('227X170', 1), ('228X130', 14), ('228X170', 5),
  ('250X170', 24), ('300X170', 8), ('300X209', 1), ('357X170', 1)
)
insert into public.press_carcass_resources (organization_id, machine_code, carcass_code, total_quantity, unavailable_quantity, status, location, notes)
select '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid, 'SHARED', carcass_code, quantity, 0, 'available', 'Estoque inicial', 'Estoque compartilhado pelas prensas; carga inicial informada pela fábrica.'
from seed
on conflict (organization_id, machine_code, carcass_code) do update
set total_quantity = excluded.total_quantity,
    unavailable_quantity = excluded.unavailable_quantity,
    status = 'available',
    location = excluded.location,
    notes = excluded.notes,
    updated_at = now();
