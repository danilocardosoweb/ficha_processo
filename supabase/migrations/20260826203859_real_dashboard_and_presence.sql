create index if not exists local_sessions_presence_idx
  on private.local_sessions (last_seen_at desc, user_id)
  where revoked_at is null;

create or replace function public.local_dashboard_snapshot(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
  v_machine_codes text[];
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  v_actor := private.require_local_session(p_token, false);

  select u.organization_id, u.machine_codes
    into v_org, v_machine_codes
    from private.local_users u
   where u.id = v_actor;

  return jsonb_build_object(
    'generated_at', now(),
    'kpis', jsonb_build_object(
      'production_today_kg', (
        select coalesce(sum(c.produced_kg), 0)
          from public.production_completions c
          join public.production_orders o on o.id = c.production_order_id
         where c.organization_id = v_org
           and (c.completed_at at time zone 'America/Sao_Paulo')::date = v_today
           and (coalesce(cardinality(v_machine_codes), 0) = 0 or o.machine_code = any(v_machine_codes))
      ),
      'production_yesterday_kg', (
        select coalesce(sum(c.produced_kg), 0)
          from public.production_completions c
          join public.production_orders o on o.id = c.production_order_id
         where c.organization_id = v_org
           and (c.completed_at at time zone 'America/Sao_Paulo')::date = v_today - 1
           and (coalesce(cardinality(v_machine_codes), 0) = 0 or o.machine_code = any(v_machine_codes))
      ),
      'in_progress_orders', (
        select count(*)
          from public.production_orders o
         where o.organization_id = v_org and o.is_active
           and o.status::text in ('in_progress', 'paused')
           and (coalesce(cardinality(v_machine_codes), 0) = 0 or o.machine_code = any(v_machine_codes))
      ),
      'queued_orders', (
        select count(*)
          from public.production_orders o
         where o.organization_id = v_org and o.is_active
           and o.status::text in ('planned', 'released')
           and (coalesce(cardinality(v_machine_codes), 0) = 0 or o.machine_code = any(v_machine_codes))
      ),
      'completed_today', (
        select count(distinct c.production_order_id)
          from public.production_completions c
          join public.production_orders o on o.id = c.production_order_id
         where c.organization_id = v_org
           and (c.completed_at at time zone 'America/Sao_Paulo')::date = v_today
           and (coalesce(cardinality(v_machine_codes), 0) = 0 or o.machine_code = any(v_machine_codes))
      ),
      'open_stoppages', (
        select count(*)
          from public.machine_stoppages s
         where s.organization_id = v_org and s.status = 'open'
           and (coalesce(cardinality(v_machine_codes), 0) = 0 or s.machine_code = any(v_machine_codes))
      )
    ),
    'hourly_production', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'hour', lpad(hours.hour_of_day::text, 2, '0') || 'h',
        'produced_kg', coalesce(production.total_kg, 0)
      ) order by hours.hour_of_day), '[]'::jsonb)
      from generate_series(0, 23) as hours(hour_of_day)
      left join lateral (
        select sum(c.produced_kg) as total_kg
          from public.production_completions c
          join public.production_orders o on o.id = c.production_order_id
         where c.organization_id = v_org
           and (c.completed_at at time zone 'America/Sao_Paulo')::date = v_today
           and extract(hour from c.completed_at at time zone 'America/Sao_Paulo')::integer = hours.hour_of_day
           and (coalesce(cardinality(v_machine_codes), 0) = 0 or o.machine_code = any(v_machine_codes))
      ) production on true
    ),
    'machines', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'code', m.code,
        'name', m.name,
        'status', case when stopped.id is not null then 'stopped' when running.id is not null then 'producing' else 'available' end,
        'order_number', running.order_number,
        'tool_code', running.tool_code,
        'customer_name', running.customer_name,
        'progress', case
          when running.demand_unit = 'kg' and running.target_kg > 0 then least(100, round((running.produced_kg / running.target_kg) * 100, 1))
          when running.target_quantity > 0 then least(100, round((running.produced_quantity::numeric / running.target_quantity) * 100, 1))
          else 0 end,
        'stoppage_reason', stopped.reason,
        'stoppage_started_at', stopped.started_at
      ) order by m.code), '[]'::jsonb)
        from public.machines m
        left join lateral (
          select o.id, o.order_number, o.tool_code, o.customer_name, o.demand_unit,
                 o.target_kg, o.produced_kg, o.target_quantity, o.produced_quantity
            from public.production_orders o
           where o.organization_id = v_org and o.machine_code = m.code
             and o.is_active and o.status::text = 'in_progress'
           order by o.actual_start desc nulls last, o.updated_at desc
           limit 1
        ) running on true
        left join lateral (
          select s.id, s.reason, s.started_at
            from public.machine_stoppages s
           where s.organization_id = v_org and s.machine_code = m.code and s.status = 'open'
           order by s.started_at desc
           limit 1
        ) stopped on true
       where m.organization_id = v_org and m.is_active
         and (coalesce(cardinality(v_machine_codes), 0) = 0 or m.code = any(v_machine_codes))
    ),
    'priority_orders', (
      select coalesce(jsonb_agg(to_jsonb(priority_order) order by priority_order.sort_rank, priority_order.due_date nulls last, priority_order.sequence), '[]'::jsonb)
        from (
          select o.order_number, o.plan_code, o.machine_code, o.tool_code, o.customer_name,
                 o.target_kg, o.target_quantity, o.demand_unit, o.produced_kg,
                 o.produced_quantity, o.status::text as status, o.due_date, o.sequence,
                 case o.status::text when 'in_progress' then 0 when 'paused' then 1 when 'released' then 2 else 3 end as sort_rank
            from public.production_orders o
           where o.organization_id = v_org and o.is_active
             and o.status::text in ('planned', 'released', 'in_progress', 'paused')
             and (coalesce(cardinality(v_machine_codes), 0) = 0 or o.machine_code = any(v_machine_codes))
           order by sort_rank, o.due_date nulls last, o.sequence
           limit 8
        ) priority_order
    ),
    'online_users', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', u.id,
        'display_name', u.display_name,
        'username', u.username,
        'role', u.role,
        'machine_codes', u.machine_codes,
        'last_seen_at', presence.last_seen_at
      ) order by presence.last_seen_at desc), '[]'::jsonb)
        from private.local_users u
        join lateral (
          select max(s.last_seen_at) as last_seen_at
            from private.local_sessions s
           where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()
             and s.last_seen_at >= now() - interval '2 minutes'
        ) presence on presence.last_seen_at is not null
       where u.organization_id = v_org and u.is_active
    )
  );
