begin;

-- Mantém `notes` por compatibilidade com apontamentos e integrações já existentes.
-- Os novos campos passam a separar a observação feita na abertura da registrada no encerramento.
alter table public.machine_stoppages
  add column if not exists initial_observation text,
  add column if not exists closing_observation text,
  add column if not exists created_by_user_id uuid references private.local_users(id) on delete set null,
  add column if not exists closed_by_user_id uuid references private.local_users(id) on delete set null,
  add column if not exists updated_by_user_id uuid references private.local_users(id) on delete set null,
  add column if not exists updated_by_name text,
  add column if not exists deleted_by_user_id uuid references private.local_users(id) on delete set null,
  add column if not exists deleted_by_name text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deletion_reason text,
  add column if not exists is_deleted boolean not null default false;

update public.machine_stoppages
   set initial_observation = notes
 where initial_observation is null
   and notes is not null;

create index if not exists machine_stoppages_active_idx
  on public.machine_stoppages (organization_id, status, started_at desc)
  where is_deleted = false;

create index if not exists machine_stoppages_deleted_idx
  on public.machine_stoppages (organization_id, deleted_at desc)
  where is_deleted = true;

create table if not exists public.stoppage_change_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stoppage_id uuid not null references public.machine_stoppages(id) on delete restrict,
  action text not null check (action in ('created', 'closed', 'edited', 'deleted')),
  field_name text,
  old_value jsonb,
  new_value jsonb,
  actor_user_id uuid references private.local_users(id) on delete set null,
  actor_name text not null default 'Sistema',
  occurred_at timestamptz not null default now()
);

create index if not exists stoppage_change_history_lookup_idx
  on public.stoppage_change_history (organization_id, stoppage_id, occurred_at);

alter table public.stoppage_change_history enable row level security;
-- A leitura administrativa passa pela função local_get_machine_stoppage_details;
-- não exponha o histórico diretamente pela Data API.
revoke all on public.stoppage_change_history from public, anon, authenticated;

create or replace function private.audit_machine_stoppage_traceability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_name text;
  v_action text;
  v_field text;
  v_old jsonb;
  v_new jsonb;
begin
  v_actor_name := coalesce(nullif(new.updated_by_name, ''), nullif(new.closed_by_name, ''), nullif(new.reported_by_name, ''), 'Sistema');
  if tg_op = 'INSERT' then
    insert into public.stoppage_change_history (organization_id, stoppage_id, action, field_name, new_value, actor_user_id, actor_name)
    values (new.organization_id, new.id, 'created', null, jsonb_build_object('started_at', new.started_at, 'initial_observation', coalesce(new.initial_observation, new.notes)), new.created_by_user_id, v_actor_name);
    return new;
  end if;

  v_action := case when new.is_deleted and not old.is_deleted then 'deleted'
                   when new.status = 'closed' and old.status <> 'closed' then 'closed'
                   else 'edited' end;

  foreach v_field in array array['machine_code', 'reason', 'started_at', 'ended_at', 'initial_observation', 'closing_observation', 'responsible_department', 'shift', 'status', 'is_deleted', 'deletion_reason'] loop
    v_old := to_jsonb(old)->v_field;
    v_new := to_jsonb(new)->v_field;
    if v_old is distinct from v_new then
      insert into public.stoppage_change_history (organization_id, stoppage_id, action, field_name, old_value, new_value, actor_user_id, actor_name)
      values (new.organization_id, new.id, v_action, v_field, v_old, v_new, coalesce(new.updated_by_user_id, new.closed_by_user_id, new.deleted_by_user_id), v_actor_name);
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists audit_machine_stoppage_traceability_trg on public.machine_stoppages;
create trigger audit_machine_stoppage_traceability_trg
after insert or update on public.machine_stoppages
for each row execute function private.audit_machine_stoppage_traceability();

create or replace function private.require_stoppage_manager(p_token text)
returns private.local_users
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid; v_user private.local_users%rowtype;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor and is_active;
  if v_user.id is null or v_user.role not in ('admin', 'manager') then
    raise exception 'Acesso não autorizado.' using errcode = '42501';
  end if;
  return v_user;
end;
$$;

