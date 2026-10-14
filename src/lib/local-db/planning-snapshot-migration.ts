import "server-only";

import type Database from "better-sqlite3";

type ArchiveRow = { source_key: string; payload_json: string; imported_at: string };
type ArchivedRecord = Record<string, unknown>;

function text(value: unknown) {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function numeric(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function archivedRecords(connection: Database.Database, table: string) {
  const rows = connection.prepare(`
    select source_key, payload_json, imported_at
    from local_web_archive_rows
    where source_schema = 'public' and source_table = ?
    order by source_key
  `).all(table) as ArchiveRow[];
  return rows.map((row) => ({
    sourceKey: row.source_key,
    importedAt: row.imported_at,
    payload: JSON.parse(row.payload_json) as ArchivedRecord,
  }));
}

export function migrateLocalPlanningSnapshots(connection: Database.Database) {
  connection.exec(`
    create table if not exists local_portfolio_snapshots (
      source_key text primary key,
      source_row_id text,
      import_batch_id text,
      imported_at text not null,
      is_current_snapshot integer not null default 0 check (is_current_snapshot in (0, 1)),
      source_row integer,
      order_key text,
      order_number text,
      customer_name text,
      customer_order_number text,
      implantation_date text,
      due_date text,
      scheduled_date text,
      product_code text,
      tool_code text,
      service_unit text,
      ordered_kg real not null default 0,
      ordered_pieces real not null default 0,
      balance_kg real not null default 0,
      balance_pieces real not null default 0,
      committed_kg real not null default 0,
      committed_pieces real not null default 0,
      produced_kg real not null default 0,
      produced_pieces real not null default 0,
      packed_kg real not null default 0,
      packed_pieces real not null default 0,
      invoiced_kg real not null default 0,
      invoiced_pieces real not null default 0,
      commercial_priority integer,
      alloy_code text,
      temper text,
      status text,
      item_status text,
      special_conditions text,
      source_data_json text not null
    );
    create index if not exists local_portfolio_current_due_idx
      on local_portfolio_snapshots(is_current_snapshot, due_date, source_row);
    create index if not exists local_portfolio_order_key_idx
      on local_portfolio_snapshots(order_key);

    create table if not exists local_simplified_imports (
      source_id text primary key,
      plan_code text,
      machine_code text,
      file_name text,
      file_hash text,
      source_status text,
      production_status text,
      is_active integer not null default 0 check (is_active in (0, 1)),
      row_count integer not null default 0,
      created_at text,
      processed_at text,
      deleted_at text,
      source_data_json text not null
    );
    create index if not exists local_simplified_imports_active_idx
      on local_simplified_imports(is_active, processed_at desc);

    create table if not exists local_simplified_baseline_orders (
      source_key text primary key,
      source_order_id text,
      import_batch_id text,
      plan_code text,
      machine_code text,
      sequence_number integer not null default 0,
      order_number text,
      customer_name text,
      tool_code text,
      product_code text,
      alloy_code text,
      temper text,
      due_date text,
      demand_unit text,
      target_kg real not null default 0,
      produced_kg real not null default 0,
      target_quantity real,
      produced_quantity real not null default 0,
      status text,
      source_is_active integer not null default 0 check (source_is_active in (0, 1)),
      is_current_plan integer not null default 0 check (is_current_plan in (0, 1)),
      imported_at text not null,
      source_data_json text not null
    );
    create index if not exists local_simplified_current_sequence_idx
      on local_simplified_baseline_orders(is_current_plan, machine_code, sequence_number);
    create index if not exists local_simplified_import_batch_idx
      on local_simplified_baseline_orders(import_batch_id);

    create trigger if not exists local_portfolio_snapshots_no_update
      before update on local_portfolio_snapshots
      begin select raise(abort, 'Snapshots da carteira importada são imutáveis.'); end;
    create trigger if not exists local_portfolio_snapshots_no_delete
      before delete on local_portfolio_snapshots
      begin select raise(abort, 'Snapshots da carteira importada são imutáveis.'); end;
    create trigger if not exists local_simplified_baseline_no_update
      before update on local_simplified_baseline_orders
      begin select raise(abort, 'A Simplificada importada é um baseline imutável.'); end;
    create trigger if not exists local_simplified_baseline_no_delete
      before delete on local_simplified_baseline_orders
      begin select raise(abort, 'A Simplificada importada é um baseline imutável.'); end;
  `);

  const importRecords = archivedRecords(connection, "simplified_imports");
  const importsById = new Map<string, ArchivedRecord>();
  const insertImport = connection.prepare(`
    insert or ignore into local_simplified_imports (
      source_id, plan_code, machine_code, file_name, file_hash, source_status,
      production_status, is_active, row_count, created_at, processed_at, deleted_at,
      source_data_json
    ) values (
      @source_id, @plan_code, @machine_code, @file_name, @file_hash, @source_status,
      @production_status, @is_active, @row_count, @created_at, @processed_at, @deleted_at,
      @source_data_json
    )
  `);
  for (const { sourceKey, payload } of importRecords) {
    const id = text(payload.id) ?? sourceKey;
    importsById.set(id, payload);
    insertImport.run({
      source_id: id,
      plan_code: text(payload.plan_code),
      machine_code: text(payload.machine_code),
      file_name: text(payload.file_name),
      file_hash: text(payload.file_hash),
      source_status: text(payload.status),
      production_status: text(payload.production_status),
      is_active: payload.is_active === true ? 1 : 0,
      row_count: numeric(payload.row_count) ?? 0,
      created_at: text(payload.created_at),
      processed_at: text(payload.processed_at),
      deleted_at: text(payload.deleted_at),
      source_data_json: JSON.stringify(payload),
    });
  }

  const batchRecords = archivedRecords(connection, "pcp_import_batches")
    .map(({ payload }) => payload)
    .filter((record) => record.import_type === "order_portfolio" && record.status === "processed")
    .sort((left, right) => String(right.imported_at ?? "").localeCompare(String(left.imported_at ?? "")));
  const currentPortfolioBatchId = text(batchRecords[0]?.id);
  const batchImportedAt = new Map(batchRecords.map((record) => [String(record.id), text(record.imported_at)]));
  const insertPortfolio = connection.prepare(`
    insert or ignore into local_portfolio_snapshots (
      source_key, source_row_id, import_batch_id, imported_at, is_current_snapshot,
      source_row, order_key, order_number, customer_name, customer_order_number,
      implantation_date, due_date, scheduled_date, product_code, tool_code,
      service_unit, ordered_kg, ordered_pieces, balance_kg, balance_pieces,
      committed_kg, committed_pieces, produced_kg, produced_pieces, packed_kg,
      packed_pieces, invoiced_kg, invoiced_pieces, commercial_priority,
      alloy_code, temper, status, item_status, special_conditions, source_data_json
    ) values (
      @source_key, @source_row_id, @import_batch_id, @imported_at, @is_current_snapshot,
      @source_row, @order_key, @order_number, @customer_name, @customer_order_number,
      @implantation_date, @due_date, @scheduled_date, @product_code, @tool_code,
      @service_unit, @ordered_kg, @ordered_pieces, @balance_kg, @balance_pieces,
      @committed_kg, @committed_pieces, @produced_kg, @produced_pieces, @packed_kg,
      @packed_pieces, @invoiced_kg, @invoiced_pieces, @commercial_priority,
      @alloy_code, @temper, @status, @item_status, @special_conditions, @source_data_json
    )
  `);
  for (const { sourceKey, importedAt, payload } of archivedRecords(connection, "order_portfolio")) {
    const batchId = text(payload.import_batch_id);
    insertPortfolio.run({
      source_key: sourceKey,
      source_row_id: text(payload.id),
      import_batch_id: batchId,
      imported_at: (batchId && batchImportedAt.get(batchId)) || importedAt,
      is_current_snapshot: batchId && batchId === currentPortfolioBatchId ? 1 : 0,
      source_row: numeric(payload.source_row),
      order_key: text(payload.order_key),
      order_number: text(payload.order_number),
      customer_name: text(payload.customer_name),
      customer_order_number: text(payload.customer_order_number),
      implantation_date: text(payload.implantation_date),
      due_date: text(payload.due_date),
      scheduled_date: text(payload.scheduled_date),
      product_code: text(payload.product_code),
      tool_code: text(payload.tool_code),
      service_unit: text(payload.service_unit),
      ordered_kg: numeric(payload.ordered_kg) ?? 0,
      ordered_pieces: numeric(payload.ordered_pieces) ?? 0,
      balance_kg: numeric(payload.balance_kg) ?? 0,
      balance_pieces: numeric(payload.balance_pieces) ?? 0,
      committed_kg: numeric(payload.committed_kg) ?? 0,
      committed_pieces: numeric(payload.committed_pieces) ?? 0,
      produced_kg: numeric(payload.produced_kg) ?? 0,
      produced_pieces: numeric(payload.produced_pieces) ?? 0,
      packed_kg: numeric(payload.packed_kg) ?? 0,
      packed_pieces: numeric(payload.packed_pieces) ?? 0,
      invoiced_kg: numeric(payload.invoiced_kg) ?? 0,
      invoiced_pieces: numeric(payload.invoiced_pieces) ?? 0,
      commercial_priority: numeric(payload.priority),
      alloy_code: text(payload.alloy_code),
      temper: text(payload.temper),
      status: text(payload.status),
      item_status: text(payload.item_status),
      special_conditions: text(payload.special_conditions),
      source_data_json: JSON.stringify(payload),
    });
  }

  const insertBaseline = connection.prepare(`
    insert or ignore into local_simplified_baseline_orders (
      source_key, source_order_id, import_batch_id, plan_code, machine_code,
      sequence_number, order_number, customer_name, tool_code, product_code,
      alloy_code, temper, due_date, demand_unit, target_kg, produced_kg,
      target_quantity, produced_quantity, status, source_is_active, is_current_plan,
      imported_at, source_data_json
    ) values (
      @source_key, @source_order_id, @import_batch_id, @plan_code, @machine_code,
      @sequence_number, @order_number, @customer_name, @tool_code, @product_code,
      @alloy_code, @temper, @due_date, @demand_unit, @target_kg, @produced_kg,
      @target_quantity, @produced_quantity, @status, @source_is_active, @is_current_plan,
      @imported_at, @source_data_json
    )
  `);
  for (const { sourceKey, importedAt, payload } of archivedRecords(connection, "production_orders")) {
    const importBatchId = text(payload.import_batch_id);
    const sourceImport = importBatchId ? importsById.get(importBatchId) : undefined;
    const activeImport = sourceImport?.is_active === true
      && sourceImport?.status === "processed"
      && !sourceImport?.deleted_at;
    const activeOrder = payload.is_active === true
      && ["planned", "released", "in_progress", "paused"].includes(String(payload.status));
    insertBaseline.run({
      source_key: sourceKey,
      source_order_id: text(payload.id),
      import_batch_id: importBatchId,
      plan_code: text(payload.plan_code),
      machine_code: text(payload.machine_code),
      sequence_number: numeric(payload.sequence) ?? 0,
      order_number: text(payload.order_number),
      customer_name: text(payload.customer_name),
      tool_code: text(payload.tool_code),
      product_code: text(payload.product_code),
      alloy_code: text(payload.alloy_code),
      temper: text(payload.temper),
      due_date: text(payload.due_date),
      demand_unit: text(payload.demand_unit),
      target_kg: numeric(payload.target_kg) ?? 0,
      produced_kg: numeric(payload.produced_kg) ?? 0,
      target_quantity: numeric(payload.target_quantity),
      produced_quantity: numeric(payload.produced_quantity) ?? 0,
      status: text(payload.status),
      source_is_active: payload.is_active === true ? 1 : 0,
      is_current_plan: activeImport && activeOrder ? 1 : 0,
      imported_at: importedAt,
      source_data_json: JSON.stringify(payload),
    });
  }
}