end;
$$;

create or replace function public.local_list_users_with_presence(p_token text)
returns table (
  id uuid, username text, email text, display_name text, role text, machine_codes text[],
  is_active boolean, must_change_password boolean, last_login_at timestamptz,
  last_seen_at timestamptz, is_online boolean,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_org uuid;
begin
  v_actor := private.require_local_session(p_token, true);
  select lu.organization_id into v_org from private.local_users lu where lu.id = v_actor;

  return query
  select u.id, u.username, u.email, u.display_name, u.role, u.machine_codes,
         u.is_active, u.must_change_password, u.last_login_at,
         presence.last_seen_at,
         coalesce(presence.last_seen_at >= now() - interval '2 minutes', false) as is_online,
         u.created_at, u.updated_at
    from private.local_users u
    left join lateral (
      select max(s.last_seen_at) as last_seen_at
        from private.local_sessions s
       where s.user_id = u.id and s.revoked_at is null and s.expires_at > now()
    ) presence on true
   where u.organization_id = v_org
   order by is_online desc, u.is_active desc, u.display_name;
end;
$$;

revoke all on function public.local_dashboard_snapshot(text) from public, anon, authenticated;
revoke all on function public.local_list_users_with_presence(text) from public, anon, authenticated;
grant execute on function public.local_dashboard_snapshot(text) to anon, authenticated;
grant execute on function public.local_list_users_with_presence(text) to anon, authenticated;
