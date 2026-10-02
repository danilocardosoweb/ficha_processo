create table if not exists public.planning_decision_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by_user_id uuid,
  created_at timestamptz not null default now(),
  engine_version text not null default 'deterministic-v3',
  press_code text not null,
  selected_order_id uuid,
  selected_score numeric(12,3) not null default 0,
  look_ahead_depth integer not null default 0,
  candidates_evaluated integer not null default 0,
  decision_reasons jsonb not null default '[]'::jsonb,
  penalties jsonb not null default '[]'::jsonb,
  risks_before jsonb not null default '[]'::jsonb,
  risks_after jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb
);
alter table public.planning_decision_logs enable row level security;
revoke all on public.planning_decision_logs from public, anon, authenticated;

create or replace function public.local_log_planning_decision(
  p_token text, p_press_code text, p_selected_order_id uuid, p_selected_score numeric,
  p_look_ahead_depth integer, p_candidates_evaluated integer, p_decision_reasons jsonb,
  p_penalties jsonb, p_risks_before jsonb, p_risks_after jsonb, p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_org uuid; v_id uuid;
begin
  v_actor := private.require_local_session(p_token, true);
  select organization_id into v_org from private.local_users where id=v_actor;
  insert into public.planning_decision_logs(organization_id,created_by_user_id,press_code,selected_order_id,selected_score,look_ahead_depth,candidates_evaluated,decision_reasons,penalties,risks_before,risks_after,metadata)
  values(v_org,v_actor,p_press_code,p_selected_order_id,p_selected_score,p_look_ahead_depth,p_candidates_evaluated,coalesce(p_decision_reasons,'[]'),coalesce(p_penalties,'[]'),coalesce(p_risks_before,'[]'),coalesce(p_risks_after,'[]'),coalesce(p_metadata,'{}')) returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.local_log_planning_decision(text,text,uuid,numeric,integer,integer,jsonb,jsonb,jsonb,jsonb,jsonb) to anon, authenticated;
