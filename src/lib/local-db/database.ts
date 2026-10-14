import "server-only";

import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { migrateLocalPlanningSnapshots } from "@/lib/local-db/planning-snapshot-migration";

type LocalMigration = {
  version: string;
  sql?: string;
  apply?: (connection: Database.Database) => void;
};

const localMigrations: LocalMigration[] = [
  {
    version: "0001_local_foundation",
    sql: `
      create table if not exists local_migrations (
        version text primary key,
        applied_at text not null
      );

      create table if not exists local_users (
        id text primary key,
        organization_id text not null,
        username text not null collate nocase unique,
        email text collate nocase unique,
        display_name text not null,
        password_hash text not null,
        role text not null check (role in ('admin','manager','pcp','operator','engineering','maintenance','quality','viewer')),
        machine_codes_json text not null default '[]',
        access_overrides_json text not null default '{}',
        is_active integer not null default 1 check (is_active in (0, 1)),
        must_change_password integer not null default 0 check (must_change_password in (0, 1)),
        failed_login_attempts integer not null default 0,
        locked_until text,
        last_login_at text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists local_sessions (
        id text primary key,
        user_id text not null references local_users(id) on delete cascade,
        token_hash text not null unique,
        expires_at text not null,
        created_at text not null,
        last_seen_at text not null,
        revoked_at text,
        user_agent text
      );
      create index if not exists local_sessions_active_lookup_idx on local_sessions(token_hash, expires_at) where revoked_at is null;

      create table if not exists local_audit_events (
        id text primary key,
        occurred_at text not null,
        actor_user_id text references local_users(id),
        entity_type text not null,
        entity_id text,
        event_type text not null,
        details_json text not null default '{}'
      );
      create index if not exists local_audit_events_timeline_idx on local_audit_events(occurred_at desc, entity_type, entity_id);

      create table if not exists local_app_settings (
        key text primary key,
        value_json text not null,
        updated_at text not null
      );
    `,
  },
  {
    version: "0002_local_machine_and_tool_catalogs",
    sql: `
      create table if not exists local_machines (
        id text primary key,
        code text not null collate nocase unique,
        name text not null,
        capacity_tons integer check (capacity_tons is null or capacity_tons > 0),
        is_active integer not null default 1 check (is_active in (0, 1)),
        created_at text not null,
        updated_at text not null
      );

      create table if not exists local_tools (
        id text primary key,
        code text not null collate nocase unique,
        matrix_code text not null collate nocase,
        matrix_search text not null,
        sequence_number integer not null default 0 check (sequence_number >= 0),
        description text,
        holes integer check (holes is null or holes >= 0),
        theoretical_linear_weight_kg_m real check (theoretical_linear_weight_kg_m is null or theoretical_linear_weight_kg_m >= 0),
        actual_linear_weight_kg_m real check (actual_linear_weight_kg_m is null or actual_linear_weight_kg_m >= 0),
        tool_weight_kg real check (tool_weight_kg is null or tool_weight_kg > 0),
        useful_life_kg real check (useful_life_kg is null or useful_life_kg >= 0),
        produced_kg real not null default 0 check (produced_kg >= 0),
        remaining_kg real,
        status text not null default 'available' check (status in ('available', 'in_use', 'maintenance', 'inactive')),
        source_status text,
        source_available integer check (source_available is null or source_available in (0, 1)),
        machine_codes text,
        package_measure_mm real check (package_measure_mm is null or package_measure_mm > 0),
        carcass_diameter_mm real check (carcass_diameter_mm is null or carcass_diameter_mm > 0),
        carcass_code text,
        created_at text not null,
        updated_at text not null,
        unique (matrix_code, sequence_number)
      );
      create index if not exists local_tools_matrix_search_idx on local_tools(matrix_search, sequence_number);
      create index if not exists local_tools_carcass_idx on local_tools(carcass_code) where carcass_code is not null;
    `,
  },
  {
    version: "0003_local_tool_actual_linear_weight",
    apply(connection) {
      const columns = connection.pragma("table_info(local_tools)") as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "actual_linear_weight_kg_m")) {
        connection.exec("alter table local_tools add column actual_linear_weight_kg_m real check (actual_linear_weight_kg_m is null or actual_linear_weight_kg_m >= 0)");
      }
    },
  },
  {
    version: "0004_local_import_batches",
    sql: `
      alter table local_tools add column source_data_json text not null default '{}';

      create table if not exists local_import_batches (
        file_hash text primary key,
        import_type text not null check (import_type in ('tool_history', 'process_sheets')),
        file_name text not null,
        status text not null check (status in ('processing', 'completed')),
        expected_chunks integer not null default 1,
        processed_rows integer not null default 0,
        created_by text references local_users(id),
        created_at text not null,
        completed_at text
      );

      create table if not exists local_import_chunks (
        file_hash text not null references local_import_batches(file_hash) on delete cascade,
        chunk_index integer not null,
        row_count integer not null,
        rows_json text not null,
        created_at text not null,
        primary key (file_hash, chunk_index)
      );

      create table if not exists local_process_sheets (
        id text primary key,
        machine_code text,
        tool_code text not null collate nocase,
        product_code text,
        alloy_code text not null collate nocase,
        temper text,
        revision integer not null default 1,
        tool_sequence integer,
        parameters_json text not null default '{}',
        is_active integer not null default 1 check (is_active in (0, 1)),
        achieved_productivity_kg_h real,
        achieved_productivity_recorded_at text,
        copied_from_process_sheet_id text,
        copied_from_sequence integer,
        source_system text,
        source_file text,
        source_row integer,
        updated_at text not null,
        unique (machine_code, tool_code, alloy_code, tool_sequence)
      );
      create index if not exists local_process_sheets_search_idx on local_process_sheets(tool_code, product_code, machine_code);
      create index if not exists local_process_sheets_active_idx on local_process_sheets(is_active, updated_at desc);
    `,
  },
  {
    version: "0005_local_physical_resources",
    sql: `
      create table if not exists local_billet_stock_lots (
        id text primary key,
        alloy_code text not null,
        lot_code text not null collate nocase unique,
        bar_weight_kg real not null check (bar_weight_kg > 0),
        total_bars integer not null check (total_bars >= 0),
        status text not null check (status in ('available','blocked','depleted')),
        location text not null default '',
        received_at text not null,
        notes text not null default '',
        created_at text not null,
        updated_at text not null
      );
      create index if not exists local_billet_lots_alloy_fifo_idx
        on local_billet_stock_lots(upper(trim(alloy_code)), status, received_at, created_at);

      create table if not exists local_billet_reservations (
        id text primary key,
        stock_lot_id text not null references local_billet_stock_lots(id),
        simulation_version_id text,
        production_order_id text,
        reserved_bars integer not null check (reserved_bars > 0),
        consumed_bars integer not null default 0 check (consumed_bars >= 0 and consumed_bars <= reserved_bars),
        status text not null check (status in ('active','released','consumed','cancelled')),
        notes text not null default '',
        created_by text references local_users(id),
        created_at text not null,
        updated_at text not null
      );
      create index if not exists local_billet_reservations_active_idx
        on local_billet_reservations(stock_lot_id, status);

      create table if not exists local_bo_resources (
        id text primary key,
        bo_code text not null collate nocase unique,
        total_quantity integer not null check (total_quantity >= 0),
        unavailable_quantity integer not null check (unavailable_quantity >= 0 and unavailable_quantity <= total_quantity),
        status text not null check (status in ('available','maintenance','blocked','inactive')),
        location text not null default '',
        notes text not null default '',
        updated_by_user_id text references local_users(id),
        updated_by_name text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists local_press_carcass_resources (
        id text primary key,
        machine_code text not null default 'SHARED',
        carcass_code text not null collate nocase unique,
        total_quantity integer not null check (total_quantity >= 0),
        unavailable_quantity integer not null check (unavailable_quantity >= 0 and unavailable_quantity <= total_quantity),
        status text not null check (status in ('available','maintenance','blocked','inactive')),
        location text not null default '',
        notes text not null default '',
        updated_by_user_id text references local_users(id),
        updated_by_name text,
        created_at text not null,
        updated_at text not null
      );

      create table if not exists local_tool_carcass_requirements (
        id text primary key,
        tool_code text not null collate nocase,
        machine_code text collate nocase,
        sequence_number integer check (sequence_number is null or sequence_number > 0),
        carcass_code text not null collate nocase,
        quantity integer not null check (quantity > 0),
        notes text not null default '',
        is_active integer not null default 1 check (is_active in (0, 1)),
        updated_by_user_id text references local_users(id),
        updated_by_name text,
        created_at text not null,
        updated_at text not null
      );
      create unique index if not exists local_tool_carcass_requirement_key_idx
        on local_tool_carcass_requirements(tool_code, coalesce(machine_code, ''), coalesce(sequence_number, -1));
      create index if not exists local_tool_carcass_requirements_lookup_idx
        on local_tool_carcass_requirements(tool_code, is_active);

      create trigger if not exists local_audit_events_no_update
        before update on local_audit_events
        begin select raise(abort, 'Eventos de auditoria são imutáveis.'); end;
      create trigger if not exists local_audit_events_no_delete
        before delete on local_audit_events
        begin select raise(abort, 'Eventos de auditoria são imutáveis.'); end;
    `,
  },
  {
    version: "0006_repair_local_import_tracking",
    sql: `
      create table if not exists local_import_batches (
        file_hash text primary key,
        import_type text not null check (import_type in ('tool_history', 'process_sheets')),
        file_name text not null,
        status text not null check (status in ('processing', 'completed')),
        expected_chunks integer not null default 1,
        processed_rows integer not null default 0,
        created_by text references local_users(id),
        created_at text not null,
        completed_at text
      );

      create table if not exists local_import_chunks (
        file_hash text not null references local_import_batches(file_hash) on delete cascade,
        chunk_index integer not null,
        row_count integer not null,
        rows_json text not null,
        created_at text not null,
        primary key (file_hash, chunk_index)
      );
    `,
  },
  {
    version: "0007_local_web_archive_and_tool_identity",
    sql: `
      create table if not exists local_tools_replacement (
        id text primary key,
        code text not null collate nocase unique,
        matrix_code text not null collate nocase,
        matrix_search text not null,
        sequence_number integer not null default 0 check (sequence_number >= 0),
        description text,
        holes integer check (holes is null or holes >= 0),
        theoretical_linear_weight_kg_m real check (theoretical_linear_weight_kg_m is null or theoretical_linear_weight_kg_m >= 0),
        actual_linear_weight_kg_m real check (actual_linear_weight_kg_m is null or actual_linear_weight_kg_m >= 0),
        tool_weight_kg real check (tool_weight_kg is null or tool_weight_kg > 0),
        useful_life_kg real check (useful_life_kg is null or useful_life_kg >= 0),
        produced_kg real not null default 0 check (produced_kg >= 0),
        remaining_kg real,
        status text not null default 'available' check (status in ('available', 'in_use', 'maintenance', 'inactive')),
        source_status text,
        source_available integer check (source_available is null or source_available in (0, 1)),
        machine_codes text,
        package_measure_mm real check (package_measure_mm is null or package_measure_mm > 0),
        carcass_diameter_mm real check (carcass_diameter_mm is null or carcass_diameter_mm > 0),
        carcass_code text,
        created_at text not null,
        updated_at text not null,
        source_data_json text not null default '{}'
      );
      insert into local_tools_replacement(
        id, code, matrix_code, matrix_search, sequence_number, description, holes,
        theoretical_linear_weight_kg_m, actual_linear_weight_kg_m, tool_weight_kg, useful_life_kg,
        produced_kg, remaining_kg, status, source_status, source_available, machine_codes,
        package_measure_mm, carcass_diameter_mm, carcass_code, created_at, updated_at, source_data_json
      ) select
        id, code, matrix_code, matrix_search, sequence_number, description, holes,
        theoretical_linear_weight_kg_m, actual_linear_weight_kg_m, tool_weight_kg, useful_life_kg,
        produced_kg, remaining_kg, status, source_status, source_available, machine_codes,
        package_measure_mm, carcass_diameter_mm, carcass_code, created_at, updated_at, source_data_json
      from local_tools;
      drop table local_tools;
      alter table local_tools_replacement rename to local_tools;
      create index if not exists local_tools_matrix_search_idx on local_tools(matrix_search, sequence_number);
      create index if not exists local_tools_carcass_idx on local_tools(carcass_code) where carcass_code is not null;

      create table if not exists local_web_archive_rows (
        source_schema text not null,
        source_table text not null,
        source_key text not null,
        payload_json text not null,
        imported_at text not null,
        primary key (source_schema, source_table, source_key)
      ) without rowid;
      create index if not exists local_web_archive_table_idx on local_web_archive_rows(source_schema, source_table);

      create table if not exists local_web_imports (
        source_project_id text primary key,
        source_project_name text not null,
        imported_at text not null,
        archived_rows integer not null,
        imported_tools integer not null,
        imported_process_sheets integer not null,
        imported_resource_rows integer not null,
        report_json text not null default '{}'
      );
    `,
  },
  {
    version: "0008_local_planning_snapshots",
    apply: migrateLocalPlanningSnapshots,
  },
  {
    version: "0009_shared_sync_state",
    sql: `
      create table if not exists local_shared_sync_state (
        table_name text primary key,
        generation integer not null,
        synced_at text not null,
        shared_root text not null
      );
    `,
  },
];

