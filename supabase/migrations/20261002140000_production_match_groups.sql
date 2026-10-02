begin;

create table if not exists public.production_match_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  relation_type text not null default '1:1' check (relation_type in ('1:1', '1:N', 'N:1')),
  classification text not null check (classification in ('EXACT', 'HIGH_CONFIDENCE', 'PROBABLE', 'AMBIGUOUS', 'UNMATCHED')),
  review_status text not null default 'pending' check (review_status in ('pending', 'auto_linked', 'manual_linked', 'rejected')),
  score numeric(5,2),
  evidence jsonb not null default '{}'::jsonb,
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.production_matches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_id uuid not null references public.production_match_groups(id) on delete cascade,
  external_record_id uuid not null references public.external_production_records(id) on delete cascade,
  execution_id uuid references public.production_execution_history(id) on delete set null,
  relation_role text not null default 'primary' check (relation_role in ('primary', 'source', 'target')),
  score numeric(5,2),
  allocation_kg numeric(14,3),
  allocation_quantity numeric(14,3),
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (group_id, external_record_id, execution_id)
);

create table if not exists public.production_discrepancies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_id uuid not null references public.production_match_groups(id) on delete cascade,
  external_record_id uuid references public.external_production_records(id) on delete cascade,
  execution_id uuid references public.production_execution_history(id) on delete set null,
  field_name text not null,
  erp_value jsonb,
  app_value jsonb,
  delta_numeric numeric,
  severity text not null default 'info' check (severity in ('info', 'warning', 'critical')),
  status text not null default 'open' check (status in ('open', 'accepted', 'ignored')),
  created_at timestamptz not null default now()
);

alter table public.external_production_records
  add column if not exists match_group_id uuid references public.production_match_groups(id) on delete set null,
  add column if not exists field_comparisons jsonb not null default '[]'::jsonb;

create index if not exists production_match_groups_review_idx
  on public.production_match_groups (organization_id, review_status, classification, updated_at desc);
create index if not exists production_matches_external_idx
  on public.production_matches (organization_id, external_record_id, created_at desc);
create index if not exists production_discrepancies_group_idx
  on public.production_discrepancies (organization_id, group_id, status, severity);

alter table public.production_match_groups enable row level security;
alter table public.production_matches enable row level security;
alter table public.production_discrepancies enable row level security;

revoke all on table public.production_match_groups from anon, authenticated;
revoke all on table public.production_matches from anon, authenticated;
revoke all on table public.production_discrepancies from anon, authenticated;

drop policy if exists production_match_groups_authenticated_select on public.production_match_groups;
create policy production_match_groups_authenticated_select on public.production_match_groups
  for select to authenticated using (organization_id in (select private.authorized_org_ids()));
drop policy if exists production_matches_authenticated_select on public.production_matches;
create policy production_matches_authenticated_select on public.production_matches
  for select to authenticated using (organization_id in (select private.authorized_org_ids()));
