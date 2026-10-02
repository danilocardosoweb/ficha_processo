import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migrationPath = new URL("../supabase/migrations/20261002120000_production_sessions_and_events.sql", import.meta.url);
const migration = await readFile(migrationPath, "utf8");

test("sessão de produção tem vínculo com campanha e eventos append-only", () => {
  assert.match(migration, /create table if not exists public\.production_sessions/i);
  assert.match(migration, /create table if not exists public\.production_session_orders/i);
  assert.match(migration, /create table if not exists public\.production_session_events/i);
  assert.match(migration, /unique \(session_id, idempotency_key\)/i);
  assert.match(migration, /before update or delete on public\.production_session_events/i);
  assert.match(migration, /Eventos da sessão são imutáveis/i);
});

test("transições operacionais expõem somente RPCs autenticadas pela sessão local", () => {
  for (const functionName of [
    "local_start_production_session",
    "local_resume_production_session",
    "local_pause_production_session",
    "local_complete_production_session",
    "local_record_partial_production_session",
    "local_reopen_production_session",
    "local_record_manual_production_result",
    "local_cancel_production_order",
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${functionName}\\(`, "i"));
    assert.match(migration, new RegExp(`grant execute on function public\\.${functionName}`, "i"));
  }
  assert.match(migration, /revoke all on table public\.production_session_events from anon, authenticated/i);
});

test("rotas de produção não gravam diretamente o status da ordem no navegador", async () => {
  const startRoute = await readFile(new URL("../src/app/api/production/start/route.ts", import.meta.url), "utf8");
  const partialRoute = await readFile(new URL("../src/app/api/production/partial/route.ts", import.meta.url), "utf8");
  const completeRoute = await readFile(new URL("../src/app/api/production/complete/route.ts", import.meta.url), "utf8");
  assert.match(startRoute, /local_start_production_session/);
  assert.match(partialRoute, /local_record_partial_production_session/);
  assert.match(completeRoute, /local_complete_production_session/);
  assert.doesNotMatch(completeRoute, /from\("production_orders"\)\.update/);
});

test("parada da campanha passa pelo backend antes de atualizar a tela", async () => {
  const cockpit = await readFile(new URL("../src/components/production-cockpit.tsx", import.meta.url), "utf8");
  const stoppageRoute = await readFile(new URL("../src/app/api/production/stoppage/route.ts", import.meta.url), "utf8");
  assert.match(cockpit, /fetch\("\/api\/production\/stoppage"/);
  assert.doesNotMatch(cockpit, /from\("machine_stoppages"\)\.insert/);
  assert.match(stoppageRoute, /local_pause_production_session/);
});
