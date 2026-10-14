#!/usr/bin/env python3
"""Safely ingest a streamed Supabase snapshot into the local SQLite database.

Input is JSON Lines on stdin. Each row contains schema, table, source_key, and
payload. The full source row is preserved in local_web_archive_rows; only
catalogs already supported by the local edition are copied into live tables.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MIGRATION_VERSION = "0007_local_web_archive_and_tool_identity"


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def disable_tty_echo() -> None:
    if not sys.stdin.isatty():
        return
    try:
        import ctypes
        import msvcrt

        handle = msvcrt.get_osfhandle(sys.stdin.fileno())
        mode = ctypes.c_uint()
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        if kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            kernel32.SetConsoleMode(handle, mode.value & ~0x0004)  # ENABLE_ECHO_INPUT
    except (AttributeError, OSError, ImportError):
        pass


def mapped_machine_code(value: Any) -> str | None:
    if value is None:
        return None
    raw = str(value).strip()
    return {"18": "P1800", "19": "P1900"}.get(raw, raw)


def derive_matrix_code(row: dict[str, Any]) -> str:
    value = row.get("matrix_code")
    if value is not None and str(value).strip():
        return str(value).strip().upper()
    description = str(row.get("description") or "").strip()
    description = re.sub(r"^perfils?\s+", "", description, flags=re.IGNORECASE).strip()
    return (description or f"SEM-MATRIZ-{row.get('code', 'SEM-CODIGO')}").upper()


def source_machine_codes(value: Any) -> str | None:
    if value is None:
        return None
    return re.sub(r"1\.8", "P1800", re.sub(r"1\.9", "P1900", str(value)))


def ensure_migration(connection: sqlite3.Connection) -> None:
    applied = {row[0] for row in connection.execute("select version from local_migrations")}
    if MIGRATION_VERSION in applied:
        return

    migration_sql = """
        create table local_tools_replacement (
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
        """
    for statement in migration_sql.split(";"):
        if statement.strip():
            connection.execute(statement)
    connection.execute(
        "insert into local_migrations(version, applied_at) values (?, ?)",
        (MIGRATION_VERSION, now()),
    )


def insert_tool(connection: sqlite3.Connection, row: dict[str, Any], timestamp: str) -> bool:
    code = str(row.get("code") or "").strip()
    if not code:
        return False
    matrix_code = derive_matrix_code(row)
    sequence = row.get("sequence_number")
    incomplete = row.get("matrix_code") is None or sequence is None
    source_status = str(row.get("status") or "available")
    status = "inactive" if incomplete else source_status
    if status not in {"available", "in_use", "maintenance", "inactive"}:
        status = "inactive"
    source_available = row.get("source_available")
    if source_available is None:
        source_available = source_status == "available"
    created_at = str(row.get("created_at") or timestamp)
    updated_at = str(row.get("updated_at") or timestamp)
    cursor = connection.execute(
        """
        insert or ignore into local_tools(
          id, code, matrix_code, matrix_search, sequence_number, description, holes,
          theoretical_linear_weight_kg_m, actual_linear_weight_kg_m, tool_weight_kg, useful_life_kg,
          produced_kg, remaining_kg, status, source_status, source_available, machine_codes,
          package_measure_mm, carcass_diameter_mm, carcass_code, source_data_json, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(row.get("id") or code), code, matrix_code, matrix_code.casefold(), int(sequence or 0),
            row.get("description"), row.get("holes"), row.get("theoretical_linear_weight_kg_m"),
            row.get("actual_linear_weight_kg_m"), row.get("useful_life_kg"),
            float(row.get("produced_kg") or 0), row.get("remaining_kg"), status, source_status,
            int(bool(source_available)), source_machine_codes(row.get("machine_codes")),
            row.get("package_measure_mm"), row.get("carcass_diameter_mm"), row.get("carcass_code"),
            json.dumps(row, ensure_ascii=False, separators=(",", ":")), created_at, updated_at,
        ),
    )
    return cursor.rowcount == 1


