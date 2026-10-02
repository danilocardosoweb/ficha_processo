import { normalizeProductivityKgH, DEFAULT_PRODUCTIVITY_KG_H } from "@/modules/planning/productivity";
import { selectPhysicalTool } from "@/modules/planning/tool-selection";

export interface ToolRecord {
  code: string; matrix_code: string | null; sequence_number: number | null;
  source_available: boolean | null; carcass_code: string | null;
  bo: string | null; productivity_kg_h: number | null;
  tool_type?: "solid" | "tubular" | null;
}
export interface OrderRecord {
  id: string; order_number: string; machine_code: string; tool_code: string;
  sequence: number | null; alloy_code: string | null; target_kg: number | null;
  produced_kg: number | null; status: string; carcass_code: string | null;
  bo_code: string | null; last_productivity_kg_h: number | null;
  actual_start: string | null; source_data: Record<string, unknown> | null;
}
export interface ProgramRow {
  id: string; order: string; press: string; tool: string; physicalSequence: number | null;
  position: number | null; alloy: string | null; remainingKg: number | null;
  status: string; carcass: string | null; bo: string | null;
  carcassSource: string; boSource: string; productivity: number; productivitySource: string;
  productiveMinutes: number | null; actualStart: string | null; issues: string[];
  toolType: "solid" | "tubular" | "unknown";
}
export interface ProgramSnapshot {
  readAt: string; rows: ProgramRow[]; warnings: string[]; error: string | null;
  resources?: import("./evaluator").TemporalResourceSnapshot;
  evaluation?: import("./evaluator").TemporalEvaluation;
}
const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;
const amount = (value: unknown) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export function buildProgram(orders: OrderRecord[], tools: ToolRecord[]): ProgramRow[] {
  return orders.map(order => {
    const source = order.source_data ?? {};
    const requested = amount(source.sequencia ?? source.sequenceNumber ?? source.toolSequence);
    const physicalSequence = requested && Number.isInteger(requested) ? requested : null;
    const tool = selectPhysicalTool(tools, order.tool_code, physicalSequence);
    const carcass = text(order.carcass_code) ?? text(tool?.carcass_code);
    const bo = text(order.bo_code) ?? text(tool?.bo);
    const target = amount(order.target_kg), produced = amount(order.produced_kg);
    const remainingKg = target !== null && produced !== null ? Math.max(target - produced, 0) : null;
    const imported = normalizeProductivityKgH(order.last_productivity_kg_h);
    const registered = normalizeProductivityKgH(tool?.productivity_kg_h);
    const productivity = imported ?? registered ?? DEFAULT_PRODUCTIVITY_KG_H;
    const issues: string[] = [];
    if (!carcass) issues.push("Carcaça exigida não identificada");
    if (!bo) issues.push("BO exigido não identificado");
    if (!tool) issues.push("Configuração física da ferramenta a confirmar");
    if (order.carcass_code && tool?.carcass_code && order.carcass_code.toUpperCase() !== tool.carcass_code.toUpperCase()) issues.push("Carcaça da ordem diverge do cadastro físico");
    if (order.bo_code && tool?.bo && order.bo_code.toUpperCase() !== tool.bo.toUpperCase()) issues.push("BO da ordem diverge do cadastro físico");
    if (remainingKg === null) issues.push("Volume restante a confirmar");
    if (!text(order.alloy_code)) issues.push("Liga não informada");
    if (order.sequence === null) issues.push("Posição oficial não informada");
    const toolType: ProgramRow["toolType"] = tool?.tool_type ?? "unknown";
    if (toolType === "unknown") issues.push("Tipo sólida/tubular a confirmar");
    return {
      id: order.id, order: order.order_number, press: order.machine_code, tool: order.tool_code,
      physicalSequence, position: order.sequence, alloy: text(order.alloy_code), remainingKg,
      status: order.status, carcass, bo, carcassSource: text(order.carcass_code) ? "Ordem" : tool?.carcass_code ? "Cadastro físico" : "Não identificada",
      boSource: text(order.bo_code) ? "Ordem" : tool?.bo ? "Cadastro físico" : "Não identificado",
      productivity, productivitySource: imported !== null ? "Última produtividade da ordem" : registered !== null ? "Cadastro da ferramenta" : "Padrão estimado",
      productiveMinutes: remainingKg === null ? null : remainingKg / productivity * 60,
      actualStart: order.actual_start, issues, toolType,
    };
  }).sort((a, b) => a.press.localeCompare(b.press, "pt-BR", { numeric: true }) || (a.position ?? Infinity) - (b.position ?? Infinity) || a.id.localeCompare(b.id));
}

