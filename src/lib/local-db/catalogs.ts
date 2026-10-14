import "server-only";

import { randomUUID } from "node:crypto";
import { appendLocalAuditEvent, getLocalDatabase } from "@/lib/local-db/database";

export type LocalMachineInput = {
  id?: string | null;
  code: string;
  name: string;
  capacity_tons?: number | null;
  is_active: boolean;
};

export type LocalToolInput = {
  id?: string | null;
  code: string;
  matrix_code: string;
  sequence_number: number;
  description?: string | null;
  holes?: number | null;
  theoretical_linear_weight_kg_m?: number | null;
  tool_weight_kg?: number | null;
  useful_life_kg?: number | null;
  produced_kg: number;
  status: "available" | "in_use" | "maintenance" | "inactive";
  machine_codes?: string | null;
  package_measure_mm?: number | null;
  carcass_diameter_mm?: number | null;
  carcass_code?: string | null;
};

export type LocalToolHistoryRow = {
  code: string;
  matrix_code: string;
  sequence_number: number;
  holes: number | null;
  theoretical_linear_weight_kg_m: number | null;
  useful_life_kg: number | null;
  produced_kg: number | null;
  remaining_kg: number | null;
  source_status: string | null;
  source_available: boolean;
  machine_codes: string | null;
  package_measure_mm: number | null;
  carcass_diameter_mm: number | null;
  carcass_code: string | null;
  payload: Record<string, unknown>;
};

export type LocalProcessSheetInput = {
  id?: string | null;
  machine_code: string | null;
  tool_code: string;
  product_code: string | null;
  alloy_code: string;
  temper: string | null;
  revision: number;
  tool_sequence: number | null;
  parameters: Record<string, unknown>;
  is_active: boolean;
  achieved_productivity_kg_h?: number | null;
  achieved_productivity_recorded_at?: string | null;
  copied_from_process_sheet_id?: string | null;
  copied_from_sequence?: number | null;
  source_system?: string | null;
  source_file?: string | null;
  source_row?: number | null;
};

function now() {
  return new Date().toISOString();
}

function normalizeSearch(value: string) {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
}

function mapTool(row: Record<string, unknown>) {
  return {
    ...row,
    lifecycle_kg: Number(row.produced_kg ?? 0),
    produced_kg: Number(row.produced_kg ?? 0),
    remaining_kg: row.remaining_kg === null ? null : Number(row.remaining_kg),
    source_available: row.source_available === null ? null : Boolean(row.source_available),
  };
}

function mapProcessSheet(row: Record<string, unknown>) {
  return {
    ...row,
    parameters: JSON.parse(String(row.parameters_json ?? "{}")) as Record<string, unknown>,
    is_active: Boolean(row.is_active),
    revision: Number(row.revision ?? 1),
    tool_sequence: row.tool_sequence === null ? null : Number(row.tool_sequence),
    achieved_productivity_kg_h: row.achieved_productivity_kg_h === null ? null : Number(row.achieved_productivity_kg_h),
    copied_from_sequence: row.copied_from_sequence === null ? null : Number(row.copied_from_sequence),
  };
}

function upsertLocalProcessSheet(connection: ReturnType<typeof getLocalDatabase>, input: LocalProcessSheetInput) {
  const id = input.id || randomUUID();
  const timestamp = now();
  connection.prepare(`
    insert into local_process_sheets(
      id, machine_code, tool_code, product_code, alloy_code, temper, revision, tool_sequence,
      parameters_json, is_active, achieved_productivity_kg_h, achieved_productivity_recorded_at,
      copied_from_process_sheet_id, copied_from_sequence, source_system, source_file, source_row, updated_at
    ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    on conflict(machine_code, tool_code, alloy_code, tool_sequence) do update set
      product_code = excluded.product_code, temper = excluded.temper, revision = excluded.revision,
      parameters_json = excluded.parameters_json, is_active = excluded.is_active,
      achieved_productivity_kg_h = excluded.achieved_productivity_kg_h,
      achieved_productivity_recorded_at = excluded.achieved_productivity_recorded_at,
      copied_from_process_sheet_id = excluded.copied_from_process_sheet_id,
      copied_from_sequence = excluded.copied_from_sequence, source_system = excluded.source_system,
      source_file = excluded.source_file, source_row = excluded.source_row, updated_at = excluded.updated_at
  `).run(
    id, input.machine_code, input.tool_code, input.product_code, input.alloy_code, input.temper,
    input.revision, input.tool_sequence, JSON.stringify(input.parameters ?? {}), input.is_active ? 1 : 0,
    input.achieved_productivity_kg_h ?? null, input.achieved_productivity_recorded_at ?? null,
    input.copied_from_process_sheet_id ?? null, input.copied_from_sequence ?? null,
    input.source_system ?? null, input.source_file ?? null, input.source_row ?? null, timestamp,
  );
  const saved = connection.prepare(`
    select id from local_process_sheets
    where machine_code is ? and tool_code = ? and alloy_code = ? and tool_sequence is ?
  `).get(input.machine_code, input.tool_code, input.alloy_code, input.tool_sequence) as { id: string } | undefined;
  return saved?.id ?? id;
}

