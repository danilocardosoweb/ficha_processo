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
  min(ph.plan_date) as first_plan_date,
  max(ph.plan_date) as last_plan_date,
  count(distinct ph.plan_code) filter (where ph.plan_code is not null) as plan_count,
  coalesce(sum(ph.planned_kg), 0) as planned_kg,
  coalesce(sum(ph.planned_pieces), 0) as planned_pieces,
  coalesce(sum(ph.fulfilled_kg), 0) as fulfilled_kg,
  coalesce(sum(ph.fulfilled_pieces), 0) as fulfilled_pieces
from public.planning_history ph
join latest_batch lb on lb.id = ph.import_batch_id
group by ph.organization_id, ph.order_key;

create or replace view public.pcp_tool_life_summary
with (security_invoker = true)
as
select
  organization_id,
  upper(matrix_code) as tool_code,
  count(*) as physical_tool_count,
  count(*) filter (where coalesce(source_available, status = 'available')) as available_tool_count,
  coalesce(sum(greatest(coalesce(remaining_kg, useful_life_kg - produced_kg, 0), 0)), 0) as remaining_life_kg,
  coalesce(sum(coalesce(useful_life_kg, 0)), 0) as useful_life_kg,
  coalesce(sum(coalesce(produced_kg, lifecycle_kg, 0)), 0) as produced_kg
from public.tools
where matrix_code is not null
group by organization_id, upper(matrix_code);

grant select on public.pcp_latest_planning_summary, public.pcp_tool_life_summary to authenticated, anon;
