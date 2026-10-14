import "server-only";

import { getLocalDatabase } from "@/lib/local-db/database";

export type LocalWebArchiveTable = {
  key: string;
  expectedRows: number;
  archivedRows: number;
};

export type LocalWebArchiveSummary = {
  imported: boolean;
  sourceProjectName: string | null;
  importedAt: string | null;
  archivedRows: number;
  tables: LocalWebArchiveTable[];
  integrityOk: boolean;
};

export type LocalWebArchiveRecord = {
  sourceKey: string;
  importedAt: string;
  payload: Record<string, unknown>;
};

function parseExpectedTableCounts(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>);
  const counts: Record<string, number> = {};
  for (const [key, count] of entries) {
    if (!/^(public|private)\.[a-z0-9_]+$/.test(key) || typeof count !== "number" || !Number.isInteger(count) || count < 0) continue;
    counts[key] = count;
  }
  return counts;
}

export function getLocalWebArchiveSummary(): LocalWebArchiveSummary {
  const database = getLocalDatabase();
  const importRow = database.prepare(`
    select source_project_name, imported_at, archived_rows, report_json
    from local_web_imports
    order by imported_at desc
    limit 1
  `).get() as { source_project_name: string; imported_at: string; archived_rows: number; report_json: string } | undefined;

  if (!importRow) {
    return { imported: false, sourceProjectName: null, importedAt: null, archivedRows: 0, tables: [], integrityOk: false };
  }

  let report: Record<string, unknown> = {};
  try {
    report = JSON.parse(importRow.report_json) as Record<string, unknown>;
  } catch {
    report = {};
  }
  const expected = parseExpectedTableCounts(report.expected_table_counts);
  const actualRows = database.prepare(`
    select source_schema || '.' || source_table as table_key, count(*) as row_count
    from local_web_archive_rows
    group by source_schema, source_table
  `).all() as Array<{ table_key: string; row_count: number }>;
  const actual = new Map(actualRows.map((row) => [row.table_key, Number(row.row_count)]));
  const tables = Object.entries(expected)
    .map(([key, expectedRows]) => ({ key, expectedRows, archivedRows: actual.get(key) ?? 0 }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const actualTotal = tables.reduce((total, table) => total + table.archivedRows, 0);
  const expectedTotal = tables.reduce((total, table) => total + table.expectedRows, 0);
  const integrityOk = tables.length > 0
    && tables.every((table) => table.expectedRows === table.archivedRows)
    && actualTotal === expectedTotal
    && expectedTotal === Number(report.snapshot_rows ?? expectedTotal);

  return {
    imported: true,
    sourceProjectName: importRow.source_project_name,
    importedAt: importRow.imported_at,
    archivedRows: actualTotal,
    tables,
    integrityOk,
  };
}

export function listLocalWebArchiveRecords(input: {
  tableKey: string;
  search: string;
  page: number;
  pageSize: number;
}) {
  const summary = getLocalWebArchiveSummary();
  const table = summary.tables.find((candidate) => candidate.key === input.tableKey);
  if (!table) return null;

  const [schema, tableName] = input.tableKey.split(".");
  const database = getLocalDatabase();
  const search = input.search.trim().slice(0, 100);
  const clauses = ["source_schema = ?", "source_table = ?"];
  const parameters: Array<string | number> = [schema, tableName];
  if (search) {
    clauses.push("instr(lower(payload_json), lower(?)) > 0");
    parameters.push(search);
  }
  const where = clauses.join(" and ");
  const total = Number((database.prepare(`
    select count(*) as count
    from local_web_archive_rows
    where ${where}
  `).get(...parameters) as { count: number }).count);
  const records = database.prepare(`
    select source_key, imported_at, payload_json
    from local_web_archive_rows
    where ${where}
    order by source_key
    limit ? offset ?
  `).all(...parameters, input.pageSize, input.page * input.pageSize) as Array<{
    source_key: string;
    imported_at: string;
    payload_json: string;
  }>;

  return {
    table,
    total,
    page: input.page,
    pageSize: input.pageSize,
    records: records.map((record) => ({
      sourceKey: record.source_key,
      importedAt: record.imported_at,
      payload: JSON.parse(record.payload_json) as Record<string, unknown>,
    })),
  };
}