drop policy if exists production_discrepancies_authenticated_select on public.production_discrepancies;
create policy production_discrepancies_authenticated_select on public.production_discrepancies
  for select to authenticated using (organization_id in (select private.authorized_org_ids()));

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
  v_group_id uuid;
  v_review_status text;
  v_discrepancy jsonb;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  if v_user.role not in ('admin', 'manager', 'pcp') then raise exception 'Seu perfil não pode confirmar vínculos ERP.' using errcode = '42501'; end if;
  if p_classification not in ('EXACT', 'HIGH_CONFIDENCE', 'PROBABLE', 'AMBIGUOUS', 'UNMATCHED') then raise exception 'Classificação de vínculo inválida.'; end if;
  select * into v_record from public.external_production_records where id = p_record_id and organization_id = v_user.organization_id for update;
  if v_record.id is null then raise exception 'Apontamento ERP não encontrado.'; end if;
  if p_execution_id is not null and not exists (
    select 1 from public.production_execution_history
     where id = p_execution_id and organization_id = v_user.organization_id
  ) then
    raise exception 'A execução escolhida não pertence à organização atual.' using errcode = '42501';
  end if;
  if p_classification = 'AMBIGUOUS' and p_execution_id is not null and nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'Caso ambíguo precisa de justificativa para vínculo manual.';
  end if;

  v_review_status := case
    when p_execution_id is null and p_classification in ('AMBIGUOUS', 'PROBABLE') then 'pending'
    when p_execution_id is null then 'rejected'
    when nullif(btrim(coalesce(p_reason, '')), '') is null then 'auto_linked'
    else 'manual_linked'
  end;

  v_group_id := v_record.match_group_id;
  if v_group_id is null then
    insert into public.production_match_groups (
      organization_id, relation_type, classification, review_status, score, evidence,
      reviewed_by_user_id, reviewed_at, review_reason
    ) values (
      v_user.organization_id, '1:1', p_classification, v_review_status, p_score,
      coalesce(p_evidence, '{}'::jsonb),
      case when v_review_status in ('auto_linked', 'manual_linked', 'rejected') then v_actor else null end,
      case when v_review_status in ('auto_linked', 'manual_linked', 'rejected') then clock_timestamp() else null end,
      nullif(btrim(coalesce(p_reason, '')), '')
    ) returning id into v_group_id;
  else
    update public.production_match_groups
       set classification = p_classification,
           review_status = v_review_status,
           score = p_score,
           evidence = coalesce(p_evidence, '{}'::jsonb),
           reviewed_by_user_id = case when v_review_status in ('auto_linked', 'manual_linked', 'rejected') then v_actor else null end,
           reviewed_at = case when v_review_status in ('auto_linked', 'manual_linked', 'rejected') then clock_timestamp() else null end,
           review_reason = nullif(btrim(coalesce(p_reason, '')), ''),
           updated_at = clock_timestamp()
     where id = v_group_id and organization_id = v_user.organization_id;
  end if;

  if p_execution_id is not null then
    insert into public.production_matches (
      organization_id, group_id, external_record_id, execution_id,
      score, evidence
    ) values (
      v_user.organization_id, v_group_id, v_record.id, p_execution_id,
      greatest(0, least(100, p_score)), coalesce(p_evidence, '{}'::jsonb)
    ) on conflict (group_id, external_record_id, execution_id) do update
      set score = excluded.score, evidence = excluded.evidence;
  end if;

  delete from public.production_discrepancies where group_id = v_group_id;
  if jsonb_typeof(coalesce(p_evidence->'discrepancies', '[]'::jsonb)) = 'array' then
    for v_discrepancy in select value from jsonb_array_elements(coalesce(p_evidence->'discrepancies', '[]'::jsonb)) loop
      insert into public.production_discrepancies (
        organization_id, group_id, external_record_id, execution_id, field_name,
        erp_value, app_value, delta_numeric, severity
      ) values (
        v_user.organization_id, v_group_id, v_record.id, p_execution_id,
        coalesce(v_discrepancy->>'field', 'campo'),
        v_discrepancy->'erp_value', v_discrepancy->'app_value',
        nullif(v_discrepancy->>'delta', '')::numeric,
        case when coalesce((v_discrepancy->>'severity'), 'info') in ('warning', 'critical') then v_discrepancy->>'severity' else 'info' end
      );
    end loop;
  end if;

  update public.external_production_records
     set matched_execution_id = p_execution_id,
         match_confidence = case when p_execution_id is null then null else greatest(0, least(100, p_score)) end,
         matched_at = case when p_execution_id is null then null else clock_timestamp() end,
         match_group_id = v_group_id,
         match_classification = p_classification,
         match_evidence = coalesce(p_evidence, '{}'::jsonb),
         field_comparisons = coalesce(p_evidence->'field_comparisons', '[]'::jsonb),
         review_status = v_review_status,
         matched_by_user_id = case when p_execution_id is null then null else v_actor end,
         matched_reason = nullif(btrim(coalesce(p_reason, '')), '')
   where id = v_record.id and organization_id = v_user.organization_id
   returning * into v_record;
  return jsonb_build_object('record', to_jsonb(v_record), 'group_id', v_group_id, 'review_status', v_review_status);
end;
$$;

revoke all on function public.local_apply_production_match(text, uuid, uuid, text, numeric, jsonb, text) from public, anon, authenticated;
grant execute on function public.local_apply_production_match(text, uuid, uuid, text, numeric, jsonb, text) to anon, authenticated;

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
  select coalesce(jsonb_agg(to_jsonb(h) order by h.completed_at desc), '[]'::jsonb) into v_history
    from (select id,machine_code,tool_code,tool_sequence,plan_code,order_number,started_at,completed_at,produced_kg,produced_quantity,achieved_productivity_kg_h,operator_name,setup_snapshot,planning_snapshot from public.production_execution_history where organization_id = v_org order by completed_at desc limit 500) h;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.occurred_at desc), '[]'::jsonb) into v_audit
    from (select id,entity_type,entity_id,action,actor_name,occurred_at,before_data,after_data,snapshot,metadata from public.system_audit_events where organization_id = v_org order by occurred_at desc limit 1000) a;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb) into v_external
    from (select id,production_date,machine_code,tool_code,tool_sequence,batch_number,order_number,start_time,end_time,alloy_code,billet_quantity,gross_weight_kg,net_weight_kg,produced_quantity,achieved_productivity_kg_h,matched_execution_id,match_confidence,match_group_id,match_classification,match_evidence,field_comparisons,review_status from public.external_production_records where organization_id = v_org order by created_at desc limit 2000) e;
  return jsonb_build_object('history', v_history, 'audit', v_audit, 'external', v_external);
end;
$$;

revoke all on function public.local_get_audit_reconciliation_data(text) from public, anon, authenticated;
grant execute on function public.local_get_audit_reconciliation_data(text) to anon, authenticated;

commit;
