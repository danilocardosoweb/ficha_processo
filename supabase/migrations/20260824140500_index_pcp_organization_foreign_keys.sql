create index if not exists order_portfolio_organization_idx
  on public.order_portfolio (organization_id);

create index if not exists planning_history_organization_idx
  on public.planning_history (organization_id);
