import assert from "node:assert/strict";
import test from "node:test";
import { createPortfolioAnalysis } from "../src/modules/portfolio-intelligence/portfolio-priority-engine.ts";

const now = new Date("2026-09-29T12:00:00");
const order = (overrides = {}) => ({
  id: overrides.id ?? "order-1", orderKey: overrides.orderKey ?? "1001", orderNumber: overrides.orderNumber ?? "1001", toolCode: overrides.toolCode ?? "TP-8301", customerName: "Cliente A", productCode: "P-01", implantationDate: overrides.implantationDate ?? "2026-06-01", dueDate: overrides.dueDate ?? "2026-09-20", serviceUnit: "kg", orderedKg: 1000, orderedPieces: 0, balanceKg: overrides.balanceKg ?? 1000, balancePieces: 0, sourceStatus: overrides.sourceStatus ?? "Aberto", commercialPriority: null, overtakenCount: overrides.overtakenCount,
});
const tool = (status, available = null) => ({ toolCode: "TP-8301", status, sourceStatus: status, sourceAvailable: available });
const plan = (overrides = {}) => ({ id: "plan-1", orderNumber: "1001", toolCode: "TP-8301", targetKg: 1000, targetQuantity: null, demandUnit: "kg", ...overrides });
const analyze = (orders, tools = [tool("ESTOQUE")], activePlans = []) => createPortfolioAnalysis({ orders, tools, activePlans, history: [], now });

test("atrasado, não planejado e em estoque entra como ação imediata", () => {
  const row = analyze([order()]).rows[0];
  assert.equal(row.planningStatus, "NOT_PLANNED"); assert.equal(row.planningEligibility, "READY_TO_PLAN"); assert.equal(row.toolAvailability, "AVAILABLE"); assert.equal(row.priorityLevel, "CRITICAL");
});
test("atrasado e planejado em estoque fica como já planejado", () => {
  const row = analyze([order()], [tool("ESTOQUE")], [plan()]).rows[0];
  assert.equal(row.planningStatus, "PLANNED"); assert.equal(row.planningEligibility, "ALREADY_PLANNED");
});
test("ferramenta em limpeza aguarda ferramenta", () => {
  const row = analyze([order()], [tool("LIMPEZA")]).rows[0];
  assert.equal(row.toolAvailability, "TEMPORARILY_UNAVAILABLE"); assert.equal(row.planningEligibility, "WAITING_TOOL");
});
test("ferramenta em correção bloqueia programação", () => {
  const row = analyze([order()], [tool("CORREÇÃO INTERNA")]).rows[0];
  assert.equal(row.toolAvailability, "BLOCKED"); assert.equal(row.planningEligibility, "TOOL_BLOCKED");
});
test("entrega próxima e ferramenta disponível aumenta a prioridade", () => {
  const row = analyze([order({ dueDate: "2026-10-01" })]).rows[0];
  assert.equal(row.planningEligibility, "READY_TO_PLAN"); assert.ok(row.priorityScore >= 40);
});
test("FIFO mais antigo recebe prioridade maior", () => {
  const result = analyze([order({ id: "old", orderKey: "1001", orderNumber: "1001", implantationDate: "2026-01-01" }), order({ id: "new", orderKey: "1002", orderNumber: "1002", implantationDate: "2026-09-01" })]);
  const old = result.rows.find((row) => row.id === "old"); const newest = result.rows.find((row) => row.id === "new");
  assert.equal(old.fifoRank, 1); assert.ok(old.priorityScore > newest.priorityScore);
});
test("saldo zero não entra como não planejado", () => {
  const row = analyze([order({ balanceKg: 0, sourceStatus: "Atendido" })]).rows[0];
  assert.equal(row.planningStatus, "COMPLETED"); assert.equal(row.priorityScore, 0);
});
test("pedido atendido e atrasado é apontado para conferência, não para urgência", () => {
  const row = analyze([order({ balanceKg: 0, dueDate: "2026-09-20", sourceStatus: "Atendido" })]).rows[0];
  assert.equal(row.priorityScore, 0); assert.ok(row.inconsistencies.some((item) => item.includes("sem saldo aparece atrasado")));
});
test("planejamento parcial mantém saldo exposto", () => {
  const row = analyze([order()], [tool("ESTOQUE")], [plan({ targetKg: 400 })]).rows[0];
  assert.equal(row.planningStatus, "PARTIALLY_PLANNED"); assert.equal(row.unplannedUnit, 600); assert.equal(row.planningEligibility, "PARTIAL_PLANNING");
});
test("ferramenta sem status exige revisão", () => {
  const row = analyze([order()], []).rows[0];
  assert.equal(row.toolAvailability, "REQUIRES_ATTENTION"); assert.equal(row.planningEligibility, "REVIEW_REQUIRED"); assert.ok(row.inconsistencies.some((item) => item.includes("sem status")));
});
test("ultrapassagens aumentam a prioridade com motivo rastreável", () => {
  const withoutOvertakes = analyze([order({ overtakenCount: 0 })]).rows[0]; const withOvertakes = analyze([order({ overtakenCount: 3 })]).rows[0];
  assert.ok(withOvertakes.priorityScore > withoutOvertakes.priorityScore); assert.ok(withOvertakes.priorityReasons.some((item) => item.includes("ultrapassado 3")));
});
