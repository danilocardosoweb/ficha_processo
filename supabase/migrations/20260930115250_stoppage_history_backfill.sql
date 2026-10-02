-- Gera a origem auditável dos apontamentos existentes antes da implantação
-- do histórico por campo, sem modificar qualquer dado operacional.
insert into public.stoppage_change_history (
  organization_id, stoppage_id, action, field_name, new_value,
  actor_user_id, actor_name, occurred_at
)
select
  s.organization_id,
  s.id,
  'created',
  null,
  jsonb_build_object(
    'started_at', s.started_at,
    'initial_observation', coalesce(s.initial_observation, s.notes)
  ),
  s.created_by_user_id,
  coalesce(nullif(s.reported_by_name, ''), 'Sistema'),
  coalesce(s.created_at, s.started_at, now())
from public.machine_stoppages s
where not exists (
  select 1
    from public.stoppage_change_history h
   where h.stoppage_id = s.id
     and h.action = 'created'
);
