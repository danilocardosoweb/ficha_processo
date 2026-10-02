create or replace function private.guard_decision_profile_approval()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_version public.simulation_versions;
begin
  if new.status='approved' and old.status is distinct from 'approved' then
    select * into v_version from public.simulation_versions where scenario_id=new.id and version_number=new.current_version;
    if v_version.model_version='alupilot-v3.0' and
      (v_version.score_snapshot #>> '{decision,status}') is distinct from 'viable' then
      raise exception 'O perfil de decisão tem impedimentos ou dados não confirmados. Recalcule e confira antes de aprovar.';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_decision_profile_approval() from public,anon,authenticated;
create trigger guard_decision_profile_approval before update of status on public.simulation_scenarios
for each row execute function private.guard_decision_profile_approval();
