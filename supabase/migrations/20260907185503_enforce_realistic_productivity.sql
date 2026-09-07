-- Produtividade de extrusão fisicamente plausível para este processo.
-- Valores inválidos são removidos, não substituídos por 1.300, para não
-- transformar uma medição incorreta em um dado histórico aparentemente real.

-- Preserve the original records before removing invalid numeric measurements.
create table if not exists private.productivity_review_archive (
  id bigint generated always as identity primary key,
  source_table text not null,
  record_data jsonb not null,
  captured_at timestamptz not null default now()
);
alter table private.productivity_review_archive enable row level security;
revoke all on private.productivity_review_archive from public, anon, authenticated;

create or replace function private.guard_realistic_productivity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_data jsonb := to_jsonb(new);
  v_column text;
  v_invalid boolean := false;
begin
  foreach v_column in array tg_argv loop
    if v_data ->> v_column is not null
       and not ((v_data ->> v_column)::numeric > 0 and (v_data ->> v_column)::numeric <= 2500) then
      v_invalid := true;
      v_data := jsonb_set(v_data, array[v_column],
        case when v_column = 'default_productivity_kg_h' then '1300'::jsonb else 'null'::jsonb end);
    end if;
  end loop;
  if v_invalid then
    insert into private.productivity_review_archive(source_table, record_data)
    values (tg_table_name, to_jsonb(new));
    new := jsonb_populate_record(new, v_data);
  end if;
  return new;
end;
$$;
revoke all on function private.guard_realistic_productivity() from public, anon, authenticated;

do $$
declare v_table text; v_columns text; v_condition text;
begin
  for v_table, v_columns, v_condition in
    select * from (values
      ('production_orders', '''last_productivity_kg_h'', ''achieved_productivity_kg_h''', 'last_productivity_kg_h <= 0 or last_productivity_kg_h > 2500 or achieved_productivity_kg_h <= 0 or achieved_productivity_kg_h > 2500'),
      ('process_sheets', '''achieved_productivity_kg_h''', 'achieved_productivity_kg_h <= 0 or achieved_productivity_kg_h > 2500'),
      ('production_execution_history', '''achieved_productivity_kg_h''', 'achieved_productivity_kg_h <= 0 or achieved_productivity_kg_h > 2500'),
      ('external_production_records', '''achieved_productivity_kg_h''', 'achieved_productivity_kg_h <= 0 or achieved_productivity_kg_h > 2500'),
      ('machine_load_settings', '''default_productivity_kg_h''', 'default_productivity_kg_h <= 0 or default_productivity_kg_h > 2500'),
      ('planning_learning_observations', '''predicted_productivity_kg_h'', ''actual_productivity_kg_h''', 'predicted_productivity_kg_h <= 0 or predicted_productivity_kg_h > 2500 or actual_productivity_kg_h <= 0 or actual_productivity_kg_h > 2500')
    ) as targets(table_name, columns_list, invalid_condition)
  loop
    execute format('insert into private.productivity_review_archive(source_table, record_data) select %L, to_jsonb(t) from public.%I t where %s', v_table, v_table, v_condition);
    execute format('create trigger guard_realistic_productivity before insert or update on public.%I for each row execute function private.guard_realistic_productivity(%s)', v_table, v_columns);
  end loop;
end;
$$;

update public.production_orders
set last_productivity_kg_h = null
where last_productivity_kg_h is not null
  and (last_productivity_kg_h <= 0 or last_productivity_kg_h > 2500);

update public.production_orders
set achieved_productivity_kg_h = null
where achieved_productivity_kg_h is not null
  and (achieved_productivity_kg_h <= 0 or achieved_productivity_kg_h > 2500);

update public.process_sheets
set achieved_productivity_kg_h = null,
    achieved_productivity_recorded_at = null
where achieved_productivity_kg_h is not null
  and (achieved_productivity_kg_h <= 0 or achieved_productivity_kg_h > 2500);

update public.production_execution_history
set achieved_productivity_kg_h = null
where achieved_productivity_kg_h is not null
  and (achieved_productivity_kg_h <= 0 or achieved_productivity_kg_h > 2500);

update public.external_production_records
set achieved_productivity_kg_h = null
where achieved_productivity_kg_h is not null
  and (achieved_productivity_kg_h <= 0 or achieved_productivity_kg_h > 2500);

delete from public.planning_learning_observations
where actual_productivity_kg_h is null
   or (actual_productivity_kg_h is not null and (actual_productivity_kg_h <= 0 or actual_productivity_kg_h > 2500))
   or (predicted_productivity_kg_h is not null and (predicted_productivity_kg_h <= 0 or predicted_productivity_kg_h > 2500));

update public.machine_load_settings
set default_productivity_kg_h = 1300
where default_productivity_kg_h is null
   or default_productivity_kg_h <= 0
   or default_productivity_kg_h > 2500;

alter table public.machine_load_settings alter column default_productivity_kg_h set default 1300;

alter table public.production_orders drop constraint if exists production_orders_last_productivity_positive;
alter table public.production_orders drop constraint if exists production_orders_last_productivity_realistic;
alter table public.production_orders add constraint production_orders_last_productivity_realistic
  check (last_productivity_kg_h is null or last_productivity_kg_h between 0.001 and 2500);
alter table public.production_orders drop constraint if exists production_orders_achieved_productivity_realistic;
alter table public.production_orders add constraint production_orders_achieved_productivity_realistic
  check (achieved_productivity_kg_h is null or achieved_productivity_kg_h between 0.001 and 2500);

