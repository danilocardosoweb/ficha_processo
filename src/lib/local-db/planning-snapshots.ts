import "server-only";

import { getLocalDatabase } from "@/lib/local-db/database";

export type LocalPlanningSnapshotKind = "portfolio" | "simplified";
export type LocalPlanningSnapshotView = "current" | "all";

export type LocalPlanningSnapshotSummary = {
  portfolioRows: number;
  currentPortfolioRows: number;
  currentPortfolioImportedAt: string | null;
  simplifiedImports: number;
  activeSimplifiedImports: number;
  simplifiedBaselineRows: number;
  activeSimplifiedOrders: number;
};

function count(sql: string) {
  const row = getLocalDatabase().prepare(sql).get() as { count: number };
  return Number(row.count) || 0;
}

export function getLocalPlanningSnapshotSummary(): LocalPlanningSnapshotSummary {
  const db = getLocalDatabase();
  const date = db.prepare(`
    select max(imported_at) as imported_at
    from local_portfolio_snapshots where is_current_snapshot = 1
  `).get() as { imported_at: string | null };
  return {
    portfolioRows: count("select count(*) as count from local_portfolio_snapshots"),
    currentPortfolioRows: count("select count(*) as count from local_portfolio_snapshots where is_current_snapshot = 1"),
    currentPortfolioImportedAt: date.imported_at,
    simplifiedImports: count("select count(*) as count from local_simplified_imports"),
    activeSimplifiedImports: count("select count(*) as count from local_simplified_imports where is_active = 1 and source_status = 'processed' and deleted_at is null"),
    simplifiedBaselineRows: count("select count(*) as count from local_simplified_baseline_orders"),
    activeSimplifiedOrders: count("select count(*) as count from local_simplified_baseline_orders where is_current_plan = 1"),
  };
}

export function listLocalPlanningSnapshotRecords(input: {
  kind: LocalPlanningSnapshotKind;
  view: LocalPlanningSnapshotView;
  search: string;
  page: number;
}) {
  const db = getLocalDatabase();
  const pageSize = 50;
  const offset = input.page * pageSize;
  const search = input.search.trim().replace(/[%_]/g, "");
  const pattern = `%${search}%`;

  if (input.kind === "portfolio") {
    const viewClause = input.view === "current" ? "is_current_snapshot = 1" : "1 = 1";
    const searchClause = search
      ? "and (order_number like @pattern collate nocase or order_key like @pattern collate nocase or customer_name like @pattern collate nocase or tool_code like @pattern collate nocase or product_code like @pattern collate nocase)"
      : "";
    const base = `from local_portfolio_snapshots where ${viewClause} ${searchClause}`;
    const params = search ? { pattern } : {};
    const total = Number((db.prepare(`select count(*) as count ${base}`).get(params) as { count: number }).count);
    const records = db.prepare(`
      select source_key as id, import_batch_id, imported_at, is_current_snapshot,
        source_row, order_key, order_number, customer_name, customer_order_number,
        implantation_date, due_date, scheduled_date, product_code, tool_code,
        service_unit, ordered_kg, ordered_pieces, balance_kg, balance_pieces,
        committed_kg, committed_pieces, produced_kg, produced_pieces, packed_kg,
        packed_pieces, invoiced_kg, invoiced_pieces, commercial_priority,
        alloy_code, temper, status, item_status, special_conditions
      ${base}
      order by case when due_date is null or due_date = '' then 1 else 0 end,
        due_date, source_row, order_number collate nocase
      limit @limit offset @offset
    `).all({ ...params, limit: pageSize, offset }) as Array<Record<string, unknown>>;
    return { kind: input.kind, view: input.view, page: input.page, pageSize, total, records };
  }

  const viewClause = input.view === "current" ? "is_current_plan = 1" : "1 = 1";
  const searchClause = search
    ? "and (order_number like @pattern collate nocase or plan_code like @pattern collate nocase or machine_code like @pattern collate nocase or tool_code like @pattern collate nocase or customer_name like @pattern collate nocase)"
    : "";
  const base = `from local_simplified_baseline_orders where ${viewClause} ${searchClause}`;
  const params = search ? { pattern } : {};
  const total = Number((db.prepare(`select count(*) as count ${base}`).get(params) as { count: number }).count);
  const records = db.prepare(`
    select source_key as id, source_order_id, import_batch_id, plan_code,
      machine_code, sequence_number, order_number, customer_name, tool_code,
      product_code, alloy_code, temper, due_date, demand_unit, target_kg,
      produced_kg, target_quantity, produced_quantity, status,
      source_is_active, is_current_plan, imported_at
    ${base}
    order by is_current_plan desc, machine_code collate nocase,
      sequence_number, order_number collate nocase
    limit @limit offset @offset
  `).all({ ...params, limit: pageSize, offset }) as Array<Record<string, unknown>>;
  return { kind: input.kind, view: input.view, page: input.page, pageSize, total, records };
}
