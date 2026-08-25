create or replace view public.pcp_latest_planning_summary
with (security_invoker = true)
as
with latest_batch as (
  select distinct on (organization_id) id, organization_id
  from public.pcp_import_batches
  where import_type = 'planning_history' and status = 'processed'
  order by organization_id, imported_at desc
)
select
  ph.organization_id,
  ph.order_key,
  max(ph.order_number) as order_number,
  max(ph.customer_name) as customer_name,
  max(ph.product_code) as product_code,
  min(ph.programming_date) as first_programming_date,
  max(ph.programming_date) as last_programming_date,
  min(ph.plan_date) filter (where ph.plan_code is not null) as first_plan_date,
  max(ph.plan_date) filter (where ph.plan_code is not null) as last_plan_date,
  count(distinct ph.plan_code) filter (
    where nullif(btrim(ph.plan_code), '') is not null
  ) as plan_count,
  coalesce(sum(ph.planned_kg) filter (where ph.plan_code is not null), 0) as planned_kg,
  coalesce(sum(ph.planned_pieces) filter (where ph.plan_code is not null), 0) as planned_pieces,
  coalesce(sum(ph.fulfilled_kg) filter (where ph.lot_number is not null), 0) as fulfilled_kg,
  coalesce(sum(ph.fulfilled_pieces) filter (where ph.lot_number is not null), 0) as fulfilled_pieces,
  count(distinct ph.lot_number) filter (
    where nullif(btrim(ph.lot_number), '') is not null
  ) as lot_count
from public.planning_history ph
join latest_batch lb on lb.id = ph.import_batch_id
group by ph.organization_id, ph.order_key;

grant select on public.pcp_latest_planning_summary to authenticated, anon;