let database: Database.Database | undefined;

function now() {
  return new Date().toISOString();
}

export function localDatabasePath() {
  const dataDirectory = process.env.TECNOMES_DATA_DIR || join(homedir(), ".tecnomes-local", "data");
  return join(dataDirectory, "tecnomes.sqlite");
}

function applyMigrations(connection: Database.Database) {
  connection.exec("create table if not exists local_migrations (version text primary key, applied_at text not null)");
  const applied = new Set((connection.prepare("select version from local_migrations").all() as Array<{ version: string }>).map((migration) => migration.version));
  const record = connection.prepare("insert into local_migrations(version, applied_at) values (?, ?)");

  for (const migration of localMigrations) {
    if (applied.has(migration.version)) continue;
    connection.transaction(() => {
      if (migration.apply) migration.apply(connection);
      else if (migration.sql) connection.exec(migration.sql);
      record.run(migration.version, now());
    })();
  }
}

export function getLocalDatabase() {
  if (database) return database;
  const filePath = localDatabasePath();
  mkdirSync(dirname(filePath), { recursive: true });
  database = new Database(filePath);
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  applyMigrations(database);
  return database;
}

export function localDatabaseStatus() {
  const connection = getLocalDatabase();
  const migrationCount = Number((connection.prepare("select count(*) as count from local_migrations").get() as { count: number }).count);
  const journalMode = String((connection.prepare("pragma journal_mode").get() as { journal_mode: string }).journal_mode);
  return { ready: true, engine: "sqlite", migrationCount, journalMode };
}

export function appendLocalAuditEvent(input: {
  actorUserId?: string | null;
  entityType: string;
  entityId?: string | null;
  eventType: string;
  details?: Record<string, unknown>;
}) {
  getLocalDatabase().prepare(`
    insert into local_audit_events(id, occurred_at, actor_user_id, entity_type, entity_id, event_type, details_json)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), now(), input.actorUserId ?? null, input.entityType, input.entityId ?? null, input.eventType, JSON.stringify(input.details ?? {}));
}

export function hashOpaqueToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
