-- Administrador definitivo para continuidade do desenvolvimento.
-- A senha temporária deve ser alterada após o primeiro acesso.
insert into private.local_users (
  organization_id, username, email, display_name, password_hash, role,
  machine_codes, is_active, must_change_password
)
select
  '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid,
  'danilo',
  'danilo.cardosoweb@gmail.com',
  'Danilo Cardoso',
  extensions.crypt('AdminAlu2026!', extensions.gen_salt('bf', 12)),
  'admin', '{}', true, true
where exists (
  select 1 from public.organizations
  where id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid
)
on conflict (organization_id, lower(username)) do update
set email = excluded.email,
    display_name = excluded.display_name,
    role = 'admin',
    is_active = true,
    must_change_password = true,
    updated_at = now();
