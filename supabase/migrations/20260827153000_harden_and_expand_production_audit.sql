begin;

create or replace function public.audit_operational_change()
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
  v_action text;
begin
  v_new := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_old := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_org := coalesce((v_new->>'organization_id')::uuid, (v_old->>'organization_id')::uuid);
  v_id := coalesce(v_new->>'id', v_old->>'id', 'unknown');
  v_actor := coalesce(
    nullif(v_new->>'last_changed_by_name', ''),
    nullif(v_new->>'completed_by_name', ''),
    nullif(v_new->>'started_by_name', ''),
    nullif(v_new->>'reported_by_name', ''),
    nullif(v_new->>'updated_by_name', ''),
    'Sistema'
  );
  v_action := case
    when tg_table_name = 'process_sheets'
      and tg_op = 'INSERT'
      and nullif(v_new->>'copied_from_process_sheet_id', '') is not null
      then 'copy_setup'
    else lower(tg_op)
  end;

  insert into public.system_audit_events (
    organization_id, entity_type, entity_id, action, actor_name,
    before_data, after_data, metadata
  ) values (
    v_org, tg_table_name, v_id, v_action, v_actor, v_old, v_new,
    case
      when v_action = 'copy_setup' then jsonb_build_object(
        'source_process_sheet_id', v_new->>'copied_from_process_sheet_id',
        'source_sequence', v_new->>'copied_from_sequence',
        'new_sequence', v_new->>'tool_sequence'
      )
      else '{}'::jsonb
    end
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists audit_production_orders_trg on public.production_orders;
create trigger audit_production_orders_trg
after insert or update or delete on public.production_orders
for each row execute function public.audit_operational_change();

revoke all on function public.snapshot_completed_production() from public, anon, authenticated;
revoke all on function public.audit_operational_change() from public, anon, authenticated;

commit;
