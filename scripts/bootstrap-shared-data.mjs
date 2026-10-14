import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { createSharedDataStore } from "../src/lib/local-db/shared-data-store.mjs";
import { sharedCatalogTables } from "../src/lib/local-db/shared-catalog-tables.mjs";

const dataDirectory = process.env.TECNOMES_DATA_DIR || join(process.env.APPDATA || "", "tecnomes-local", "data");
const databasePath = join(dataDirectory, "tecnomes.sqlite");
if (!existsSync(databasePath)) throw new Error(`SQLite de origem não encontrado: ${databasePath}`);

const store = createSharedDataStore();
const manifest = await store.readManifest();
if (manifest.generation !== 0 || Object.keys(manifest.tables).length > 0 || manifest.events.length > 0) {
  throw new Error("A base compartilhada já contém uma versão. O bootstrap não sobrescreve dados existentes.");
}

const db = new Database(databasePath, { readonly: true, fileMustExist: true });
try {
  if (db.pragma("quick_check(1)", { simple: true }) !== "ok") throw new Error("A verificação da origem SQLite falhou.");
  const payload = {};
  const counts = {};
  for (const table of sharedCatalogTables) {
    if (!db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(table)) throw new Error(`Tabela ausente na origem: ${table}`);
    payload[table] = db.prepare(`select * from ${table}`).all();
    counts[table] = payload[table].length;
  }
  const generation = await store.publishTables(payload, 0);
  for (const table of sharedCatalogTables) {
    const snapshot = await store.readTable(table);
    if (snapshot.rows.length !== counts[table]) throw new Error(`Conferência de linhas falhou: ${table}`);
  }
  process.stdout.write(JSON.stringify({ root: store.root, generation, counts }, null, 2) + "\n");
} finally {
  db.close();
}
