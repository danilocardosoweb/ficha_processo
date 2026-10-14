import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import properLockfile from "proper-lockfile";

const directoryParts = [".tecnomes", "shared-data"];

export class SharedDataError extends Error {
  constructor(message, status = 503) {
    super(message);
    this.name = "SharedDataError";
    this.status = status;
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function validName(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(value);
}

function emptyManifest() {
  return { schemaVersion: 1, generation: 0, tables: {}, events: [] };
}

function validateManifest(value) {
  if (!value || typeof value !== "object" || value.schemaVersion !== 1 || !Number.isSafeInteger(value.generation) || value.generation < 0 || !value.tables || typeof value.tables !== "object" || !Array.isArray(value.events)) {
    throw new SharedDataError("A base compartilhada está incompleta ou em formato desconhecido. Nenhuma gravação foi feita.");
  }
  for (const [name, table] of Object.entries(value.tables)) {
    if (!validName(name) || !table || !Number.isSafeInteger(table.generation) || !/^tables\/[a-z0-9_-]+\.json$/.test(table.file) || !/^[a-f0-9]{64}$/.test(table.sha256) || !Number.isSafeInteger(table.count) || table.count < 0) {
      throw new SharedDataError("O índice das tabelas compartilhadas está inválido. Nenhuma gravação foi feita.");
    }
  }
  for (const event of value.events) {
    if (!event || !Number.isSafeInteger(event.generation) || !/^events\/[a-z0-9_-]+\.json$/.test(event.file) || !/^[a-f0-9]{64}$/.test(event.sha256)) {
      throw new SharedDataError("O índice de eventos compartilhados está inválido. Nenhuma gravação foi feita.");
    }
  }
  return value;
}

export function createSharedDataStore(root = process.env.TECNOMES_SHARED_APP_ROOT || "W:\\App_Prensa") {
  if (!isAbsolute(root)) throw new SharedDataError("O endereço da base compartilhada precisa ser absoluto.");
  const directory = join(root, ...directoryParts);
  const manifestPath = join(directory, "manifest.json");

  async function ensure() {
    try {
      if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
      await mkdir(join(directory, "tables"), { recursive: true });
      await mkdir(join(directory, "events"), { recursive: true });
      try {
        await writeFile(manifestPath, JSON.stringify(emptyManifest()), { encoding: "utf8", flag: "wx" });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    } catch {
      throw new SharedDataError(`A pasta ${root} não está disponível para leitura e gravação. A operação compartilhada foi bloqueada.`);
    }
  }

  async function readManifest() {
    await ensure();
    try {
      return validateManifest(JSON.parse(await readFile(manifestPath, "utf8")));
    } catch (error) {
      if (error instanceof SharedDataError) throw error;
      throw new SharedDataError("Não foi possível conferir o índice da base compartilhada.");
    }
  }

  async function writeImmutable(subdirectory, name, body) {
    const file = join(directory, subdirectory, name);
    await writeFile(file, body, { flag: "wx" });
    return { file: `${subdirectory}/${name}`, sha256: digest(body) };
  }

  async function commitManifest(manifest) {
    const temporary = `${manifestPath}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(manifest), { flag: "wx" });
    await rename(temporary, manifestPath);
  }

  async function locked(operation) {
    await ensure();
    let compromised = false;
    let release;
    try {
      release = await properLockfile.lock(manifestPath, {
        realpath: false,
        stale: 120_000,
        update: 30_000,
        retries: { retries: 4, minTimeout: 100, maxTimeout: 500 },
        onCompromised: () => { compromised = true; },
      });
      const manifest = await readManifest();
      const result = await operation(manifest, () => compromised);
      if (compromised) throw new SharedDataError("A conexão com a pasta compartilhada oscilou; confirme o estado antes de tentar novamente.");
      return result;
    } catch (error) {
      if (error instanceof SharedDataError) throw error;
      if (error.code === "ELOCKED") throw new SharedDataError("Outra estação está gravando. Aguarde e tente novamente.", 409);
      const failure = new SharedDataError("Não foi possível confirmar a gravação compartilhada; verifique a rede e releia os dados.");
      failure.cause = error;
      throw failure;
    } finally {
      if (release && !compromised) {
        try { await release(); } catch { /* a próxima leitura confere o índice */ }
      }
    }
  }

  async function publishTable(name, rows, expectedGeneration) {
    return publishTables({ [name]: rows }, expectedGeneration);
  }

  async function publishTables(tables, expectedGeneration) {
    if (!tables || typeof tables !== "object" || Array.isArray(tables) || Object.keys(tables).length === 0 || Object.entries(tables).some(([name, rows]) => !validName(name) || !Array.isArray(rows))) {
      throw new SharedDataError("Nome de tabela ou registros inválidos.", 400);
    }
    return locked(async (manifest, isCompromised) => {
      if (manifest.generation !== expectedGeneration) throw new SharedDataError("Os dados mudaram em outra estação. Atualize antes de gravar.", 409);
      const generation = manifest.generation + 1;
      const updates = {};
      for (const [name, rows] of Object.entries(tables)) {
        const body = JSON.stringify({ schemaVersion: 1, name, generation, rows });
        const pointer = await writeImmutable("tables", `${name}-${generation}-${randomUUID()}.json`, body);
        updates[name] = { ...pointer, generation, count: rows.length };
      }
      if (isCompromised()) throw new SharedDataError("A trava compartilhada foi perdida; nenhuma versão nova foi confirmada.");
      Object.assign(manifest.tables, updates);
      manifest.generation = generation;
      await commitManifest(manifest);
      return generation;
    });
  }

  async function appendEvent(event, expectedGeneration) {
    if (!event || typeof event !== "object" || typeof event.type !== "string" || typeof event.actor !== "string" || !validName(event.type)) {
      throw new SharedDataError("Evento operacional inválido.", 400);
    }
    return locked(async (manifest, isCompromised) => {
      if (manifest.generation !== expectedGeneration) throw new SharedDataError("Os dados mudaram em outra estação. Atualize antes de gravar.", 409);
      const generation = manifest.generation + 1;
      const body = JSON.stringify({ ...event, schemaVersion: 1, id: randomUUID(), generation, occurredAt: new Date().toISOString() });
      const pointer = await writeImmutable("events", `${String(generation).padStart(12, "0")}-${randomUUID()}.json`, body);
      if (isCompromised()) throw new SharedDataError("A trava compartilhada foi perdida; nenhum evento novo foi confirmado.");
      manifest.events.push({ ...pointer, generation });
      manifest.generation = generation;
      await commitManifest(manifest);
      return generation;
    });
  }

  async function readVerified(pointer) {
    const file = join(directory, pointer.file);
    if (!/^(tables|events)\/[a-z0-9_-]+\.json$/.test(pointer.file)) throw new SharedDataError("Caminho de dados compartilhados inválido.");
    const body = await readFile(file, "utf8");
    if (digest(body) !== pointer.sha256) throw new SharedDataError("A base compartilhada falhou na conferência de integridade.");
    return JSON.parse(body);
  }

  async function readTable(name) {
    if (!validName(name)) throw new SharedDataError("Nome de tabela inválido.", 400);
    const manifest = await readManifest();
    return readTableFromManifest(name, manifest);
  }

  async function readTableFromManifest(name, manifest) {
    if (!validName(name)) throw new SharedDataError("Nome de tabela inválido.", 400);
    validateManifest(manifest);
    const pointer = manifest.tables[name];
    const snapshot = pointer ? await readVerified(pointer) : null;
    if (snapshot && (snapshot.name !== name || snapshot.generation !== pointer.generation || !Array.isArray(snapshot.rows) || snapshot.rows.length !== pointer.count)) {
      throw new SharedDataError(`Snapshot incompatível com o índice: ${name}.`);
    }
    return { generation: manifest.generation, rows: snapshot?.rows ?? [] };
  }

  async function readEvents(afterGeneration = 0) {
    const manifest = await readManifest();
    const pointers = manifest.events.filter((event) => event.generation > afterGeneration);
    return { generation: manifest.generation, events: await Promise.all(pointers.map(readVerified)) };
  }

  return { root, directory, readManifest, publishTable, publishTables, appendEvent, readTable, readTableFromManifest, readEvents };
}
