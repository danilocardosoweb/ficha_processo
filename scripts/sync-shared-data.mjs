import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { pullSharedCatalog } from "../src/lib/local-db/shared-catalog-sync.mjs";

const dataDirectory = process.env.TECNOMES_DATA_DIR || join(process.env.APPDATA || "", "tecnomes-local", "data");
const file = join(dataDirectory, "tecnomes.sqlite");
if (!existsSync(file)) throw new Error(`SQLite desta estação não encontrado: ${file}. Abra o aplicativo uma vez antes de sincronizar.`);
const db = new Database(file, { fileMustExist: true });
try {
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const result = await pullSharedCatalog(db);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} finally {
  db.close();
}