def insert_process_sheet(connection: sqlite3.Connection, row: dict[str, Any], timestamp: str) -> bool:
    machine_code = mapped_machine_code(row.get("machine_code"))
    tool_code = str(row.get("tool_code") or "").strip()
    alloy_code = str(row.get("alloy_code") or "").strip()
    if not tool_code or not alloy_code:
        return False
    cursor = connection.execute(
        """
        insert or ignore into local_process_sheets(
          id, machine_code, tool_code, product_code, alloy_code, temper, revision, tool_sequence,
          parameters_json, is_active, achieved_productivity_kg_h, achieved_productivity_recorded_at,
          copied_from_process_sheet_id, copied_from_sequence, source_system, source_file, source_row, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            str(row.get("id") or ""), machine_code, tool_code, row.get("product_code"), alloy_code,
            row.get("temper"), int(row.get("revision") or 1), row.get("tool_sequence"),
            json.dumps(row.get("parameters") or {}, ensure_ascii=False, separators=(",", ":")),
            int(bool(row.get("is_active"))), row.get("achieved_productivity_kg_h"),
            row.get("achieved_productivity_recorded_at"), row.get("copied_from_process_sheet_id"),
            row.get("copied_from_sequence"), row.get("source_system"), row.get("source_file"),
            row.get("source_row"), str(row.get("updated_at") or timestamp),
        ),
    )
    return cursor.rowcount == 1


def insert_resource(connection: sqlite3.Connection, table: str, row: dict[str, Any], timestamp: str) -> bool:
    if table == "billet_stock_lots":
        status = row.get("status") if row.get("status") in {"available", "blocked", "depleted"} else "blocked"
        cursor = connection.execute(
            """
            insert or ignore into local_billet_stock_lots(
              id, alloy_code, lot_code, bar_weight_kg, total_bars, status, location, received_at, notes,
              created_at, updated_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(row.get("id") or ""), str(row.get("alloy_code") or ""), str(row.get("lot_code") or ""),
                row.get("bar_weight_kg"), row.get("total_bars"), status, row.get("location") or "",
                str(row.get("received_at") or timestamp), row.get("notes") or "",
                str(row.get("created_at") or timestamp), str(row.get("updated_at") or timestamp),
            ),
        )
        return cursor.rowcount == 1

    if table == "press_carcass_resources":
        status = row.get("status") if row.get("status") in {"available", "maintenance", "blocked", "inactive"} else "blocked"
        cursor = connection.execute(
            """
            insert or ignore into local_press_carcass_resources(
              id, machine_code, carcass_code, total_quantity, unavailable_quantity, status, location, notes,
              updated_by_user_id, updated_by_name, created_at, updated_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?)
            """,
            (
                str(row.get("id") or ""), mapped_machine_code(row.get("machine_code")) or "SHARED",
                str(row.get("carcass_code") or ""), row.get("total_quantity"), row.get("unavailable_quantity"),
                status, row.get("location") or "", row.get("notes") or "", row.get("updated_by_name"),
                str(row.get("created_at") or timestamp), str(row.get("updated_at") or timestamp),
            ),
        )
        return cursor.rowcount == 1

    if table == "bo_resources":
        status = row.get("status") if row.get("status") in {"available", "maintenance", "blocked", "inactive"} else "blocked"
        cursor = connection.execute(
            """
            insert or ignore into local_bo_resources(
              id, bo_code, total_quantity, unavailable_quantity, status, location, notes,
              updated_by_user_id, updated_by_name, created_at, updated_at
            ) values (?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?)
            """,
            (
                str(row.get("id") or ""), str(row.get("bo_code") or ""), row.get("total_quantity"),
                row.get("unavailable_quantity"), status, row.get("location") or "", row.get("notes") or "",
                row.get("updated_by_name"), str(row.get("created_at") or timestamp), str(row.get("updated_at") or timestamp),
            ),
        )
        return cursor.rowcount == 1

    return False


