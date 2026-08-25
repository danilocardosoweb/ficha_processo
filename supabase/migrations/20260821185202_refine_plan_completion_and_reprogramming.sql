create or replace function private.sync_simplified_production_status()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  pending_count integer;
  started_count integer;
begin
  if new.import_batch_id is null then return new; end if;

  select
    count(*) filter (
      where po.is_active = true
        and po.status not in ('completed', 'cancelled')
    ),
    count(*) filter (where po.status in ('in_progress', 'paused', 'completed'))
  into pending_count, started_count
  from public.production_orders po
  where po.import_batch_id = new.import_batch_id;

  if pending_count = 0 then
    update public.simplified_imports
       set production_status = 'completed',
           production_completed_at = coalesce(production_completed_at, now()),
           production_completed_by_name = coalesce(new.completed_by_name, new.started_by_name, 'Sistema'),
           is_active = false
     where id = new.import_batch_id;
  elsif started_count > 0 then
    update public.simplified_imports
       set production_status = 'in_progress',
           production_started_at = coalesce(production_started_at, now()),
           production_completed_at = null,
           production_completed_by_name = null
     where id = new.import_batch_id;
  else
    update public.simplified_imports
       set production_status = 'queued',
           production_completed_at = null,
           production_completed_by_name = null
     where id = new.import_batch_id;
  end if;
  return new;
end;
$$;

create or replace function private.guard_production_order_transition()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    if not (
      (old.status in ('planned', 'released', 'paused') and new.status in ('in_progress', 'cancelled'))
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
      new.actual_end := coalesce(new.actual_end, now());
      new.is_active := false;
    elsif old.status = 'completed' and new.status = 'planned' then
      if new.import_batch_id is not null and not exists (
        select 1 from public.simplified_imports si
         where si.id = new.import_batch_id and si.status = 'processed'
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
