import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(new URL("../supabase/migrations/20261002130000_harden_production_report_imports.sql", import.meta.url), "utf8");
const groupsMigration = await readFile(new URL("../supabase/migrations/20261002140000_production_match_groups.sql", import.meta.url), "utf8");

test("importação ERP tem prévia, hash, linhas rejeitadas e confirmação idempotente", () => {
  assert.match(migration, /production_report_import_rows/);
  assert.match(migration, /production_report_imports_org_hash_uidx/);
  assert.match(migration, /status in \('preview', 'processing', 'processed', 'failed', 'rejected'\)/);
  assert.match(migration, /local_prepare_production_report_import/);
  assert.match(migration, /local_commit_production_report_import/);
  assert.match(migration, /on conflict \(import_id, row_number\) do nothing/);
});

test("matching persistirá classificação e evidência explicável", () => {
  assert.match(migration, /match_classification text/);
  assert.match(migration, /match_evidence jsonb/);
  assert.match(migration, /local_apply_production_match/);
  assert.match(migration, /caso ambíguo não pode ser vinculado automaticamente/i);
});

test("confronto mantém grupos, diferenças por campo e revisão manual", () => {
  assert.match(groupsMigration, /production_match_groups/);
  assert.match(groupsMigration, /production_matches/);
  assert.match(groupsMigration, /production_discrepancies/);
  assert.match(groupsMigration, /field_comparisons/);
  assert.match(groupsMigration, /manual_linked/);
  assert.match(groupsMigration, /justificativa para vínculo manual/i);
});
