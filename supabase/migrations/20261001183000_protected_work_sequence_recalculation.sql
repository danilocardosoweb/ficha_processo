-- Protected manual adjustments to the approved work sequence.
-- The original Simplificada remains immutable; this revision only changes the
-- active production queue and records the before/after positions.
begin;

create table if not exists public.production_sequence_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references private.local_users(id) on delete set null,
  actor_name text not null,
  reason text not null,
  changed_orders integer not null default 0 check (changed_orders >= 0),
  before_sequence jsonb not null default '[]'::jsonb,
  after_sequence jsonb not null default '[]'::jsonb,
  recalculated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists production_sequence_revisions_org_time_idx
  on public.production_sequence_revisions (organization_id, created_at desc);

alter table public.production_sequence_revisions enable row level security;
revoke all on public.production_sequence_revisions from public, anon, authenticated;

create or replace function public.local_resequence_work_queue(
  p_token text,
  p_password text,
  p_order_ids uuid[],
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_user private.local_users%rowtype;
  v_org uuid;
  v_revision_id uuid;
  v_now timestamptz := now();
  v_before jsonb;
  v_after jsonb;
  v_changed integer := 0;
  v_total integer := 0;
  v_machine_codes text[];
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor;
  v_org := v_user.organization_id;
  -- Serialize queue edits per operation so two PCP adjustments cannot overwrite
  -- each other's recalculation and audit snapshot.
  perform pg_advisory_xact_lock(hashtextextended(v_org::text, 0));

  if v_user.role not in ('admin', 'manager', 'pcp') then
    raise exception 'Seu perfil não pode alterar a sequência de trabalho.' using errcode = '42501';
  end if;
  if char_length(coalesce(p_password, '')) < 1
     or extensions.crypt(p_password, v_user.password_hash) <> v_user.password_hash then
    raise exception 'Senha de liberação inválida.' using errcode = '28000';
  end if;
  if coalesce(cardinality(p_order_ids), 0) < 1 then
    raise exception 'Nenhuma ordem foi enviada para reordenar.' using errcode = '22023';
  end if;
  if cardinality(p_order_ids) > 500 then
    raise exception 'Ajuste no máximo 500 ordens por vez.' using errcode = '22023';
  end if;
  if length(coalesce(btrim(p_reason), '')) < 8 then
    raise exception 'Informe o motivo do ajuste (mínimo de 8 caracteres).' using errcode = '22023';
  end if;
  if (select count(*) from (select unnest(p_order_ids) id group by id having count(*) > 1) duplicates) > 0 then
    raise exception 'A sequência contém ordem repetida.' using errcode = '22023';
  end if;

  create temporary table tmp_sequence_targets on commit drop as
  select
    po.id,
    po.machine_code,
    po.sequence as old_sequence,
    row_number() over (
      partition by po.machine_code
      order by array_position(p_order_ids, po.id)
    )::integer as new_sequence
  from public.production_orders po
  where po.organization_id = v_org
    and po.id = any(p_order_ids);

  select count(*) into v_total from tmp_sequence_targets;
  if v_total <> cardinality(p_order_ids) then
    raise exception 'Uma ou mais ordens não pertencem à sua operação.' using errcode = '42501';
  end if;
  if exists (
    select 1 from tmp_sequence_targets t
    join public.production_orders po on po.id = t.id
    where po.status not in ('planned', 'released', 'paused')
       or po.actual_start is not null
       or po.is_active is distinct from true
  ) then
    raise exception 'A sequência só pode ser alterada para ordens ainda não iniciadas.' using errcode = '55000';
  end if;
  if coalesce(cardinality(v_user.machine_codes), 0) > 0
     and exists (
       select 1 from tmp_sequence_targets t
       where not (t.machine_code = any(v_user.machine_codes))
     ) then
    raise exception 'Ajuste bloqueado: há ordem em uma prensa fora do seu acesso.' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'machineCode', t.machine_code,
    'sequence', t.old_sequence
  ) order by t.machine_code, t.old_sequence, t.id), '[]'::jsonb)
    into v_before
  from tmp_sequence_targets t;

  select count(*) into v_changed from tmp_sequence_targets where old_sequence is distinct from new_sequence;

  update public.production_orders po
     set sequence = t.new_sequence,
         reprogram_count = po.reprogram_count + case when t.old_sequence is distinct from t.new_sequence then 1 else 0 end,
         last_status_reason = case
           when t.old_sequence is distinct from t.new_sequence
             then concat('Sequência de trabalho ajustada por ', v_user.display_name, ': ', btrim(p_reason))
           else po.last_status_reason
         end,
         updated_at = v_now
    from tmp_sequence_targets t
   where po.id = t.id
     and po.organization_id = v_org;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'machineCode', t.machine_code,
    'sequence', t.new_sequence
  ) order by t.machine_code, t.new_sequence, t.id), '[]'::jsonb)
    into v_after
  from tmp_sequence_targets t;

  insert into public.production_sequence_revisions (
    organization_id, actor_user_id, actor_name, reason, changed_orders,
    before_sequence, after_sequence, recalculated_at
  ) values (
    v_org, v_actor, coalesce(v_user.display_name, v_user.username), btrim(p_reason), v_changed,
    v_before, v_after, v_now
  ) returning id into v_revision_id;

  insert into public.system_audit_events (
    organization_id, entity_type, entity_id, action, actor_name,
    before_data, after_data, snapshot, metadata
  ) values (
    v_org, 'production_sequence', v_revision_id::text, 'update',
    coalesce(v_user.display_name, v_user.username), v_before, v_after,
    jsonb_build_object('reason', btrim(p_reason), 'recalculatedAt', v_now),
    jsonb_build_object('changedOrders', v_changed, 'orderCount', v_total)
  );

  return jsonb_build_object(
    'revisionId', v_revision_id,
    'changedOrders', v_changed,
    'orderCount', v_total,
    'recalculatedAt', v_now,
    'sequence', v_after
  );
end;
$$;

revoke all on function public.local_resequence_work_queue(text, text, uuid[], text) from public, anon, authenticated;
grant execute on function public.local_resequence_work_queue(text, text, uuid[], text) to anon, authenticated;

commit;
