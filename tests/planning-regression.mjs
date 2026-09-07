import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";
const requireExternal = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cache = new Map();
function load(relative) {
  const file = path.resolve(__dirname, "..", relative);
  if (cache.has(file)) return cache.get(file).exports;
  const loadedModule = { exports: {} };
  cache.set(file, loadedModule);
  const js = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const resolve = name => name.startsWith("@/")
    ? load("src/" + name.slice(2) + ".ts") : requireExternal(name);
  new Function("require", "module", "exports", js)(resolve, loadedModule, loadedModule.exports);
  return loadedModule.exports;
}
const productivity = load("src/modules/planning/productivity.ts");
const { selectPhysicalTool } = load("src/modules/planning/tool-selection.ts");
test("produtividade: formatos brasileiros, histórico e limite físico", () => {
  for (const [value, expected] of [[1300, 1300], ["1.300", 1300], ["1.300,5", 1300.5],
    ["1300.5", 1300.5], ["1.300 kg/h", 1300], ["1479/1290/", 1384.5], [2500, 2500]]) {
    assert.equal(productivity.normalizeProductivityKgH(value), expected);
  }
  for (const value of [null, "", 0, -1, 2501, 29523.853, 94933.152, Infinity, "texto"]) {
    assert.equal(productivity.normalizeProductivityKgH(value), null);
    assert.equal(productivity.safeProductivityKgH(value), 1300);
  }
});
test("carcaça: sequência física 008, código normalizado e cadastro depois da primeira página", () => {
  const tool = (sequence, carcass, available = false) => ({
    code: "HIST:TCG-012:" + sequence, matrix_code: "TCG-012",
    sequence_number: sequence, source_available: available, carcass_code: carcass,
  });
  const tools = [...Array.from({ length: 1200 }, (_, i) => ({ ...tool(i, "228X130"), matrix_code: "OUTRA" })),
    tool(1, "232X228"), tool(4, "228X170"), tool(8, "250X170", true)];
  assert.equal(selectPhysicalTool(tools, "tcg012", 8).carcass_code, "250X170");
  assert.equal(selectPhysicalTool(tools, "TCG-012", null).sequence_number, 8);
  assert.equal(selectPhysicalTool(tools, "TCG-012", 14), undefined);
  assert.equal(selectPhysicalTool([tool(1, "232X228"), tool(4, "228X170")], "TCG-012", null), undefined);
});
test("motor usa 1.300 kg/h quando a entrada é inválida", () => {
  const { simulateMachineLoad } = load("src/modules/planning/machine-load-simulator.ts");
  const start = new Date("2026-09-07T09:00:00Z");
  const order = {
    id: "test", orderNumber: "test", planCode: "test", machineCode: "18",
    toolCode: "TCG-012", alloyCode: "6060", alternativeAlloys: [], targetKg: 1300,
    producedKg: 0, sequence: 1, dueDate: null, status: "planned",
    productivityKgH: 94933, productivitySource: "simplificada",
    toolReadyAt: start, toolHeatingState: "released", carcassCode: "250X170",
  };
  const setting = { billetBarWeightKg: 415, extrusionEfficiency: 0.85,
    defaultProductivityKgH: 1300, setupMinutes: 0, alloyChangeMinutes: 0,
    toolHeatingMinutes: 0, ovenCount: 1, ovenSlotsPerOven: 7, ovenSlots: 7 };
  const shifts = [{ id: "test", code: "A", name: "Teste", startTime: "00:00",
    endTime: "23:59", breakMinutes: 0, machineCodes: ["18"], isActive: true }];
  const result = simulateMachineLoad([order], { "18": setting }, start, "fifo", shifts, [],
    { carcasses: [{ code: "250X170", capacity: 0, totalQuantity: 24,
      unavailableQuantity: 24, reservations: [] }], bos: [] });
  const item = result.machines[0].items[0];
  assert.equal(item.productivityKgH, 1300);
  assert.equal(item.theoreticalMinutes, 60);
  assert.match(item.resourceConflicts.find(c => c.type === "carcass-capacity").message,
    /cadastrada no estoque físico.*24/);
});
