import { randomUUID } from "node:crypto";
import { SharedDataError } from "./shared-data-store.mjs";
import { pullSharedCatalog } from "./shared-catalog-sync.mjs";

export async function syncSharedMachines(db, store) {
  return pullSharedCatalog(db, { store, tables: ["local_machines"] });
}

export async function saveSharedMachine(db, store, input) {
  await syncSharedMachines(db, store);
  const manifest = await store.readManifest();
  const snapshot = await store.readTableFromManifest("local_machines", manifest);
  const rows = snapshot.rows;
  const existing = input.id ? rows.find((row) => row.id === input.id) : null;
  if (input.id && !existing) throw new SharedDataError("Esta prensa não existe na versão compartilhada. Atualize a tela.", 409);
  if (rows.some((row) => row.code.toUpperCase() === input.code.toUpperCase() && row.id !== input.id)) {
    throw new SharedDataError("Já existe uma prensa com este código na base compartilhada.", 409);
  }
  const id = existing?.id || randomUUID();
  const timestamp = new Date().toISOString();
  const row = {
    id,
    code: input.code,
    name: input.name,
    capacity_tons: input.capacity_tons ?? null,
    is_active: input.is_active ? 1 : 0,
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
  };
  const nextRows = existing ? rows.map((item) => item.id === id ? row : item) : [...rows, row];
  await store.publishTable("local_machines", nextRows, manifest.generation);
  await syncSharedMachines(db, store);
  return id;
}
