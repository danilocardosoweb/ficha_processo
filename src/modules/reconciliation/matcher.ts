// Node's strip-types test runner needs the extension; Next/TypeScript resolves the sibling TS module normally.
// @ts-expect-error TS5097: the extension is intentional for the standalone matcher test.
import { normalizeDate, normalizePress, normalizeText, normalizeTime, normalizeTool } from "./normalizers.ts";

export type MatcherClassification = "EXACT" | "HIGH_CONFIDENCE" | "PROBABLE" | "AMBIGUOUS" | "UNMATCHED";

export type MatcherExternalRecord = {
  id: string;
  productionDate?: string | null;
  startTime?: string | null;
  machineCode?: string | null;
  toolCode?: string | null;
  toolSequence?: number | null;
  orderNumber?: string | null;
  alloyCode?: string | null;
};

export type MatcherExecution = {
  id: string;
  completedAt?: string | null;
  startedAt?: string | null;
  machineCode?: string | null;
  toolCode?: string | null;
  toolSequence?: number | null;
  orderNumber?: string | null;
  alloyCode?: string | null;
};

export type MatchReason = { field: string; points: number; detail: string };
export type MatchCandidate = { executionId: string; score: number; classification: MatcherClassification; reasons: MatchReason[] };
export type MatchDecision = {
  externalId: string;
  classification: MatcherClassification;
  selected: MatchCandidate | null;
  candidates: MatchCandidate[];
  requiresReview: boolean;
};

function dateOf(value: string | null | undefined) { return normalizeDate(value); }
function timeMinutes(value: string | null | undefined) {
  const time = normalizeTime(value);
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}
function dateTimeMinutes(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getHours() * 60 + parsed.getMinutes();
}

function classify(score: number, margin: number): MatcherClassification {
  if (score >= 95) return "EXACT";
  if (margin < 8 && score >= 55) return "AMBIGUOUS";
  if (score >= 80) return "HIGH_CONFIDENCE";
  if (score >= 60) return "PROBABLE";
  return "UNMATCHED";
}

export function scoreMatch(external: MatcherExternalRecord, execution: MatcherExecution): MatchCandidate {
  const reasons: MatchReason[] = [];
  const externalTool = normalizeTool(external.toolCode, external.toolSequence);
  const executionTool = normalizeTool(execution.toolCode, execution.toolSequence);
  const externalOrder = normalizeText(external.orderNumber).replace(/\s/g, "");
  const executionOrder = normalizeText(execution.orderNumber).replace(/\s/g, "");
  const externalDate = dateOf(external.productionDate);
  const executionDate = dateOf(execution.completedAt ?? execution.startedAt);
  const externalTime = timeMinutes(external.startTime);
  const executionTime = dateTimeMinutes(execution.startedAt ?? execution.completedAt);

  if (externalOrder && executionOrder && externalOrder === executionOrder) reasons.push({ field: "order_number", points: 40, detail: "OP igual" });
  if (normalizePress(external.machineCode) && normalizePress(external.machineCode) === normalizePress(execution.machineCode)) reasons.push({ field: "machine_code", points: 20, detail: "Prensa igual" });
  if (externalTool.base && externalTool.base === executionTool.base) reasons.push({ field: "tool_code", points: 20, detail: "Ferramenta igual" });
  if (externalTool.sequence != null && executionTool.sequence != null && externalTool.sequence === executionTool.sequence) reasons.push({ field: "tool_sequence", points: 10, detail: "Sequência igual" });
  if (externalDate && executionDate && externalDate === executionDate) reasons.push({ field: "production_date", points: 10, detail: "Data igual" });
  if (external.alloyCode && execution.alloyCode && normalizeText(external.alloyCode) === normalizeText(execution.alloyCode)) reasons.push({ field: "alloy_code", points: 5, detail: "Liga igual" });
  if (externalTime != null && executionTime != null) {
    const delta = Math.abs(externalTime - executionTime);
    if (delta <= 10) reasons.push({ field: "start_time", points: 10, detail: "Horário próximo (até 10 min)" });
    else if (delta <= 30) reasons.push({ field: "start_time", points: 5, detail: "Horário próximo (até 30 min)" });
  }
  const score = Math.min(100, reasons.reduce((total, reason) => total + reason.points, 0));
  return { executionId: execution.id, score, classification: classify(score, 100), reasons };
}

export function decideMatch(external: MatcherExternalRecord, executions: MatcherExecution[]): MatchDecision {
  const candidates = executions
    .map((execution) => scoreMatch(external, execution))
    .sort((a, b) => b.score - a.score || a.executionId.localeCompare(b.executionId));
  const best = candidates[0] ?? null;
  const second = candidates[1] ?? null;
  const margin = best && second ? best.score - second.score : 100;
  const classification = best ? classify(best.score, margin) : "UNMATCHED";
  const selected = best && classification !== "AMBIGUOUS" && classification !== "UNMATCHED" ? { ...best, classification } : null;
  return { externalId: external.id, classification, selected, candidates: candidates.slice(0, 5).map((candidate) => ({ ...candidate, classification: classify(candidate.score, margin) })), requiresReview: !selected || classification === "PROBABLE" };
}