def import_snapshot(database_path: Path, snapshot_path: Path) -> dict[str, Any]:
    if not database_path.is_file():
        raise FileNotFoundError(f"SQLite local não encontrado: {database_path}")
    if not snapshot_path.is_file():
        raise FileNotFoundError(f"Cópia da versão web não encontrada: {snapshot_path}")

    snapshot = sqlite3.connect(f"file:{snapshot_path.as_posix()}?mode=ro", uri=True, timeout=60)
    snapshot.row_factory = sqlite3.Row
    metadata = {row["key"]: row["value"] for row in snapshot.execute("select key, value from source_meta")}
    expected_counts = {
        f"{row['source_schema']}.{row['source_table']}": int(row["expected_rows"])
        for row in snapshot.execute("select source_schema, source_table, expected_rows from source_counts")
    }
    actual_counts = {
        f"{row['source_schema']}.{row['source_table']}": int(row["rows"])
        for row in snapshot.execute(
            "select source_schema, source_table, count(*) as rows from source_rows group by source_schema, source_table"
        )
    }
    actual_counts = {key: actual_counts.get(key, 0) for key in expected_counts}
    if not expected_counts or actual_counts != expected_counts:
        mismatches = {
            key: {"expected": expected_counts.get(key, 0), "received": actual_counts.get(key, 0)}
            for key in sorted(set(expected_counts) | set(actual_counts))
            if expected_counts.get(key, 0) != actual_counts.get(key, 0)
        }
        snapshot.close()
        raise ValueError(f"A cópia da versão web está incompleta; banco local não alterado: {mismatches}")

    backup_path = database_path.with_name(
        f"{database_path.stem}-before-web-import-{datetime.now().strftime('%Y%m%d-%H%M%S')}{database_path.suffix}"
    )
    source = sqlite3.connect(f"file:{database_path.as_posix()}?mode=ro", uri=True, timeout=60)
    backup = sqlite3.connect(str(backup_path), timeout=60)
    source.backup(backup)
    backup.close()
    source.close()

    connection = sqlite3.connect(str(database_path), timeout=60)
    connection.row_factory = sqlite3.Row
    connection.execute("pragma busy_timeout=60000")
    connection.execute("pragma foreign_keys=on")
    disable_tty_echo()
    counts: dict[str, int] = {}
    totals = {"archive": 0, "tools": 0, "process_sheets": 0, "resources": 0}
    timestamp = now()

    try:
        connection.execute("begin immediate")
        ensure_migration(connection)
        archive = connection.cursor()
        cursor = snapshot.execute(
            """
            select source_schema, source_table, source_key, payload_json
            from source_rows
            order by case
              when source_schema='public' and source_table='tools' then 0
              when source_schema='public' and source_table='process_sheets' then 1
              when source_schema='public' and source_table in ('billet_stock_lots','press_carcass_resources','bo_resources') then 2
              else 3 end,
              source_schema, source_table, source_key
            """
        )

        for row_number, row in enumerate(cursor, start=1):
            schema = str(row["source_schema"])
            table = str(row["source_table"])
            source_key = str(row["source_key"])
            payload = json.loads(row["payload_json"])
            if not source_key or not isinstance(payload, dict):
                raise ValueError(f"Registro inválido na cópia, linha {row_number}.")

            inserted = archive.execute(
                "insert or ignore into local_web_archive_rows(source_schema, source_table, source_key, payload_json, imported_at) values (?, ?, ?, ?, ?)",
                (schema, table, source_key, json.dumps(payload, ensure_ascii=False, separators=(",", ":")), timestamp),
            ).rowcount
            totals["archive"] += int(inserted == 1)
            table_key = f"{schema}.{table}"
            counts[table_key] = counts.get(table_key, 0) + 1

            if schema == "public" and table == "tools" and insert_tool(connection, payload, timestamp):
                totals["tools"] += 1
            elif schema == "public" and table == "process_sheets" and insert_process_sheet(connection, payload, timestamp):
                totals["process_sheets"] += 1
            elif schema == "public" and table in {"billet_stock_lots", "press_carcass_resources", "bo_resources"}:
                if insert_resource(connection, table, payload, timestamp):
                    totals["resources"] += 1

        counts = {key: counts.get(key, 0) for key in expected_counts}
        if expected_counts and counts != expected_counts:
            mismatches = {
                key: {"expected": expected_counts.get(key, 0), "received": counts.get(key, 0)}
                for key in sorted(set(expected_counts) | set(counts))
                if expected_counts.get(key, 0) != counts.get(key, 0)
            }
            raise ValueError(f"Snapshot incompleto ou divergente; transação cancelada: {mismatches}")

        project_id = str(metadata.get("project_id") or "wjvfyqtyybomyfmqixxl")
        project_name = str(metadata.get("project_name") or "Supervisorio Prensa")
        total_archived = connection.execute("select count(*) from local_web_archive_rows").fetchone()[0]
        summary = {
            "tables": counts,
            "expected_table_counts": expected_counts,
            "snapshot_rows": sum(counts.values()),
            "archived_rows_inserted_this_run": totals["archive"],
            "incomplete_tool_rows_added_as_inactive": totals["tools"],
            "process_sheets_added": totals["process_sheets"],
            "resource_rows_added": totals["resources"],
            "archive_rows_total": total_archived,
            "excluded_tables": ["private.local_users", "private.local_sessions"],
        }
        connection.execute(
            """
            insert into local_web_imports(
              source_project_id, source_project_name, imported_at, archived_rows,
              imported_tools, imported_process_sheets, imported_resource_rows, report_json
            ) values (?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(source_project_id) do update set
              source_project_name=excluded.source_project_name,
              imported_at=excluded.imported_at,
              archived_rows=excluded.archived_rows,
              imported_tools=excluded.imported_tools,
              imported_process_sheets=excluded.imported_process_sheets,
              imported_resource_rows=excluded.imported_resource_rows,
              report_json=excluded.report_json
            """,
            (
                project_id, project_name, timestamp, totals["archive"], totals["tools"],
                totals["process_sheets"], totals["resources"],
                json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
            ),
        )
        connection.commit()
        return {"database": str(database_path), "backup": str(backup_path), **summary}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()
        snapshot.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path, help="Caminho do banco SQLite local")
    parser.add_argument("--snapshot", required=True, type=Path, help="Caminho da cópia SQLite da versão web")
    arguments = parser.parse_args()
    result = import_snapshot(arguments.db, arguments.snapshot)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # pragma: no cover - CLI reporting
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        raise