export function listLocalMachines() {
  const data = getLocalDatabase().prepare(`
    select id, code, name, capacity_tons, is_active, created_at, updated_at
    from local_machines order by code collate nocase
  `).all() as Array<Record<string, unknown>>;
  return data.map((row) => ({ ...row, capacity_tons: row.capacity_tons === null ? null : Number(row.capacity_tons), is_active: Boolean(row.is_active) }));
}

export function saveLocalMachine(input: LocalMachineInput, actorUserId: string) {
  const connection = getLocalDatabase();
  const id = input.id || randomUUID();
  const timestamp = now();
  const existing = connection.prepare("select id from local_machines where id = ?").get(id);
  connection.transaction(() => {
    if (existing) {
      connection.prepare(`
        update local_machines set code = ?, name = ?, capacity_tons = ?, is_active = ?, updated_at = ? where id = ?
      `).run(input.code, input.name, input.capacity_tons ?? null, input.is_active ? 1 : 0, timestamp, id);
    } else {
      connection.prepare(`
        insert into local_machines(id, code, name, capacity_tons, is_active, created_at, updated_at)
        values (?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.code, input.name, input.capacity_tons ?? null, input.is_active ? 1 : 0, timestamp, timestamp);
    }
    appendLocalAuditEvent({ actorUserId, entityType: "machine", entityId: id, eventType: existing ? "machine_updated" : "machine_created", details: { code: input.code, name: input.name, capacity_tons: input.capacity_tons ?? null, is_active: input.is_active } });
  })();
  return id;
}

export function listLocalTools(input: { search: string; page: number; pageSize: number }) {
  const connection = getLocalDatabase();
  const token = normalizeSearch(input.search);
  const where = token ? "where matrix_search like ? or lower(cast(sequence_number as text)) like ? or lower(coalesce(machine_codes, '')) like ? or lower(status) like ?" : "";
  const params = token ? [`%${token}%`, `%${input.search.trim().toLowerCase()}%`, `%${input.search.trim().toLowerCase()}%`, `%${input.search.trim().toLowerCase()}%`] : [];
  const count = connection.prepare(`select count(*) as count from local_tools ${where}`).get(...params) as { count: number };
  const rows = connection.prepare(`
    select id, code, description, produced_kg, status, updated_at, matrix_code, sequence_number, holes,
      theoretical_linear_weight_kg_m, actual_linear_weight_kg_m, tool_weight_kg, useful_life_kg,
      remaining_kg, source_status, source_available, machine_codes, package_measure_mm,
      carcass_diameter_mm, carcass_code
    from local_tools ${where}
    order by matrix_search, sequence_number
    limit ? offset ?
  `).all(...params, input.pageSize, input.page * input.pageSize) as Array<Record<string, unknown>>;
  return { data: rows.map(mapTool), count: Number(count.count) };
}

export function saveLocalTool(input: LocalToolInput, actorUserId: string) {
  const connection = getLocalDatabase();
  const id = input.id || randomUUID();
  const timestamp = now();
  const existing = connection.prepare("select id from local_tools where id = ?").get(id);
  const matrixSearch = normalizeSearch(input.matrix_code);
  const remainingKg = input.useful_life_kg === null || input.useful_life_kg === undefined
    ? null
    : Math.max(input.useful_life_kg - input.produced_kg, 0);
  connection.transaction(() => {
    if (existing) {
      connection.prepare(`
        update local_tools set code = ?, matrix_code = ?, matrix_search = ?, sequence_number = ?, description = ?, holes = ?,
          theoretical_linear_weight_kg_m = ?, tool_weight_kg = ?, useful_life_kg = ?, produced_kg = ?, remaining_kg = ?,
          status = ?, source_available = ?, machine_codes = ?, package_measure_mm = ?, carcass_diameter_mm = ?, carcass_code = ?, updated_at = ?
        where id = ?
      `).run(
        input.code, input.matrix_code, matrixSearch, input.sequence_number, input.description ?? null, input.holes ?? null,
        input.theoretical_linear_weight_kg_m ?? null, input.tool_weight_kg ?? null, input.useful_life_kg ?? null,
        input.produced_kg, remainingKg, input.status, input.status === "available" ? 1 : 0, input.machine_codes ?? null,
        input.package_measure_mm ?? null, input.carcass_diameter_mm ?? null, input.carcass_code ?? null, timestamp, id,
      );
    } else {
      connection.prepare(`
        insert into local_tools(
          id, code, matrix_code, matrix_search, sequence_number, description, holes, theoretical_linear_weight_kg_m,
          tool_weight_kg, useful_life_kg, produced_kg, remaining_kg, status, source_available, machine_codes,
          package_measure_mm, carcass_diameter_mm, carcass_code, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.code, input.matrix_code, matrixSearch, input.sequence_number, input.description ?? null, input.holes ?? null,
        input.theoretical_linear_weight_kg_m ?? null, input.tool_weight_kg ?? null, input.useful_life_kg ?? null,
        input.produced_kg, remainingKg, input.status, input.status === "available" ? 1 : 0, input.machine_codes ?? null,
        input.package_measure_mm ?? null, input.carcass_diameter_mm ?? null, input.carcass_code ?? null, timestamp, timestamp,
      );
    }
    appendLocalAuditEvent({ actorUserId, entityType: "tool", entityId: id, eventType: existing ? "tool_updated" : "tool_created", details: { code: input.code, matrix_code: input.matrix_code, sequence_number: input.sequence_number, status: input.status } });
  })();
  return id;
}

export function stageLocalToolHistoryChunk(input: {
  fileHash: string;
  fileName: string;
  chunkIndex: number;
  totalChunks: number;
  rows: LocalToolHistoryRow[];
}, actorUserId: string) {
  const connection = getLocalDatabase();
  return connection.transaction(() => {
    const timestamp = now();
    const batch = connection.prepare("select import_type, file_name, status, expected_chunks, processed_rows from local_import_batches where file_hash = ?").get(input.fileHash) as {
      import_type: string; file_name: string; status: string; expected_chunks: number; processed_rows: number;
    } | undefined;
    if (batch?.status === "completed" && batch.import_type === "tool_history") {
      return { imported: batch.processed_rows, duplicate: true, complete: true };
    }
    if (batch && (batch.import_type !== "tool_history" || batch.expected_chunks !== input.totalChunks || batch.file_name !== input.fileName)) {
      throw new Error("Este arquivo já foi iniciado com dados diferentes. Selecione novamente o Excel original.");
    }
    if (!batch) {
      connection.prepare(`insert into local_import_batches(file_hash, import_type, file_name, status, expected_chunks, created_by, created_at)
        values (?, 'tool_history', ?, 'processing', ?, ?, ?)
      `).run(input.fileHash, input.fileName, input.totalChunks, actorUserId, timestamp);
    }
    const staged = connection.prepare("select row_count from local_import_chunks where file_hash = ? and chunk_index = ?").get(input.fileHash, input.chunkIndex) as { row_count: number } | undefined;
    if (staged && staged.row_count !== input.rows.length) throw new Error("A validação da etapa da importação não confere.");
    if (!staged) {
      connection.prepare(`insert into local_import_chunks(file_hash, chunk_index, row_count, rows_json, created_at) values (?, ?, ?, ?, ?)`)
        .run(input.fileHash, input.chunkIndex, input.rows.length, JSON.stringify(input.rows), timestamp);
    }
    const chunks = connection.prepare("select count(*) as count, coalesce(sum(row_count), 0) as rows from local_import_chunks where file_hash = ?").get(input.fileHash) as { count: number; rows: number };
    if (chunks.count < input.totalChunks) return { imported: chunks.rows, duplicate: Boolean(staged), complete: false };
    if (chunks.count > input.totalChunks) throw new Error("A importação recebeu mais etapas do que o esperado.");

    const allRows = connection.prepare("select rows_json from local_import_chunks where file_hash = ? order by chunk_index").all(input.fileHash) as Array<{ rows_json: string }>;
    const rows = allRows.flatMap((chunk) => JSON.parse(chunk.rows_json) as LocalToolHistoryRow[]);
    const upsert = connection.prepare(`
      insert into local_tools(
        id, code, matrix_code, matrix_search, sequence_number, description, holes,
        theoretical_linear_weight_kg_m, actual_linear_weight_kg_m, useful_life_kg, produced_kg,
        remaining_kg, status, source_status, source_available, machine_codes, package_measure_mm,
        carcass_diameter_mm, carcass_code, source_data_json, created_at, updated_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(code) do update set
        code = excluded.code, matrix_search = excluded.matrix_search, description = excluded.description,
        holes = excluded.holes, theoretical_linear_weight_kg_m = excluded.theoretical_linear_weight_kg_m,
        actual_linear_weight_kg_m = excluded.actual_linear_weight_kg_m, useful_life_kg = excluded.useful_life_kg,
        produced_kg = excluded.produced_kg, remaining_kg = excluded.remaining_kg, status = excluded.status,
        source_status = excluded.source_status, source_available = excluded.source_available,
        machine_codes = excluded.machine_codes, package_measure_mm = excluded.package_measure_mm,
        carcass_diameter_mm = excluded.carcass_diameter_mm, carcass_code = excluded.carcass_code,
        source_data_json = excluded.source_data_json, updated_at = excluded.updated_at
    `);
    for (const row of rows) {
      const value = row.payload;
      const code = String(value.code ?? row.code);
      const matrixCode = String(value.matrix_code ?? row.matrix_code).trim().toUpperCase();
      const sequence = Number(value.sequence_number ?? row.sequence_number);
      const produced = Number(value.produced_kg ?? row.produced_kg ?? 0);
      const usefulLife = value.useful_life_kg == null ? row.useful_life_kg : Number(value.useful_life_kg);
      const sourceAvailable = Boolean(value.source_available ?? row.source_available);
      upsert.run(
        randomUUID(), code, matrixCode, normalizeSearch(matrixCode), sequence,
        String(value.description ?? `Matriz ${matrixCode} · Seq. ${sequence}`),
        value.holes == null ? row.holes : Number(value.holes),
        value.theoretical_linear_weight_kg_m == null ? row.theoretical_linear_weight_kg_m : Number(value.theoretical_linear_weight_kg_m),
        value.actual_linear_weight_kg_m == null ? null : Number(value.actual_linear_weight_kg_m),
        usefulLife, produced, value.remaining_kg == null ? row.remaining_kg : Number(value.remaining_kg),
        sourceAvailable ? "available" : "inactive", row.source_status, sourceAvailable ? 1 : 0,
        row.machine_codes, row.package_measure_mm, row.carcass_diameter_mm, row.carcass_code,
        JSON.stringify(value), timestamp, timestamp,
      );
    }
    connection.prepare("update local_import_batches set status = 'completed', processed_rows = ?, completed_at = ? where file_hash = ?")
      .run(rows.length, timestamp, input.fileHash);
    connection.prepare("delete from local_import_chunks where file_hash = ?").run(input.fileHash);
    appendLocalAuditEvent({ actorUserId, entityType: "tool_catalog", entityId: input.fileHash, eventType: "tool_history_imported", details: { file_name: input.fileName, file_hash: input.fileHash, rows: rows.length } });
    return { imported: rows.length, duplicate: Boolean(staged), complete: true };
  })();
}

export function listLocalProcessSheets(input: { search: string; machine: string; cutMm: number | null; page: number; pageSize: number }) {
  const connection = getLocalDatabase();
  const clauses = ["product_code is not null", "product_code <> ''"];
  const params: (string | number)[] = [];
  if (input.machine) { clauses.push("machine_code = ?"); params.push(input.machine); }
  if (input.search) {
    const like = `%${normalizeSearch(input.search)}%`;
    clauses.push("(replace(lower(coalesce(product_code, tool_code)), '-', '') like ? or replace(lower(tool_code), '-', '') like ? or lower(coalesce(machine_code, '')) like ? or lower(alloy_code) like ?)");
    params.push(like, like, `%${input.search.toLowerCase()}%`, `%${input.search.toLowerCase()}%`);
  }
  if (input.cutMm !== null) {
    clauses.push("(json_extract(parameters_json, '$.extrusion.cut_length_mm') = ? or json_extract(parameters_json, '$.extrusion.cut_length_m') * 1000 = ? or json_extract(parameters_json, '$.saw.piece_length_mm') = ?)");
    params.push(input.cutMm, input.cutMm, input.cutMm);
  }
  const where = `where ${clauses.join(" and ")}`;
  const count = connection.prepare(`select count(*) as count from local_process_sheets ${where}`).get(...params) as { count: number };
  const rows = connection.prepare(`select * from local_process_sheets ${where} order by product_code, tool_code, machine_code limit ? offset ?`)
    .all(...params, input.pageSize, input.page * input.pageSize) as Array<Record<string, unknown>>;
  return { data: rows.map(mapProcessSheet), count: Number(count.count) };
}

export function listLocalProcessSheetTemplates() {
  const rows = getLocalDatabase().prepare("select * from local_process_sheets where is_active = 1 order by updated_at desc limit 250").all() as Array<Record<string, unknown>>;
  return rows.map(mapProcessSheet);
}

export function saveLocalProcessSheet(input: LocalProcessSheetInput, actorUserId: string, newSequence = false) {
  const connection = getLocalDatabase();
  const currentId = input.id && !newSequence ? input.id : null;
  const id = currentId ?? randomUUID();
  const existing = currentId ? connection.prepare("select id from local_process_sheets where id = ?").get(currentId) : null;
  const timestamp = now();
  connection.transaction(() => {
    if (existing) {
      connection.prepare(`update local_process_sheets set machine_code = ?, tool_code = ?, product_code = ?, alloy_code = ?, temper = ?, revision = ?, tool_sequence = ?, parameters_json = ?, is_active = ?, updated_at = ? where id = ?`)
        .run(input.machine_code, input.tool_code, input.product_code, input.alloy_code, input.temper, input.revision, input.tool_sequence, JSON.stringify(input.parameters), input.is_active ? 1 : 0, timestamp, id);
    } else {
      connection.prepare(`insert into local_process_sheets(id, machine_code, tool_code, product_code, alloy_code, temper, revision, tool_sequence, parameters_json, is_active, copied_from_process_sheet_id, copied_from_sequence, updated_at)
        values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, input.machine_code, input.tool_code, input.product_code, input.alloy_code, input.temper, input.revision, input.tool_sequence, JSON.stringify(input.parameters), input.is_active ? 1 : 0, input.copied_from_process_sheet_id ?? null, input.copied_from_sequence ?? null, timestamp);
    }
    appendLocalAuditEvent({ actorUserId, entityType: "process_sheet", entityId: id, eventType: existing ? "process_sheet_updated" : "process_sheet_created", details: { machine_code: input.machine_code, tool_code: input.tool_code, alloy_code: input.alloy_code, tool_sequence: input.tool_sequence } });
  })();
  return id;
}

export function importLocalProcessSheets(input: { fileHash: string; fileName: string; rows: LocalProcessSheetInput[] }, actorUserId: string) {
  const connection = getLocalDatabase();
  return connection.transaction(() => {
    const existing = connection.prepare("select import_type, status, processed_rows from local_import_batches where file_hash = ?").get(input.fileHash) as { import_type: string; status: string; processed_rows: number } | undefined;
    if (existing?.status === "completed" && existing.import_type === "process_sheets") return { imported: existing.processed_rows, duplicate: true };
    if (existing) throw new Error("A importação deste arquivo está incompleta. Reimporte o Excel para continuar.");
    const timestamp = now();
    connection.prepare(`insert into local_import_batches(file_hash, import_type, file_name, status, expected_chunks, created_by, created_at)
      values (?, 'process_sheets', ?, 'processing', 1, ?, ?)
    `).run(input.fileHash, input.fileName, actorUserId, timestamp);
    for (const row of input.rows) upsertLocalProcessSheet(connection, row);
    connection.prepare("update local_import_batches set status = 'completed', processed_rows = ?, completed_at = ? where file_hash = ?")
      .run(input.rows.length, now(), input.fileHash);
    appendLocalAuditEvent({ actorUserId, entityType: "process_sheets", entityId: input.fileHash, eventType: "process_sheets_imported", details: { file_name: input.fileName, file_hash: input.fileHash, rows: input.rows.length } });
    return { imported: input.rows.length, duplicate: false };
  })();
}

export function upsertImportedLocalProcessSheets(rows: LocalProcessSheetInput[], actorUserId: string) {
  const connection = getLocalDatabase();
  connection.transaction(() => {
    for (const row of rows) upsertLocalProcessSheet(connection, row);
    appendLocalAuditEvent({ actorUserId, entityType: "process_sheets", eventType: "process_sheets_imported", details: { rows: rows.length } });
  })();
  return rows.length;
}
