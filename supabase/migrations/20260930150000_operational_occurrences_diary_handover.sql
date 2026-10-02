begin;

-- Ocorrências são o contexto operacional; machine_stoppages continua sendo a fonte
-- canônica de máquina, início, fim e duração quando houver vínculo.
alter table public.operational_catalogs
  drop constraint if exists operational_catalogs_catalog_type_check;
alter table public.operational_catalogs
  add constraint operational_catalogs_catalog_type_check
  check (catalog_type in (
    'stoppage_type', 'stoppage_reason', 'billet_casing', 'cooling_mode', 'alloy',
    'occurrence_type', 'occurrence_area'
  ));

insert into public.operational_catalogs (
  organization_id, catalog_type, code, label, group_code,
  responsible_department, routes_to_maintenance, sort_order, metadata
)
select
  '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid,
  seed.catalog_type, seed.code, seed.label, null,
  seed.department, false, seed.sort_order, '{}'::jsonb
from (values
  ('occurrence_type', 'INCIDENTE', 'Incidente operacional', 'Produção', 10),
  ('occurrence_type', 'MANUTENCAO', 'Manutenção', 'Manutenção', 20),
  ('occurrence_type', 'QUALIDADE', 'Qualidade', 'Qualidade', 30),
  ('occurrence_type', 'SEGURANCA', 'Segurança', 'Segurança', 40),
  ('occurrence_type', 'MATERIAL', 'Material / logística', 'Produção', 50),
  ('occurrence_area', 'PRODUCAO', 'Produção', 'Produção', 10),
  ('occurrence_area', 'MANUTENCAO', 'Manutenção', 'Manutenção', 20),
  ('occurrence_area', 'QUALIDADE', 'Qualidade', 'Qualidade', 30),
  ('occurrence_area', 'ENGENHARIA', 'Engenharia', 'Engenharia', 40),
  ('occurrence_area', 'PCP', 'PCP', 'PCP', 50)
) as seed(catalog_type, code, label, department, sort_order)
where exists (select 1 from public.organizations where id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
on conflict (organization_id, catalog_type, code) do nothing;

create table if not exists public.operational_occurrences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stoppage_id uuid references public.machine_stoppages(id) on delete set null,
  occurrence_type_id uuid not null references public.operational_catalogs(id) on delete restrict,
  area_id uuid not null references public.operational_catalogs(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 3 and 160),
  description text not null check (char_length(btrim(description)) between 3 and 8000),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'cancelled')),
  source text not null default 'manual' check (source in ('manual', 'stoppage', 'production', 'system')),
  machine_code text,
  occurred_at timestamptz,
  resolved_at timestamptz,
  created_by_user_id uuid references private.local_users(id) on delete set null,
  created_by_name text not null default 'Sistema',
  updated_by_user_id uuid references private.local_users(id) on delete set null,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stoppage_id is not null or (nullif(btrim(machine_code), '') is not null and occurred_at is not null)),
  check (resolved_at is null or status in ('resolved', 'cancelled'))
);

create unique index if not exists operational_occurrences_one_link_per_stoppage_idx
  on public.operational_occurrences(stoppage_id)
  where stoppage_id is not null;
create index if not exists operational_occurrences_diary_idx
  on public.operational_occurrences(organization_id, occurred_at desc, created_at desc);
create index if not exists operational_occurrences_status_idx
  on public.operational_occurrences(organization_id, status, severity);
create index if not exists operational_occurrences_catalog_idx
  on public.operational_occurrences(organization_id, occurrence_type_id, area_id);

drop trigger if exists operational_occurrences_updated_at on public.operational_occurrences;
create trigger operational_occurrences_updated_at before update on public.operational_occurrences
for each row execute function private.set_updated_at();
drop trigger if exists operational_catalogs_updated_at on public.operational_catalogs;
create trigger operational_catalogs_updated_at before update on public.operational_catalogs
for each row execute function private.set_updated_at();

create table if not exists public.operational_occurrence_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  occurrence_id uuid not null references public.operational_occurrences(id) on delete cascade,
  event_type text not null default 'comment' check (event_type in ('comment', 'status', 'assignment', 'system')),
  body text not null check (char_length(btrim(body)) between 1 and 4000),
  from_status text,
  to_status text,
  created_by_user_id uuid references private.local_users(id) on delete set null,
  created_by_name text not null default 'Sistema',
  created_at timestamptz not null default now()
);
create index if not exists operational_occurrence_updates_timeline_idx
  on public.operational_occurrence_updates(organization_id, occurrence_id, created_at desc);

create table if not exists public.operational_occurrence_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  occurrence_id uuid not null references public.operational_occurrences(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (char_length(btrim(file_name)) between 1 and 180),
  mime_type text not null check (char_length(mime_type) between 1 and 120),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 10485760),
  uploaded_by_user_id uuid references private.local_users(id) on delete set null,
  uploaded_by_name text not null default 'Sistema',
  created_at timestamptz not null default now()
);
create index if not exists operational_occurrence_attachments_idx
  on public.operational_occurrence_attachments(organization_id, occurrence_id, created_at desc);

create table if not exists public.shift_handovers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  from_shift text not null check (char_length(btrim(from_shift)) between 1 and 80),
  to_shift text not null check (char_length(btrim(to_shift)) between 1 and 80),
  summary text not null check (char_length(btrim(summary)) between 3 and 8000),
  handed_over_at timestamptz not null default now(),
  created_by_user_id uuid references private.local_users(id) on delete set null,
  created_by_name text not null default 'Sistema',
  created_at timestamptz not null default now()
);
create index if not exists shift_handovers_diary_idx
  on public.shift_handovers(organization_id, handed_over_at desc);

