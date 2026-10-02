begin;

alter table public.production_report_imports
  add column if not exists status text not null default 'processed',
  add column if not exists headers jsonb not null default '[]'::jsonb,
  add column if not exists valid_row_count integer not null default 0,
  add column if not exists rejected_row_count integer not null default 0,
  add column if not exists preview_summary jsonb not null default '{}'::jsonb,
  add column if not exists normalization_version text not null default 'v1',
  add column if not exists processed_at timestamptz,
  add column if not exists error_message text;

alter table public.production_report_imports
  drop constraint if exists production_report_imports_status_check;
alter table public.production_report_imports
  add constraint production_report_imports_status_check
  check (status in ('preview', 'processing', 'processed', 'failed', 'rejected'));

create unique index if not exists production_report_imports_org_hash_uidx
  on public.production_report_imports (organization_id, file_hash)
  where file_hash is not null;

create table if not exists public.production_report_import_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_id uuid not null references public.production_report_imports(id) on delete cascade,
  row_number integer not null,
  row_status text not null check (row_status in ('valid', 'invalid')),
  fingerprint text not null,
  raw_data jsonb not null default '{}'::jsonb,
  normalized_data jsonb not null default '{}'::jsonb,
  validation_errors text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (import_id, row_number),
  unique (import_id, fingerprint)
);
create index if not exists production_report_import_rows_status_idx
  on public.production_report_import_rows (organization_id, import_id, row_status, row_number);

alter table public.external_production_records
  add column if not exists source_fingerprint text,
  add column if not exists normalization_version text not null default 'v1',
  add column if not exists normalized_start_at timestamptz,
  add column if not exists normalized_end_at timestamptz,
  add column if not exists validation_errors text[] not null default '{}',
  add column if not exists match_classification text not null default 'UNMATCHED',
  add column if not exists match_evidence jsonb not null default '{}'::jsonb,
  add column if not exists review_status text not null default 'pending',
  add column if not exists matched_by_user_id uuid,
  add column if not exists matched_reason text;

alter table public.external_production_records
  drop constraint if exists external_production_records_match_classification_check;
alter table public.external_production_records
  add constraint external_production_records_match_classification_check
  check (match_classification in ('EXACT', 'HIGH_CONFIDENCE', 'PROBABLE', 'AMBIGUOUS', 'UNMATCHED'));
alter table public.external_production_records
  drop constraint if exists external_production_records_review_status_check;
alter table public.external_production_records
  add constraint external_production_records_review_status_check
  check (review_status in ('pending', 'auto_linked', 'manual_linked', 'rejected'));

create unique index if not exists external_production_records_fingerprint_uidx
  on public.external_production_records (import_id, source_fingerprint)
  where source_fingerprint is not null;
create index if not exists external_production_records_review_idx
  on public.external_production_records (organization_id, review_status, match_classification, production_date);

alter table public.production_report_imports enable row level security;
alter table public.production_report_import_rows enable row level security;
alter table public.external_production_records enable row level security;

drop policy if exists "production_report_imports_open_access" on public.production_report_imports;
drop policy if exists "external_production_records_open_access" on public.external_production_records;
drop policy if exists production_report_imports_authenticated_select on public.production_report_imports;
create policy production_report_imports_authenticated_select on public.production_report_imports
  for select to authenticated using (organization_id in (select private.authorized_org_ids()));
drop policy if exists production_report_import_rows_authenticated_select on public.production_report_import_rows;
create policy production_report_import_rows_authenticated_select on public.production_report_import_rows
  for select to authenticated using (organization_id in (select private.authorized_org_ids()));
drop policy if exists external_production_records_authenticated_select on public.external_production_records;
create policy external_production_records_authenticated_select on public.external_production_records
  for select to authenticated using (organization_id in (select private.authorized_org_ids()));

revoke all on table public.production_report_imports from anon, authenticated;
revoke all on table public.production_report_import_rows from anon, authenticated;
revoke all on table public.external_production_records from anon, authenticated;

