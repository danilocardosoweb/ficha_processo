from __future__ import annotations

import json
import sqlite3
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IMPORTER = ROOT / "scripts" / "import-web-snapshot.py"
SOURCE_DB = Path.home() / "AppData" / "Roaming" / "tecnomes-local" / "data" / "tecnomes.sqlite"


def main() -> None:
    if not SOURCE_DB.is_file():
        raise SystemExit("SQLite local de teste não encontrado.")

    token = uuid.uuid4().hex[:8].upper()
    tool_a = f"TESTMIG-{token}-A"
    tool_b = f"TESTMIG-{token}-B"
    tool_id_a = str(uuid.uuid4())
    tool_id_b = str(uuid.uuid4())
    sheet_id = str(uuid.uuid4())
    lot_id = str(uuid.uuid4())

    with tempfile.TemporaryDirectory(prefix="tecnomes-web-import-test-", dir=ROOT / "scripts") as temp_dir:
        test_db = Path(temp_dir) / "test.sqlite"
        source = sqlite3.connect(f"file:{SOURCE_DB.as_posix()}?mode=ro", uri=True, timeout=60)
        target = sqlite3.connect(test_db)
        source.backup(target)
        target.close()
        source.close()

        records = [
            {
                "schema": "public", "table": "tools", "source_key": json.dumps([tool_id_a]),
                "payload": {"id": tool_id_a, "code": tool_a, "matrix_code": f"M-{token}", "sequence_number": 1,
                            "description": "Complete test tool", "status": "available", "produced_kg": 2,
                            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"},
            },
            {
                "schema": "public", "table": "tools", "source_key": json.dumps([tool_id_b]),
                "payload": {"id": tool_id_b, "code": tool_b, "matrix_code": None, "sequence_number": None,
                            "description": f"Perfil M-{token}-B", "status": "available", "produced_kg": None,
                            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"},
            },
            {
                "schema": "public", "table": "process_sheets", "source_key": json.dumps([sheet_id]),
                "payload": {"id": sheet_id, "machine_code": "18", "tool_code": tool_b,
                            "product_code": f"P-{token}", "alloy_code": "6063", "revision": 1,
                            "tool_sequence": 2, "parameters": {"temperature": 480}, "is_active": True,
                            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"},
            },
            {
                "schema": "public", "table": "billet_stock_lots", "source_key": json.dumps([lot_id]),
                "payload": {"id": lot_id, "alloy_code": "6063", "lot_code": f"LOT-{token}",
                            "bar_weight_kg": 100, "total_bars": 10, "status": "available",
                            "location": "Test", "received_at": "2026-01-01T00:00:00Z",
                            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"},
            },
        ]
        snapshot_db = Path(temp_dir) / "snapshot.sqlite"
        snapshot = sqlite3.connect(snapshot_db)
        snapshot.executescript(
            """
            create table source_rows(
              source_schema text not null, source_table text not null, source_key text not null,
              payload_json text not null, primary key(source_schema,source_table,source_key)
            ) without rowid;
            create table source_counts(
              source_schema text not null, source_table text not null, expected_rows integer not null,
              primary key(source_schema,source_table)
            ) without rowid;
            create table source_meta(key text primary key, value text not null);
            """
        )
        snapshot.executemany(
            "insert into source_meta(key,value) values (?,?)",
            [("project_id", "test-project"), ("project_name", "Teste")],
        )
        snapshot.executemany(
            "insert into source_counts(source_schema,source_table,expected_rows) values (?,?,?)",
            [("public", "tools", 2), ("public", "process_sheets", 1), ("public", "billet_stock_lots", 1)],
        )
        snapshot.executemany(
            "insert into source_rows(source_schema,source_table,source_key,payload_json) values (?,?,?,?)",
            [
                (row["schema"], row["table"], row["source_key"], json.dumps(row["payload"], ensure_ascii=False))
                for row in records
            ],
        )
        snapshot.commit()
        snapshot.close()
        result = subprocess.run(
            [sys.executable, str(IMPORTER), "--db", str(test_db), "--snapshot", str(snapshot_db)],
            text=True,
            capture_output=True,
            check=True,
        )
        report = json.loads(result.stdout)

        connection = sqlite3.connect(test_db)
        assert connection.execute("select count(*) from local_web_archive_rows").fetchone()[0] == 4
        assert connection.execute("select count(*) from local_tools where code in (?, ?)", (tool_a, tool_b)).fetchone()[0] == 2
        placeholder = connection.execute("select matrix_code, sequence_number, status from local_tools where code=?", (tool_b,)).fetchone()
        assert placeholder == (f"M-{token}-B", 0, "inactive")
        sheet = connection.execute("select machine_code, tool_code from local_process_sheets where id=?", (sheet_id,)).fetchone()
        assert sheet == ("P1800", tool_b)
        assert connection.execute("select count(*) from local_billet_stock_lots where id=?", (lot_id,)).fetchone()[0] == 1
        assert connection.execute("select count(*) from local_migrations where version='0007_local_web_archive_and_tool_identity'").fetchone()[0] == 1
        connection.close()

        assert report["archived_rows_inserted_this_run"] == 4
        assert report["incomplete_tool_rows_added_as_inactive"] == 2
        assert report["process_sheets_added"] == 1
        assert report["resource_rows_added"] == 1
        print("Importação de teste concluída; banco original não foi alterado.")


if __name__ == "__main__":
    main()