create or replace function public.local_close_machine_stoppage(
  p_token text, p_stoppage_id uuid, p_ended_at timestamptz, p_closing_observation text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid; v_user private.local_users%rowtype; v_row public.machine_stoppages%rowtype; v_duration numeric;
begin
  v_actor := private.require_local_session(p_token, false);
  select * into v_user from private.local_users where id = v_actor and is_active;
  if v_user.id is null or v_user.role not in ('admin', 'manager', 'operator', 'maintenance', 'pcp') then
    raise exception 'Acesso não autorizado.' using errcode = '42501';
  end if;
  select * into v_row from public.machine_stoppages where id = p_stoppage_id and organization_id = v_user.organization_id and not is_deleted for update;
  if v_row.id is null then raise exception 'Parada não encontrada.' using errcode = 'P0002'; end if;
  if v_row.status <> 'open' then raise exception 'Esta parada já foi encerrada.' using errcode = 'P0001'; end if;
  if p_ended_at is null or p_ended_at < v_row.started_at then raise exception 'O término não pode ser anterior ao início da parada.' using errcode = '22007'; end if;
  if p_ended_at > now() + interval '1 minute' then raise exception 'O término não pode estar no futuro.' using errcode = '22007'; end if;
  v_duration := round((extract(epoch from (p_ended_at - v_row.started_at)) / 60.0)::numeric, 2);
  update public.machine_stoppages
     set status = 'closed', ended_at = p_ended_at, duration_minutes = v_duration,
         closing_observation = nullif(btrim(coalesce(p_closing_observation, '')), ''),
         closed_by_name = v_user.display_name, closed_by_user_id = v_actor,
         updated_by_name = v_user.display_name, updated_by_user_id = v_actor
   where id = v_row.id;
end;
$$;

create or replace function public.local_update_machine_stoppage(
  p_token text, p_stoppage_id uuid, p_machine_code text, p_reason text,
  p_started_at timestamptz, p_ended_at timestamptz, p_initial_observation text,
  p_closing_observation text, p_responsible_department text, p_shift text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user private.local_users%rowtype; v_row public.machine_stoppages%rowtype; v_duration numeric; v_end timestamptz;
begin
  v_user := private.require_stoppage_manager(p_token);
  select * into v_row from public.machine_stoppages where id = p_stoppage_id and organization_id = v_user.organization_id and not is_deleted for update;
  if v_row.id is null then raise exception 'Parada não encontrada.' using errcode = 'P0002'; end if;
  if nullif(btrim(coalesce(p_machine_code, '')), '') is null or nullif(btrim(coalesce(p_reason, '')), '') is null or p_started_at is null or nullif(btrim(coalesce(p_initial_observation, '')), '') is null then
    raise exception 'Preencha os campos obrigatórios.' using errcode = '22023';
  end if;
  v_end := case when v_row.status = 'open' then null else p_ended_at end;
  if v_row.status <> 'open' and v_end is null then raise exception 'Informe o término de uma parada encerrada.' using errcode = '22023'; end if;
  if v_end is not null and v_end < p_started_at then raise exception 'O término não pode ser anterior ao início da parada.' using errcode = '22007'; end if;
  v_duration := case when v_end is null then null else round((extract(epoch from (v_end - p_started_at)) / 60.0)::numeric, 2) end;
  update public.machine_stoppages
     set machine_code = btrim(p_machine_code), reason = btrim(p_reason), started_at = p_started_at,
         ended_at = v_end, duration_minutes = v_duration, notes = btrim(p_initial_observation),
         initial_observation = btrim(p_initial_observation), closing_observation = nullif(btrim(coalesce(p_closing_observation, '')), ''),
         responsible_department = nullif(btrim(coalesce(p_responsible_department, '')), ''), shift = nullif(btrim(coalesce(p_shift, '')), ''),
         updated_by_name = v_user.display_name, updated_by_user_id = v_user.id
   where id = v_row.id;
end;
$$;

create or replace function public.local_delete_machine_stoppage(p_token text, p_stoppage_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_user private.local_users%rowtype; v_row public.machine_stoppages%rowtype;
begin
  v_user := private.require_stoppage_manager(p_token);
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Informe o motivo da exclusão.' using errcode = '22023'; end if;
  select * into v_row from public.machine_stoppages where id = p_stoppage_id and organization_id = v_user.organization_id and not is_deleted for update;
  if v_row.id is null then raise exception 'Parada não encontrada.' using errcode = 'P0002'; end if;
  update public.machine_stoppages
     set is_deleted = true, deleted_at = now(), deletion_reason = btrim(p_reason),
         deleted_by_user_id = v_user.id, deleted_by_name = v_user.display_name,
         updated_by_name = v_user.display_name, updated_by_user_id = v_user.id,
         status = case when status = 'open' then 'cancelled' else status end
   where id = v_row.id;
end;
$$;

create or replace function public.local_get_machine_stoppage_details(p_token text, p_stoppage_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid; v_org uuid; v_row public.machine_stoppages%rowtype;
begin
  v_actor := private.require_local_session(p_token, false);
  select organization_id into v_org from private.local_users where id = v_actor;
  select * into v_row from public.machine_stoppages where id = p_stoppage_id and organization_id = v_org;
  if v_row.id is null then raise exception 'Parada não encontrada.' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'stoppage', to_jsonb(v_row),
    'history', coalesce((select jsonb_agg(to_jsonb(h) order by h.occurred_at asc, h.id asc) from public.stoppage_change_history h where h.stoppage_id = v_row.id), '[]'::jsonb)
  );
end;
$$;

revoke all on function private.require_stoppage_manager(text) from public, anon, authenticated;
revoke all on function public.local_close_machine_stoppage(text, uuid, timestamptz, text) from public;
revoke all on function public.local_update_machine_stoppage(text, uuid, text, text, timestamptz, timestamptz, text, text, text, text) from public;
revoke all on function public.local_delete_machine_stoppage(text, uuid, text) from public;
revoke all on function public.local_get_machine_stoppage_details(text, uuid) from public;
grant execute on function public.local_close_machine_stoppage(text, uuid, timestamptz, text) to anon, authenticated;
grant execute on function public.local_update_machine_stoppage(text, uuid, text, text, timestamptz, timestamptz, text, text, text, text) to anon, authenticated;
grant execute on function public.local_delete_machine_stoppage(text, uuid, text) to anon, authenticated;
grant execute on function public.local_get_machine_stoppage_details(text, uuid) to anon, authenticated;

commit;
