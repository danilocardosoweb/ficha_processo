-- Trigger functions are invoked by PostgreSQL and must not be callable as API RPCs.

revoke all on function public.capture_approved_simulation_oven_reservations()
  from public, anon, authenticated;

revoke all on function public.capture_planning_learning_observation()
  from public, anon, authenticated;
