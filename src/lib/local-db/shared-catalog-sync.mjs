import { createSharedDataStore, SharedDataError } from "./shared-data-store.mjs";
import { sharedCatalogTables } from "./shared-catalog-tables.mjs";

const immutableTables = new Set(["local_portfolio_snapshots", "local_simplified_baseline_orders"]);
const foreignUserColumns = new Set(["updated_by_user_id", "created_by"]);

function tableColumns(db, table) {
  const columns = db.pragma(`table_info(${table})`);
  if (columns.length === 0) throw new SharedDataError(`A estação não possui a tabela ${table}. Atualize o aplicativo antes de sincronizar.`);
  const primaryKey = columns.find((column) => column.pk === 1)?.name;
  if (!primaryKey) throw new SharedDataError(`A tabela ${table} não possui chave primária compatível.`);
  return { columns: columns.map((column) => column.name), primaryKey };
}

export async function pullSharedCatalog(db, options = {}) {
  const store = options.store || createSharedDataStore();
  const tables = options.tables || sharedCatalogTables;
  const manifest = await store.readManifest();
  if (manifest.generation === 0) throw new SharedDataError("A base compartilhada ainda não foi carregada.");
  for (const table of tables) {
    if (!sharedCatalogTables.includes(table) || !manifest.tables[table]) throw new SharedDataError(`Tabela compartilhada ausente: ${table}.`);
  }

  db.exec(`create table if not exists local_shared_sync_state (
    table_name text primary key, generation integer not null,
    synced_at text not null, shared_root text not null
  )`);
  const candidates = tables.filter((table) => {
    const previous = db.prepare("select generation, shared_root from local_shared_sync_state where table_name = ?").get(table);
    if (previous && previous.shared_root !== store.root) throw new SharedDataError("Esta estação já pertence a outro compartilhamento. A troca exige conciliação administrativa.");
    return !previous || previous.generation < manifest.tables[table].generation;
  });
  if (!candidates.length) return { generation: manifest.generation, changed: false };

  // A leitura dos snapshots precede a transação; falha de integridade
  // não deixa metade dos cadastros aplicada no cache desta estação.
  const snapshots = new Map();
  for (const table of candidates) snapshots.set(table, (await store.readTableFromManifest(table, manifest)).rows);

  const changedTables = [];
  for (const table of candidates) {
    const previous = db.prepare("select generation, shared_root from local_shared_sync_state where table_name = ?").get(table);
    if (!previous && !options.trustExisting) {
      const localRows = db.prepare(`select * from ${table}`).all();
      if (localRows.length && JSON.stringify(localRows) !== JSON.stringify(snapshots.get(table))) {
        throw new SharedDataError(`Esta estação já contém dados diferentes em ${table}. Faça backup e conciliação antes de conectá-la.`, 409);
      }
    }
    changedTables.push(table);
  }
  const apply = db.transaction(() => {
    for (const table of changedTables) {
      const { columns, primaryKey } = tableColumns(db, table);
      const rows = snapshots.get(table);
      if (!Array.isArray(rows)) throw new SharedDataError(`Snapshot inválido: ${table}.`);
      const columnSet = new Set(columns);
      for (const row of rows) {
        if (!row || typeof row !== "object" || Object.keys(row).some((key) => !columnSet.has(key))) {
          throw new SharedDataError(`Campos incompatíveis na tabela ${table}. Atualize o aplicativo.`);
        }
      }
      const names = columns.join(", ");
      const parameters = columns.map((column) => `@${column}`).join(", ");
      const updates = columns.filter((column) => column !== primaryKey).map((column) => `${column} = excluded.${column}`).join(", ");
      const sql = immutableTables.has(table)
        ? `insert or ignore into ${table} (${names}) values (${parameters})`
        : `insert into ${table} (${names}) values (${parameters}) on conflict(${primaryKey}) do update set ${updates}`;
      const statement = db.prepare(sql);
      for (const row of rows) {
        const values = {};
        for (const column of columns) values[column] = foreignUserColumns.has(column) ? null : (row[column] ?? null);
        statement.run(values);
      }
    }
    const record = db.prepare(`insert into local_shared_sync_state(table_name, generation, synced_at, shared_root)
      values (?, ?, ?, ?)
      on conflict(table_name) do update set generation = excluded.generation, synced_at = excluded.synced_at`);
    for (const table of changedTables) record.run(table, manifest.tables[table].generation, new Date().toISOString(), store.root);
  });
  apply();
  return { generation: manifest.generation, changed: true, counts: Object.fromEntries(changedTables.map((table) => [table, snapshots.get(table).length])) };
}