create or replace function public.local_prepare_production_report_import(
  p_token text,
  p_file_name text,
  p_file_hash text,
  p_source_sheet text,
  p_headers jsonb,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_import public.production_report_imports%rowtype;
  v_row jsonb;
  v_errors text[];
  v_valid integer := 0;
  v_rejected integer := 0;
  v_count integer := 0;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  if v_user.role not in ('admin', 'manager', 'pcp') then
    raise exception 'Seu perfil não pode importar apontamentos ERP.' using errcode = '42501';
  end if;
  if nullif(btrim(p_file_name), '') is null or nullif(btrim(p_file_hash), '') is null then
    raise exception 'Arquivo e hash são obrigatórios.';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'Linhas de importação inválidas.'; end if;

  select * into v_import
    from public.production_report_imports
   where organization_id = v_user.organization_id and file_hash = btrim(p_file_hash)
   order by imported_at desc limit 1;
  if v_import.id is not null then
    return jsonb_build_object('status', 'duplicate', 'import_id', v_import.id, 'file_hash', v_import.file_hash, 'row_count', v_import.row_count, 'valid_row_count', v_import.valid_row_count, 'rejected_row_count', v_import.rejected_row_count);
  end if;

  insert into public.production_report_imports (
    organization_id, file_name, file_hash, source_sheet, row_count,
    imported_by_name, status, headers, normalization_version
  ) values (
    v_user.organization_id, left(btrim(p_file_name), 255), btrim(p_file_hash), nullif(btrim(p_source_sheet), ''),
    jsonb_array_length(p_rows), v_user.display_name, 'preview', coalesce(p_headers, '[]'::jsonb), 'v1'
  ) returning * into v_import;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_count := v_count + 1;
    v_errors := array(select jsonb_array_elements_text(coalesce(v_row->'validationErrors', '[]'::jsonb)));
    if coalesce(jsonb_array_length(v_row->'validationErrors'), 0) = 0 then v_valid := v_valid + 1; else v_rejected := v_rejected + 1; end if;
    insert into public.production_report_import_rows (
      organization_id, import_id, row_number, row_status, fingerprint,
      raw_data, normalized_data, validation_errors
    ) values (
      v_user.organization_id, v_import.id, coalesce((v_row->>'rowNumber')::integer, v_count + 1),
      case when cardinality(v_errors) = 0 then 'valid' else 'invalid' end,
      coalesce(nullif(v_row->>'fingerprint', ''), md5(v_row::text)),
      coalesce(v_row->'rawData', '{}'::jsonb), coalesce(v_row->'normalizedData', '{}'::jsonb), coalesce(v_errors, '{}')
    );
  end loop;

  update public.production_report_imports
     set valid_row_count = v_valid,
         rejected_row_count = v_rejected,
         preview_summary = jsonb_build_object('total', v_count, 'valid', v_valid, 'rejected', v_rejected, 'normalization_version', 'v1')
   where id = v_import.id;
  return jsonb_build_object('status', 'preview', 'import_id', v_import.id, 'file_hash', v_import.file_hash, 'row_count', v_count, 'valid_row_count', v_valid, 'rejected_row_count', v_rejected, 'preview_summary', jsonb_build_object('total', v_count, 'valid', v_valid, 'rejected', v_rejected));
exception when unique_violation then
  select * into v_import from public.production_report_imports where organization_id = v_user.organization_id and file_hash = btrim(p_file_hash) order by imported_at desc limit 1;
  return jsonb_build_object('status', 'duplicate', 'import_id', v_import.id, 'file_hash', v_import.file_hash, 'row_count', v_import.row_count, 'valid_row_count', v_import.valid_row_count, 'rejected_row_count', v_import.rejected_row_count);
end;
$$;

create or replace function public.local_commit_production_report_import(
  p_token text,
  p_import_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_import public.production_report_imports%rowtype;
  v_count integer := 0;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  if v_user.role not in ('admin', 'manager', 'pcp') then raise exception 'Seu perfil não pode confirmar a importação.' using errcode = '42501'; end if;
  select * into v_import from public.production_report_imports where id = p_import_id and organization_id = v_user.organization_id for update;
  if v_import.id is null then raise exception 'Prévia de importação não encontrada.'; end if;
  if v_import.status = 'processed' then return jsonb_build_object('status', 'duplicate', 'import_id', v_import.id, 'inserted_rows', 0); end if;
  if v_import.status <> 'preview' then raise exception 'Esta importação não está aguardando confirmação.'; end if;

  update public.production_report_imports set status = 'processing', error_message = null where id = v_import.id;
  insert into public.external_production_records (
    organization_id, import_id, row_number, machine_code, production_date, batch_number,
    start_time, end_time, shift_code, product_code, tool_code, tool_sequence,
    billet_quantity, billet_length_mm, gross_weight_kg, net_weight_kg, efficiency_percent,
    achieved_productivity_kg_h, produced_quantity, theoretical_linear_weight_kg_m,
    actual_linear_weight_kg_m, packaging_linear_weight_kg_m, alloy_code, alloy_used,
    order_number, state, scrap_kg, losses_kg, source_fingerprint, normalization_version,
    normalized_start_at, normalized_end_at, validation_errors, raw_data,
    match_classification, review_status
  )
  select r.organization_id, r.import_id, r.row_number,
    nullif(r.normalized_data->>'machine_code', ''), nullif(r.normalized_data->>'production_date', '')::date,
    nullif(r.normalized_data->>'batch_number', ''), nullif(r.normalized_data->>'start_time', '')::time,
    nullif(r.normalized_data->>'end_time', '')::time, nullif(r.normalized_data->>'shift_code', ''),
    nullif(r.normalized_data->>'product_code', ''), nullif(r.normalized_data->>'tool_code', ''), nullif(r.normalized_data->>'tool_sequence', '')::integer,
    nullif(r.normalized_data->>'billet_quantity', '')::numeric, nullif(r.normalized_data->>'billet_length_mm', '')::numeric,
    nullif(r.normalized_data->>'gross_weight_kg', '')::numeric, nullif(r.normalized_data->>'net_weight_kg', '')::numeric,
    nullif(r.normalized_data->>'efficiency_percent', '')::numeric, nullif(r.normalized_data->>'achieved_productivity_kg_h', '')::numeric,
    nullif(r.normalized_data->>'produced_quantity', '')::numeric, nullif(r.normalized_data->>'theoretical_linear_weight_kg_m', '')::numeric,
    nullif(r.normalized_data->>'actual_linear_weight_kg_m', '')::numeric, nullif(r.normalized_data->>'packaging_linear_weight_kg_m', '')::numeric,
    nullif(r.normalized_data->>'alloy_code', ''), nullif(r.normalized_data->>'alloy_used', ''), nullif(r.normalized_data->>'order_number', ''),
    nullif(r.normalized_data->>'state', ''), nullif(r.normalized_data->>'scrap_kg', '')::numeric, nullif(r.normalized_data->>'losses_kg', '')::numeric,
    r.fingerprint, coalesce(nullif(r.normalized_data->>'normalization_version', ''), 'v1'),
    nullif(r.normalized_data->>'start_at', '')::timestamptz, nullif(r.normalized_data->>'end_at', '')::timestamptz,
    r.validation_errors, r.raw_data, 'UNMATCHED', 'pending'
  from public.production_report_import_rows r
  where r.import_id = v_import.id and r.row_status = 'valid'
  on conflict (import_id, row_number) do nothing;
  get diagnostics v_count = row_count;

  update public.production_report_imports
     set status = 'processed', processed_at = clock_timestamp(), valid_row_count = v_count,
         preview_summary = preview_summary || jsonb_build_object('inserted_rows', v_count)
   where id = v_import.id;
  return jsonb_build_object('status', 'processed', 'import_id', v_import.id, 'inserted_rows', v_count, 'rejected_rows', v_import.rejected_row_count);
exception when others then
  update public.production_report_imports set status = 'failed', error_message = sqlerrm where id = p_import_id;
  raise;
end;
$$;

create or replace function public.local_get_audit_reconciliation_data(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_history jsonb;
  v_audit jsonb;
  v_external jsonb;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  select coalesce(jsonb_agg(to_jsonb(h) order by h.completed_at desc), '[]'::jsonb) into v_history from (select id,machine_code,tool_code,tool_sequence,plan_code,order_number,started_at,completed_at,produced_kg,produced_quantity,achieved_productivity_kg_h,operator_name,setup_snapshot,planning_snapshot from public.production_execution_history where organization_id = v_org order by completed_at desc limit 500) h;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.occurred_at desc), '[]'::jsonb) into v_audit from (select id,entity_type,entity_id,action,actor_name,occurred_at,before_data,after_data,snapshot,metadata from public.system_audit_events where organization_id = v_org order by occurred_at desc limit 1000) a;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb) into v_external from (select id,production_date,machine_code,tool_code,tool_sequence,batch_number,order_number,net_weight_kg,achieved_productivity_kg_h,matched_execution_id,match_confidence,match_classification,match_evidence,review_status from public.external_production_records where organization_id = v_org order by created_at desc limit 2000) e;
  return jsonb_build_object('history', v_history, 'audit', v_audit, 'external', v_external);