export interface ScenarioChange {
  id: string; order: string; press: string; from: number | null; to: number;
  reason: string;
}
export interface RuleScenario {
  generatedAt: string; rows: ProgramRow[]; changes: ScenarioChange[];
  blockedReasons: string[]; title: string;
  evaluation?: import("./evaluator").TemporalEvaluation;
}

/** Move uma ordem na cópia do cenário. Nunca move ordem já iniciada nem cruza prensas. */
export function moveScenarioRow(scenario: RuleScenario, rowId: string, direction: -1 | 1, reason: string): RuleScenario {
  const rows = [...scenario.rows];
  const index = rows.findIndex(row => row.id === rowId);
  if (index < 0 || rows[index]?.actualStart || !reason.trim()) return scenario;
  const row = rows[index];
  const candidates = rows.map((candidate, candidateIndex) => ({ candidate, candidateIndex })).filter(item => item.candidate.press === row.press && !item.candidate.actualStart);
  const localIndex = candidates.findIndex(item => item.candidateIndex === index);
  const target = candidates[localIndex + direction];
  if (!target) return scenario;
  [rows[index], rows[target.candidateIndex]] = [rows[target.candidateIndex], rows[index]];
  const normalized = rows.map(candidate => candidate.press === row.press ? { ...candidate, position: rows.filter(item => item.press === candidate.press).indexOf(candidate) + 1 } : candidate);
  const changes = normalized.flatMap(candidate => {
    const previous = scenario.changes.find(change => change.id === candidate.id);
    const originalPosition = previous?.from ?? scenario.rows.find(item => item.id === candidate.id)?.position ?? null;
    return originalPosition !== candidate.position ? [{ id: candidate.id, order: candidate.order, press: candidate.press, from: originalPosition, to: candidate.position ?? 0, reason: candidate.id === rowId ? reason.trim() : previous?.reason ?? "Ajuste manual na cópia do cenário." }] : [];
  });
  return { ...scenario, rows: normalized, changes };
}

/** Prévia explicável e estável; não é autorização nem otimização global. */
export function generateRulePreview(rows: ProgramRow[]): RuleScenario {
  const generatedAt = new Date().toISOString();
  const changes: ScenarioChange[] = [];
  const blockedReasons = [...new Set(rows.flatMap(row => row.issues.filter(issue =>
    issue.includes("Carcaça") || issue.includes("BO") || issue.includes("forno") || issue.includes("Tipo"))))];
  const output: ProgramRow[] = [];
  const presses = [...new Set(rows.map(row => row.press))];
  for (const press of presses) {
    const group = rows.filter(row => row.press === press);
    const movable = group.filter(row => !row.actualStart);
    const sorted = [...movable].sort((left, right) =>
      (left.alloy ?? "ZZZ").localeCompare(right.alloy ?? "ZZZ", "pt-BR") ||
      (left.position ?? Infinity) - (right.position ?? Infinity) ||
      left.id.localeCompare(right.id));
    const movableBySlot = [...sorted];
    const proposed = group.map(original => {
      if (original.actualStart) return original;
      return movableBySlot.shift() ?? original;
    });
    proposed.forEach((row, index) => {
      const position = index + 1;
      if (row.position !== position) {
        changes.push({ id: row.id, order: row.order, press, from: row.position, to: position, reason: "Agrupa ligas consecutivas para reduzir trocas; requer validação de recursos." });
      }
      output.push({ ...row, position });
    });
  }
  return { generatedAt, rows: output, changes, blockedReasons, title: "Prévia por regras · agrupamento de ligas" };
}
