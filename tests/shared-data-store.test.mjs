import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createSharedDataStore, SharedDataError } from "../src/lib/local-db/shared-data-store.mjs";

test("duas estações compartilham versões, tabelas e eventos sem sobrescrever mudanças", async () => {
  const root = await mkdtemp(join(tmpdir(), "tecnomes-shared-"));
  try {
    const pcp = createSharedDataStore(root);
    const production = createSharedDataStore(root);
    assert.equal((await pcp.readManifest()).generation, 0);
    assert.equal(await pcp.publishTable("machines", [{ code: "P1800" }], 0), 1);
    assert.deepEqual((await production.readTable("machines")).rows, [{ code: "P1800" }]);
    await assert.rejects(() => production.publishTable("machines", [], 0), (error) => error instanceof SharedDataError && error.status === 409);
    assert.equal(await production.appendEvent({ type: "production_started", actor: "operador-1", orderId: "OP-1" }, 1), 2);
    assert.equal((await pcp.readEvents(1)).events[0].orderId, "OP-1");
    assert.equal((await pcp.readManifest()).generation, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("corrupção de snapshot é detectada antes de alimentar uma estação", async () => {
  const root = await mkdtemp(join(tmpdir(), "tecnomes-shared-"));
  try {
    const store = createSharedDataStore(root);
    await store.publishTable("machines", [{ code: "P1800" }], 0);
    const manifest = await store.readManifest();
    const file = join(store.directory, manifest.tables.machines.file);
    const body = await readFile(file, "utf8");
    await writeFile(file, body.replace("P1800", "P1900"));
    await assert.rejects(() => store.readTable("machines"), /integridade/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("duas gravações simultâneas não confirmam a mesma versão", async () => {
  const root = await mkdtemp(join(tmpdir(), "tecnomes-shared-"));
  try {
    const first = createSharedDataStore(root);
    const second = createSharedDataStore(root);
    const outcomes = await Promise.allSettled([
      first.publishTable("machines", [{ code: "P1800" }], 0),
      second.publishTable("machines", [{ code: "P1900" }], 0),
    ]);
    assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
    assert.equal((await first.readManifest()).generation, 1);
    assert.equal((await second.readTable("machines")).rows.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("um lote de tabelas aparece como uma única geração", async () => {
  const root = await mkdtemp(join(tmpdir(), "tecnomes-shared-"));
  try {
    const store = createSharedDataStore(root);
    assert.equal(await store.publishTables({ machines: [{ code: "P1800" }], tools: [{ code: "F1" }] }, 0), 1);
    const manifest = await store.readManifest();
    assert.equal(manifest.tables.machines.generation, 1);
    assert.equal(manifest.tables.tools.generation, 1);
    assert.equal((await store.readTable("tools")).rows[0].code, "F1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