end;
$$;

create or replace function public.local_apply_production_match(
  p_token text,
  p_record_id uuid,
  p_execution_id uuid,
  p_classification text,
  p_score numeric,
  p_evidence jsonb,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_catalog
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_record public.external_production_records%rowtype;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  if v_user.role not in ('admin', 'manager', 'pcp') then raise exception 'Seu perfil não pode confirmar vínculos ERP.' using errcode = '42501'; end if;
  if p_classification not in ('EXACT', 'HIGH_CONFIDENCE', 'PROBABLE', 'AMBIGUOUS', 'UNMATCHED') then raise exception 'Classificação de vínculo inválida.'; end if;
  if p_classification = 'AMBIGUOUS' and p_execution_id is not null then raise exception 'Caso ambíguo não pode ser vinculado automaticamente.'; end if;
  if p_execution_id is not null and not exists (
    select 1 from public.production_execution_history
     where id = p_execution_id and organization_id = v_user.organization_id
  ) then
    raise exception 'A execução escolhida não pertence à organização atual.' using errcode = '42501';
  end if;
  update public.external_production_records
     set matched_execution_id = p_execution_id,
         match_confidence = case when p_execution_id is null then null else greatest(0, least(100, p_score)) end,
         matched_at = case when p_execution_id is null then null else clock_timestamp() end,
         match_classification = p_classification,
         match_evidence = coalesce(p_evidence, '{}'::jsonb),
         review_status = case when p_execution_id is null then 'rejected' when p_reason is null then 'auto_linked' else 'manual_linked' end,
         matched_by_user_id = case when p_execution_id is null then null else v_actor end,
         matched_reason = nullif(btrim(p_reason), '')
   where id = p_record_id and organization_id = v_user.organization_id
   returning * into v_record;
  if v_record.id is null then raise exception 'Apontamento ERP não encontrado.'; end if;
  return to_jsonb(v_record);
end;
$$;

revoke all on function public.local_prepare_production_report_import(text, text, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.local_commit_production_report_import(text, uuid) from public, anon, authenticated;
revoke all on function public.local_get_audit_reconciliation_data(text) from public, anon, authenticated;
revoke all on function public.local_apply_production_match(text, uuid, uuid, text, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.local_prepare_production_report_import(text, text, text, text, jsonb, jsonb) to anon, authenticated;
grant execute on function public.local_commit_production_report_import(text, uuid) to anon, authenticated;
grant execute on function public.local_get_audit_reconciliation_data(text) to anon, authenticated;
grant execute on function public.local_apply_production_match(text, uuid, uuid, text, numeric, jsonb, text) to anon, authenticated;

commit;
