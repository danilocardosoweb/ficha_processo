import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { createSharedDataStore } from "../src/lib/local-db/shared-data-store.mjs";

const root = resolve(process.env.TECNOMES_SHARED_APP_ROOT || "W:\\App_Prensa");
const probeRoot = resolve(join(root, `.tecnomes-probe-${randomUUID()}`));
if (!probeRoot.startsWith(`${root}${sep}`) || !basename(probeRoot).startsWith(".tecnomes-probe-")) {
  throw new Error("O caminho de teste está fora da pasta compartilhada.");
}
if (!(await stat(root)).isDirectory()) throw new Error("A pasta compartilhada não está acessível.");

await mkdir(probeRoot, { recursive: false });
try {
  const first = createSharedDataStore(probeRoot);
  const second = createSharedDataStore(probeRoot);
  assert.equal(await first.publishTable("probe", [{ station: "first" }], 0), 1);
  assert.equal((await second.readTable("probe")).rows[0].station, "first");
  const outcomes = await Promise.allSettled([
    first.appendEvent({ type: "probe_write", actor: "first" }, 1),
    second.appendEvent({ type: "probe_write", actor: "second" }, 1),
  ]);
  assert.equal(outcomes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((result) => result.status === "rejected").length, 1);
  assert.equal((await first.readManifest()).generation, 2);
  process.stdout.write(`OK: leitura, gravação, troca de versão e conflito conferidos em ${root}.\n`);
} finally {
  await rm(probeRoot, { recursive: true, force: true });
}
