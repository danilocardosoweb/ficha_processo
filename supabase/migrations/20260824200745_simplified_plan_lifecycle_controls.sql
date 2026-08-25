alter table public.simplified_imports
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_name text,
  add column if not exists deletion_reason text;

create index if not exists simplified_imports_visible_queue_idx
  on public.simplified_imports (organization_id, created_at)
  where deleted_at is null and status = 'processed';

create or replace function private.guard_production_order_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status in ('planned', 'released', 'paused') and new.status in ('in_progress', 'completed', 'cancelled'))
      or (old.status = 'in_progress' and new.status in ('paused', 'completed', 'cancelled'))
      or (old.status = 'completed' and new.status = 'planned'
          and new.reopened_at is not null
          and new.reprogram_count > old.reprogram_count)
    ) then
      raise exception 'Transição de status não permitida: % para %', old.status, new.status;
    end if;

    if new.status = 'in_progress' then
      if nullif(trim(new.started_by_name), '') is null then
        raise exception 'Informe o operador antes de iniciar a produção';
      end if;
      new.actual_start := coalesce(new.actual_start, now());
      new.actual_end := null;
      new.is_active := true;
    elsif new.status = 'completed' then
      if nullif(trim(new.completed_by_name), '') is null then
        raise exception 'Informe o operador antes de concluir a produção';
      end if;
      new.actual_start := coalesce(new.actual_start, now());
      new.actual_end := coalesce(new.actual_end, now());
      new.is_active := false;
    elsif old.status = 'completed' and new.status = 'planned' then
      if new.import_batch_id is not null and not exists (
        select 1 from public.simplified_imports si
         where si.id = new.import_batch_id
           and si.status = 'processed'
           and si.deleted_at is null
      ) then
        raise exception 'A Simplificada deste item não está disponível para reprogramação.';
      end if;
      if new.import_batch_id is not null then
        update public.simplified_imports
           set is_active = true,
               production_status = 'queued',
               production_completed_at = null,
               production_completed_by_name = null
         where id = new.import_batch_id;
      end if;
      new.is_active := true;
      new.actual_start := null;
      new.actual_end := null;
      new.started_by_name := null;
      new.completed_by_name := null;
      new.produced_kg := 0;
      new.produced_quantity := 0;
    elsif new.status = 'cancelled' then
      new.is_active := false;
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.finish_simplified_plan(
  p_import_id uuid,
  p_actor text,
  p_reason text default 'Plano finalizado manualmente'
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if nullif(btrim(p_actor), '') is null then
    raise exception 'Informe o usuário responsável.';
  end if;

  update public.production_orders
     set status = 'cancelled',
         is_active = false,
         completed_by_name = p_actor,
         last_status_reason = concat('Item encerrado sem produção por ', p_actor, ': ', coalesce(nullif(btrim(p_reason), ''), 'Plano finalizado'))
   where import_batch_id = p_import_id
     and status in ('planned', 'released', 'in_progress', 'paused');

  update public.simplified_imports
     set is_active = false,
         production_status = 'completed',
         production_completed_at = coalesce(production_completed_at, now()),
         production_completed_by_name = p_actor
   where id = p_import_id
     and deleted_at is null;

  if not found then raise exception 'Simplificada não encontrada ou já excluída.'; end if;
end;
$$;

create or replace function public.archive_simplified_plan(
  p_import_id uuid,
  p_actor text,
  p_reason text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if nullif(btrim(p_actor), '') is null then
    raise exception 'Informe o usuário responsável.';
  end if;
  if length(coalesce(btrim(p_reason), '')) < 5 then
    raise exception 'Informe o motivo da exclusão.';
  end if;

  update public.production_orders
     set status = 'cancelled',
         is_active = false,
         completed_by_name = p_actor,
         last_status_reason = concat('Simplificada excluída por ', p_actor, ': ', btrim(p_reason))
   where import_batch_id = p_import_id
     and status in ('planned', 'released', 'in_progress', 'paused');

  update public.simplified_imports
     set is_active = false,
         production_status = 'cancelled',
         deleted_at = now(),
         deleted_by_name = p_actor,
         deletion_reason = btrim(p_reason)
   where id = p_import_id
     and deleted_at is null;

  if not found then raise exception 'Simplificada não encontrada ou já excluída.'; end if;
end;
$$;

revoke all on function public.finish_simplified_plan(uuid, text, text) from public;
revoke all on function public.archive_simplified_plan(uuid, text, text) from public;
grant execute on function public.finish_simplified_plan(uuid, text, text) to anon, authenticated;
grant execute on function public.archive_simplified_plan(uuid, text, text) to anon, authenticated;