create table if not exists public.shift_handover_occurrences (
  handover_id uuid not null references public.shift_handovers(id) on delete cascade,
  occurrence_id uuid not null references public.operational_occurrences(id) on delete cascade,
  primary key (handover_id, occurrence_id)
);

alter table public.operational_occurrences enable row level security;
alter table public.operational_occurrence_updates enable row level security;
alter table public.operational_occurrence_attachments enable row level security;
alter table public.shift_handovers enable row level security;
alter table public.shift_handover_occurrences enable row level security;

grant select, insert, update on public.operational_occurrences to anon, authenticated;
grant select, insert on public.operational_occurrence_updates to anon, authenticated;
grant select, insert on public.operational_occurrence_attachments to anon, authenticated;
grant select, insert on public.shift_handovers to anon, authenticated;
grant select, insert, delete on public.shift_handover_occurrences to anon, authenticated;

drop policy if exists operational_occurrences_v1_access on public.operational_occurrences;
create policy operational_occurrences_v1_access on public.operational_occurrences
  for all to anon, authenticated
  using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
  with check (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);
drop policy if exists operational_occurrence_updates_v1_access on public.operational_occurrence_updates;
create policy operational_occurrence_updates_v1_access on public.operational_occurrence_updates
  for all to anon, authenticated
  using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
  with check (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);
drop policy if exists operational_occurrence_attachments_v1_access on public.operational_occurrence_attachments;
create policy operational_occurrence_attachments_v1_access on public.operational_occurrence_attachments
  for all to anon, authenticated
  using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
  with check (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);
drop policy if exists shift_handovers_v1_access on public.shift_handovers;
create policy shift_handovers_v1_access on public.shift_handovers
  for all to anon, authenticated
  using (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid)
  with check (organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid);
drop policy if exists shift_handover_occurrences_v1_access on public.shift_handover_occurrences;
create policy shift_handover_occurrences_v1_access on public.shift_handover_occurrences
  for all to anon, authenticated
  using (exists (select 1 from public.shift_handovers h where h.id = handover_id and h.organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid))
  with check (exists (select 1 from public.shift_handovers h where h.id = handover_id and h.organization_id = '8557a116-8377-44a6-b2f3-5b087f08bea8'::uuid));

create or replace function public.audit_occurrence_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_new jsonb;
  v_old jsonb;
  v_org uuid;
  v_id text;
  v_actor text;
begin
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_org := coalesce((v_new->>'organization_id')::uuid, (v_old->>'organization_id')::uuid);
  v_id := coalesce(v_new->>'id', v_old->>'id', v_new->>'occurrence_id', v_old->>'occurrence_id', 'unknown');
  v_actor := coalesce(v_new->>'updated_by_name', v_new->>'created_by_name', v_new->>'uploaded_by_name', 'Sistema');
  insert into public.system_audit_events(organization_id, entity_type, entity_id, action, actor_name, before_data, after_data, snapshot, metadata)
  values (v_org, tg_table_name, v_id, lower(tg_op), v_actor, v_old, v_new, coalesce(v_new, v_old, '{}'::jsonb), jsonb_build_object('source', 'operational_diary'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists audit_operational_occurrences_trg on public.operational_occurrences;
create trigger audit_operational_occurrences_trg after insert or update or delete on public.operational_occurrences
for each row execute function public.audit_occurrence_change();
drop trigger if exists audit_operational_occurrence_updates_trg on public.operational_occurrence_updates;
create trigger audit_operational_occurrence_updates_trg after insert or update or delete on public.operational_occurrence_updates
for each row execute function public.audit_occurrence_change();
drop trigger if exists audit_operational_occurrence_attachments_trg on public.operational_occurrence_attachments;
create trigger audit_operational_occurrence_attachments_trg after insert or update or delete on public.operational_occurrence_attachments
for each row execute function public.audit_occurrence_change();
drop trigger if exists audit_shift_handovers_trg on public.shift_handovers;
create trigger audit_shift_handovers_trg after insert or update or delete on public.shift_handovers
for each row execute function public.audit_occurrence_change();

drop trigger if exists audit_operational_catalogs_trg on public.operational_catalogs;
create trigger audit_operational_catalogs_trg after insert or update or delete on public.operational_catalogs
for each row execute function public.audit_occurrence_change();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('occurrence-attachments', 'occurrence-attachments', false, 10485760,
  array['image/*', 'application/pdf', 'text/plain', 'text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists occurrence_attachments_storage_select on storage.objects;
create policy occurrence_attachments_storage_select on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'occurrence-attachments' and (storage.foldername(name))[1] = '8557a116-8377-44a6-b2f3-5b087f08bea8');
drop policy if exists occurrence_attachments_storage_insert on storage.objects;
create policy occurrence_attachments_storage_insert on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'occurrence-attachments' and (storage.foldername(name))[1] = '8557a116-8377-44a6-b2f3-5b087f08bea8');
drop policy if exists occurrence_attachments_storage_delete on storage.objects;
create policy occurrence_attachments_storage_delete on storage.objects
  for delete to anon, authenticated
  using (bucket_id = 'occurrence-attachments' and (storage.foldername(name))[1] = '8557a116-8377-44a6-b2f3-5b087f08bea8');

commit;
