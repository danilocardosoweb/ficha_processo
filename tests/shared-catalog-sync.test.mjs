import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { createSharedDataStore } from "../src/lib/local-db/shared-data-store.mjs";
import { pullSharedCatalog } from "../src/lib/local-db/shared-catalog-sync.mjs";
import { saveSharedMachine, syncSharedMachines } from "../src/lib/local-db/shared-machines.mjs";

function createStation(file) {
  const db = new Database(file);
  db.exec(`create table local_machines (
    id text primary key, code text not null unique, name text not null,
    capacity_tons integer, is_active integer not null, created_at text not null,
    updated_at text not null
  )`);
  return db;
}

const machine = { id: "machine-1", code: "P1800", name: "1.8", capacity_tons: 1800, is_active: 1, created_at: "2026-10-13", updated_at: "2026-10-13" };

test("outra estação recebe o catálogo e acompanha a versão seguinte", async () => {
  const root = await mkdtemp(join(tmpdir(), "tecnomes-catalog-"));
  const source = createStation(join(root, "source.sqlite"));
  const receiver = createStation(join(root, "receiver.sqlite"));
  try {
    const store = createSharedDataStore(root);
    source.prepare("insert into local_machines values (@id,@code,@name,@capacity_tons,@is_active,@created_at,@updated_at)").run(machine);
    await store.publishTables({ local_machines: source.prepare("select * from local_machines").all() }, 0);
    assert.deepEqual(await pullSharedCatalog(receiver, { store, tables: ["local_machines"] }), { generation: 1, changed: true, counts: { local_machines: 1 } });
    assert.equal(receiver.prepare("select name from local_machines where id = ?").get(machine.id).name, "1.8");
    assert.deepEqual(await pullSharedCatalog(receiver, { store, tables: ["local_machines"] }), { generation: 1, changed: false });
    source.prepare("update local_machines set name = ? where id = ?").run("Prensa 1.8", machine.id);
    await store.publishTables({ local_machines: source.prepare("select * from local_machines").all() }, 1);
    await pullSharedCatalog(receiver, { store, tables: ["local_machines"] });
    assert.equal(receiver.prepare("select name from local_machines where id = ?").get(machine.id).name, "Prensa 1.8");
  } finally {
    source.close();
    receiver.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("estação com dados próprios não é sobrescrita no primeiro vínculo", async () => {
  const root = await mkdtemp(join(tmpdir(), "tecnomes-catalog-"));
  const receiver = createStation(join(root, "receiver.sqlite"));
  try {
    const store = createSharedDataStore(root);
    await store.publishTables({ local_machines: [machine] }, 0);
    receiver.prepare("insert into local_machines values (@id,@code,@name,@capacity_tons,@is_active,@created_at,@updated_at)").run({ ...machine, id: "own", code: "P1900" });
    await assert.rejects(() => pullSharedCatalog(receiver, { store, tables: ["local_machines"] }), /conciliação/);
    assert.equal(receiver.prepare("select count(*) count from local_machines").get().count, 1);
  } finally {
    receiver.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("estação que publicou o mesmo catálogo pode aderir sem apagar dados", async () => {
  const root = await mkdtemp(join(tmpdir(), "tecnomes-catalog-"));
  const source = createStation(join(root, "source.sqlite"));
  try {
    const store = createSharedDataStore(root);
    source.prepare("insert into local_machines values (@id,@code,@name,@capacity_tons,@is_active,@created_at,@updated_at)").run(machine);
    await store.publishTable("local_machines", source.prepare("select * from local_machines").all(), 0);
    const result = await pullSharedCatalog(source, { store, tables: ["local_machines"] });
    assert.equal(result.changed, true);
    assert.equal(source.prepare("select count(*) count from local_machines").get().count, 1);
  } finally {
    source.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("PCP grava prensa no compartilhamento e outra estação recebe", async () => {
  const root = await mkdtemp(join(tmpdir(), "tecnomes-catalog-"));
  const pcp = createStation(join(root, "pcp.sqlite"));
  const production = createStation(join(root, "production.sqlite"));
  try {
    const store = createSharedDataStore(root);
    await store.publishTable("local_machines", [], 0);
    const id = await saveSharedMachine(pcp, store, { code: "P1800", name: "Prensa 1.8", capacity_tons: 1800, is_active: true });
    assert.equal(pcp.prepare("select code from local_machines where id = ?").get(id).code, "P1800");
    await syncSharedMachines(production, store);
    assert.equal(production.prepare("select name from local_machines where id = ?").get(id).name, "Prensa 1.8");
    await assert.rejects(() => saveSharedMachine(production, store, { code: "P1800", name: "Duplicada", is_active: true }), /Já existe/);
    assert.equal((await store.readManifest()).generation, 2);
  } finally {
    pcp.close();
    production.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("sem rede a estação não grava uma prensa apenas no próprio SQLite", async () => {
  const root = await mkdtemp(join(tmpdir(), "tecnomes-catalog-"));
  const pcp = createStation(join(root, "pcp.sqlite"));
  try {
    const unavailable = createSharedDataStore(join(root, "share-offline"));
    await assert.rejects(() => saveSharedMachine(pcp, unavailable, { code: "P1800", name: "1.8", is_active: true }), /não está disponível/);
    assert.equal(pcp.prepare("select count(*) count from local_machines").get().count, 0);
  } finally {
    pcp.close();
    await rm(root, { recursive: true, force: true });
  }
});
