delete from public.bo_resources
where organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid;

insert into public.bo_resources (organization_id, bo_code, total_quantity, unavailable_quantity, status, location, notes)
select '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid, code, 0, 0, 'available', 'Cadastro inicial', 'BO cadastrado conforme catálogo oficial'
from unnest(array['0','1','1A','2','2A','3','4','5','6','6A','7','8','9','10','11','12','13','15','16','17','18','19','20','21','100','135','336','350','421','529','811','908']) as code
where exists (select 1 from public.organizations where id='8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
on conflict (organization_id, bo_code) do update set status='available', updated_at=now();
