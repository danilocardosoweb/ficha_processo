-- Memória auditável da análise determinística da carteira.
-- As tabelas não ficam expostas pela Data API: apenas RPCs autenticadas pela
-- sessão local podem ler ou gravar dados.
create table if not exists public.portfolio_analysis_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_signature text not null check (char_length(source_signature) between 16 and 128),
  engine_version text not null default 'portfolio-priority-v1' check (char_length(engine_version) <= 80),
  source_batch_id uuid references public.pcp_import_batches(id) on delete set null,
  summary jsonb not null default '{}'::jsonb check (octet_length(summary::text) <= 65536),
  analysis_context jsonb not null default '{}'::jsonb check (octet_length(analysis_context::text) <= 524288),
  created_by_user_id uuid references private.local_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, source_signature)
);

create table if not exists public.portfolio_analysis_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_id uuid not null references public.portfolio_analysis_snapshots(id) on delete cascade,
  event_type text not null check (event_type in ('ORDER_ENTERED','ORDER_BECAME_OVERDUE','ORDER_PLANNED','ORDER_PARTIALLY_PLANNED','ORDER_UNPLANNED','TOOL_STATUS_CHANGED','ORDER_OVERTAKEN','DATA_INCONSISTENCY')),
  entity_key text not null check (char_length(entity_key) between 1 and 180),
  details jsonb not null default '{}'::jsonb check (octet_length(details::text) <= 16384),
  occurred_at timestamptz not null default now()
);

create table if not exists public.portfolio_user_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  snapshot_id uuid references public.portfolio_analysis_snapshots(id) on delete set null,
  created_by_user_id uuid references private.local_users(id) on delete set null,
  suggested_item text not null check (char_length(suggested_item) between 1 and 180),
  selected_item text not null check (char_length(selected_item) between 1 and 180),
  reason text check (char_length(reason) <= 1000),
  context_snapshot jsonb not null default '{}'::jsonb check (octet_length(context_snapshot::text) <= 32768),
  created_at timestamptz not null default now()
);

create index if not exists portfolio_analysis_snapshots_org_created_idx on public.portfolio_analysis_snapshots (organization_id, created_at desc);
create index if not exists portfolio_analysis_events_snapshot_idx on public.portfolio_analysis_events (snapshot_id, occurred_at desc);
create index if not exists portfolio_user_decisions_org_created_idx on public.portfolio_user_decisions (organization_id, created_at desc);

alter table public.portfolio_analysis_snapshots enable row level security;
alter table public.portfolio_analysis_events enable row level security;
alter table public.portfolio_user_decisions enable row level security;
revoke all on public.portfolio_analysis_snapshots, public.portfolio_analysis_events, public.portfolio_user_decisions from public, anon, authenticated;

create or replace function public.local_save_portfolio_analysis_snapshot(
  p_token text, p_source_signature text, p_engine_version text, p_source_batch_id uuid,
  p_summary jsonb, p_analysis_context jsonb, p_events jsonb default '[]'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_org uuid; v_snapshot uuid; v_event jsonb;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  insert into public.portfolio_analysis_snapshots(organization_id,source_signature,engine_version,source_batch_id,summary,analysis_context,created_by_user_id)
  values(v_org,p_source_signature,p_engine_version,p_source_batch_id,coalesce(p_summary,'{}'),coalesce(p_analysis_context,'{}'),v_actor)
  on conflict (organization_id,source_signature) do nothing
  returning id into v_snapshot;
  if v_snapshot is null then
    select id into v_snapshot from public.portfolio_analysis_snapshots where organization_id=v_org and source_signature=p_source_signature;
    return v_snapshot;
  end if;
  if jsonb_typeof(coalesce(p_events,'[]')) = 'array' then
    for v_event in select value from jsonb_array_elements(p_events) loop
      insert into public.portfolio_analysis_events(organization_id,snapshot_id,event_type,entity_key,details)
      values(v_org,v_snapshot,coalesce(v_event->>'event_type','DATA_INCONSISTENCY'),coalesce(nullif(v_event->>'entity_key',''),'unknown'),coalesce(v_event->'details','{}'));
    end loop;
  end if;
  return v_snapshot;
end; $$;

create or replace function public.local_list_portfolio_analysis_snapshots(p_token text, p_limit integer default 10)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_org uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  return coalesce((select jsonb_agg(jsonb_build_object('id',id,'engine_version',engine_version,'summary',summary,'created_at',created_at) order by created_at desc)
    from (select id,engine_version,summary,created_at from public.portfolio_analysis_snapshots where organization_id=v_org order by created_at desc limit greatest(1,least(coalesce(p_limit,10),50))) snapshots),'[]'::jsonb);
end; $$;

create or replace function public.local_record_portfolio_decision(p_token text, p_snapshot_id uuid, p_suggested_item text, p_selected_item text, p_reason text default null, p_context_snapshot jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_org uuid; v_id uuid;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  if p_snapshot_id is not null and not exists(select 1 from public.portfolio_analysis_snapshots where id=p_snapshot_id and organization_id=v_org) then raise exception 'Snapshot não encontrado.' using errcode='P0002'; end if;
  insert into public.portfolio_user_decisions(organization_id,snapshot_id,created_by_user_id,suggested_item,selected_item,reason,context_snapshot)
  values(v_org,p_snapshot_id,p_suggested_item,p_selected_item,nullif(btrim(p_reason),''),coalesce(p_context_snapshot,'{}')) returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.local_save_portfolio_analysis_snapshot(text,text,text,uuid,jsonb,jsonb,jsonb) from public;
revoke all on function public.local_list_portfolio_analysis_snapshots(text,integer) from public;
revoke all on function public.local_record_portfolio_decision(text,uuid,text,text,text,jsonb) from public;
grant execute on function public.local_save_portfolio_analysis_snapshot(text,text,text,uuid,jsonb,jsonb,jsonb) to anon, authenticated;
grant execute on function public.local_list_portfolio_analysis_snapshots(text,integer) to anon, authenticated;
grant execute on function public.local_record_portfolio_decision(text,uuid,text,text,text,jsonb) to anon, authenticated;