alter table public.machine_load_settings drop constraint if exists machine_load_settings_default_productivity_realistic;
alter table public.machine_load_settings add constraint machine_load_settings_default_productivity_realistic
  check (default_productivity_kg_h between 0.001 and 2500);

alter table public.process_sheets drop constraint if exists process_sheets_achieved_productivity_realistic;
alter table public.process_sheets add constraint process_sheets_achieved_productivity_realistic
  check (achieved_productivity_kg_h is null or achieved_productivity_kg_h between 0.001 and 2500);

alter table public.production_execution_history drop constraint if exists production_execution_history_productivity_realistic;
alter table public.production_execution_history add constraint production_execution_history_productivity_realistic
  check (achieved_productivity_kg_h is null or achieved_productivity_kg_h between 0.001 and 2500);

alter table public.external_production_records drop constraint if exists external_production_records_productivity_realistic;
alter table public.external_production_records add constraint external_production_records_productivity_realistic
  check (achieved_productivity_kg_h is null or achieved_productivity_kg_h between 0.001 and 2500);

alter table public.planning_learning_observations drop constraint if exists planning_learning_predicted_productivity_realistic;
alter table public.planning_learning_observations add constraint planning_learning_predicted_productivity_realistic
  check (predicted_productivity_kg_h is null or predicted_productivity_kg_h between 0.001 and 2500);
alter table public.planning_learning_observations drop constraint if exists planning_learning_actual_productivity_realistic;
alter table public.planning_learning_observations add constraint planning_learning_actual_productivity_realistic
  check (actual_productivity_kg_h is null or actual_productivity_kg_h between 0.001 and 2500);

create or replace function public.capture_planning_learning_observation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_version_id uuid; v_prediction jsonb; v_predicted_productivity numeric;
  v_actual_productivity numeric; v_predicted_duration numeric; v_actual_duration numeric;
begin
  if new.achieved_productivity_kg_h is null
     or new.achieved_productivity_kg_h <= 0 or new.achieved_productivity_kg_h > 2500 then
    return new;
  end if;
  select v.id, item.value into v_version_id, v_prediction
  from public.simulation_scenarios s
  join public.simulation_versions v on v.scenario_id = s.id
  cross join lateral jsonb_array_elements(coalesce(v.result_snapshot -> 'machines', '[]'::jsonb)) machine
  cross join lateral jsonb_array_elements(coalesce(machine.value -> 'items', '[]'::jsonb)) item
  where s.organization_id = new.organization_id and s.status = 'approved'
    and item.value ->> 'id' = new.production_order_id::text
  order by s.approved_at desc nulls last, v.version_number desc limit 1;

  v_predicted_productivity := nullif(v_prediction ->> 'productivityKgH', '')::numeric;
  if v_predicted_productivity is not null and (v_predicted_productivity <= 0 or v_predicted_productivity > 2500) then
    v_predicted_productivity := null;
  end if;
  v_actual_productivity := new.achieved_productivity_kg_h;
  if v_actual_productivity is not null and (v_actual_productivity <= 0 or v_actual_productivity > 2500) then
    v_actual_productivity := null;
  end if;
  if nullif(v_prediction ->> 'startAt', '') is not null and nullif(v_prediction ->> 'endAt', '') is not null then
    v_predicted_duration := extract(epoch from ((v_prediction ->> 'endAt')::timestamptz - (v_prediction ->> 'startAt')::timestamptz)) / 60.0;
  end if;
  if new.started_at is not null and new.completed_at > new.started_at then
    v_actual_duration := extract(epoch from (new.completed_at - new.started_at)) / 60.0;
  end if;

  insert into public.planning_learning_observations (
    organization_id, execution_history_id, simulation_version_id, production_order_id,
    process_sheet_id, machine_code, tool_code, tool_sequence,
    predicted_productivity_kg_h, actual_productivity_kg_h,
    predicted_duration_minutes, actual_duration_minutes,
    productivity_error_percent, duration_error_percent,
    prediction_snapshot, actual_snapshot, observed_at
  ) values (
    new.organization_id, new.id, v_version_id, new.production_order_id,
    new.process_sheet_id, new.machine_code, new.tool_code, new.tool_sequence,
    v_predicted_productivity, v_actual_productivity,
    v_predicted_duration, v_actual_duration,
    case when v_predicted_productivity > 0 and v_actual_productivity is not null
      then round(((v_actual_productivity - v_predicted_productivity) / v_predicted_productivity * 100)::numeric, 4) end,
    case when v_predicted_duration > 0 and v_actual_duration is not null
      then round(((v_actual_duration - v_predicted_duration) / v_predicted_duration * 100)::numeric, 4) end,
    coalesce(v_prediction, '{}'::jsonb), to_jsonb(new), new.completed_at
  ) on conflict (execution_history_id) do update set
    simulation_version_id = excluded.simulation_version_id,
    predicted_productivity_kg_h = excluded.predicted_productivity_kg_h,
    actual_productivity_kg_h = excluded.actual_productivity_kg_h,
    predicted_duration_minutes = excluded.predicted_duration_minutes,
    actual_duration_minutes = excluded.actual_duration_minutes,
    productivity_error_percent = excluded.productivity_error_percent,
    duration_error_percent = excluded.duration_error_percent,
    prediction_snapshot = excluded.prediction_snapshot,
    actual_snapshot = excluded.actual_snapshot,
    observed_at = excluded.observed_at;
  return new;
end;
$$;
