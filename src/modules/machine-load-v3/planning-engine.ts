import type { V3Order } from "./domain";
import type { TemporalResourceSnapshot } from "../machine-load-v2/evaluator";

export interface PlanningEngineConfig {
  maxCandidatesPerMachine: number;
  lookAheadDepth: number;
  beamWidth: number;
  lookAheadHours: number;
  defaultHeatingMinutes: number;
  lowVolumeKg: number;
}

export const defaultPlanningEngineConfig: PlanningEngineConfig = {
  maxCandidatesPerMachine: 5, lookAheadDepth: 4, beamWidth: 5,
  lookAheadHours: 8, defaultHeatingMinutes: 240, lowVolumeKg: 300,
};

export function configForOrderCount(orderCount: number, base = defaultPlanningEngineConfig): PlanningEngineConfig {
  if (orderCount <= 30) return { ...base, lookAheadDepth: Math.max(base.lookAheadDepth, 5) };
  if (orderCount <= 80) return { ...base };
  if (orderCount <= 160) return { ...base, maxCandidatesPerMachine: Math.min(base.maxCandidatesPerMachine, 4), lookAheadDepth: Math.min(base.lookAheadDepth, 3), beamWidth: Math.min(base.beamWidth, 4) };
  return { ...base, maxCandidatesPerMachine: 3, lookAheadDepth: 2, beamWidth: 3, lookAheadHours: 6 };
}

export interface PressPlanningState {
  press: string;
  currentOrderId: string | null;
  availableAt: number;
  queue: string[];
}

export interface ResourcePool { code: string; total: number; reserved: number; inUse: number; available: number; }
export interface FurnaceSlot { furnace: string; position: number; toolId: string | null; heatingReadyAt: number | null; readyAt: number | null; destinationPress: string | null; }

export interface PlanningState {
  now: number;
  presses: Record<string, PressPlanningState>;
  orders: V3Order[];
  consumedOrderIds: string[];
  events: PlanningEvent[];
  bo: Record<string, ResourcePool>;
  carcasses: Record<string, ResourcePool>;
  furnaces: FurnaceSlot[];
  toolCompatibility: Record<string, string[]>;
}

export type PlanningEvent = { at: number; type: "press_available" | "tool_ready" | "resource_released"; resource?: string };

export interface HardConstraintResult { allowed: boolean; reasons: string[]; }
export interface PlanningCandidate {
  orderId: string; press: string; estimatedMinutes: number; preScore: number; resourcePenalty: number;
  reasons: string[]; hardRejected: boolean;
}
export interface PlanningDecision { press: string; candidate: PlanningCandidate; score: number; reasons: string[]; lookAheadDepth: number; }
export interface PlanningDecisionLog { timestamp: string; press: string; selectedOrderId: string; selectedScore: number; lookAheadDepth: number; candidatesEvaluated: number; decisionReasons: string[]; penalties: string[]; risksBefore: string[]; risksAfter: string[]; }
export interface CandidateInspection { candidate: PlanningCandidate; rejected: boolean; rejectionReasons: string[]; }
export interface PlanningRunSummary { name: string; decisions: number; totalMinutes: number; resourcePenalties: number; highRiskPresses: number; starvationCount: number; }
export interface PlanningRunComparison { baseline: PlanningRunSummary; lookAhead: PlanningRunSummary; differences: { decisions: number; totalMinutes: number; resourcePenalties: number; highRiskPresses: number; starvationCount: number }; conclusion: string; }
export interface PlanningTimelineBlock { press: string; orderId: string; startAt: string; endAt: string; durationMinutes: number; gapBeforeMinutes: number; }

export interface PlanningResourceInput { bo?: Array<{ code: string; total: number; reserved?: number; inUse?: number }>; carcasses?: Array<{ code: string; total: number; reserved?: number; inUse?: number }>; furnacesPerPress?: number; furnaceCount?: number; slotsPerFurnace?: number; toolCompatibility?: Record<string, string[]>; }

/** Converte o snapshot temporal lido da base para o contrato do motor, sem nova consulta. */
export function planningResourcesFromSnapshot(resources?: TemporalResourceSnapshot): PlanningResourceInput {
  const map = (items: TemporalResourceSnapshot["bos"] = []) => items.map((item) => ({
    code: item.code,
    total: Math.max(0, item.capacity ?? 0),
    reserved: Math.max(0, (item.reservations ?? []).reduce((sum, reservation) => sum + (reservation.quantity ?? 1), 0)),
  }));
  return { bo: map(resources?.bos), carcasses: map(resources?.carcaças), furnaceCount: resources?.fornos.length || undefined };
}

const resourceKey = (value: string) => value.trim().toUpperCase();
function pools(items: PlanningResourceInput["bo"] = []) {
  const grouped = new Map<string, { code: string; total: number; reserved: number; inUse: number }>();
  for (const item of items) {
    const code = resourceKey(item.code);
    const current = grouped.get(code) ?? { code, total: 0, reserved: 0, inUse: 0 };
    current.total += Math.max(0, item.total);
    current.reserved += Math.max(0, item.reserved ?? 0);
    current.inUse += Math.max(0, item.inUse ?? 0);
    grouped.set(code, current);
  }
  return Object.fromEntries([...grouped.values()].map((item) => [item.code, { ...item, available: Math.max(0, item.total - item.reserved - item.inUse) }]));
}

export function createPlanningState(orders: V3Order[], now = Date.now(), resources: PlanningResourceInput = {}): PlanningState {
  const presses = [...new Set(orders.flatMap((order) => order.eligiblePresses.length ? order.eligiblePresses : [order.currentPress]))].reduce<Record<string, PressPlanningState>>((all, press) => {
    all[press] = { press, currentOrderId: null, availableAt: now, queue: [] }; return all;
  }, {});
  const furnaceCount = resources.furnaceCount ?? (Object.keys(presses).length * (resources.furnacesPerPress ?? 3));
  const slotsPerFurnace = resources.slotsPerFurnace ?? 7;
  const pressCodes = Object.keys(presses);
  const furnaces = Array.from({ length: furnaceCount * slotsPerFurnace }, (_, index) => ({ furnace: `F${Math.floor(index / slotsPerFurnace) + 1}`, position: (index % slotsPerFurnace) + 1, toolId: null, heatingReadyAt: null, readyAt: null, destinationPress: pressCodes.length ? pressCodes[Math.floor(index / slotsPerFurnace) % pressCodes.length] : null }));
  return { now, presses, orders: orders.map((order) => ({ ...order, eligiblePresses: [...order.eligiblePresses] })), consumedOrderIds: [], events: [], bo: pools(resources.bo), carcasses: pools(resources.carcasses), furnaces, toolCompatibility: Object.fromEntries(Object.entries(resources.toolCompatibility ?? {}).map(([tool, presses]) => [tool.trim().toUpperCase(), presses.map((press) => press.trim())])) };
}

export function checkHardConstraints(order: V3Order, press: string, state: PlanningState): HardConstraintResult {
  const reasons: string[] = [];
  if (state.consumedOrderIds.includes(order.id)) reasons.push("Pedido já utilizado no cenário");
  if (order.status === "blocked" || order.status === "cancelled") reasons.push("Pedido bloqueado ou cancelado");
  if (order.zone === "frozen" && press !== order.currentPress) reasons.push("Operação congelada: não pode trocar de prensa");
  if (!order.eligiblePresses.includes(press)) reasons.push(`Ferramenta não elegível para a prensa ${press}`);
  const compatibility = state.toolCompatibility[order.tool.trim().toUpperCase()];
  if (compatibility && !compatibility.includes(press)) reasons.push(`Ferramenta ${order.tool} incompatível com a prensa ${press}`);
  if (order.issues.some((issue) => /incompatível|bloquead|proibid|inexistente/i.test(issue))) reasons.push("Existe uma restrição técnica impeditiva");
  if (!state.presses[press]) reasons.push("Prensa não cadastrada no estado");
  if (state.furnaces.length > 0 && !state.furnaces.some((slot) => slot.destinationPress === press)) reasons.push(`Nenhum slot de forno associado à prensa ${press}`);
  if (state.furnaces.length > 0 && !state.furnaces.some((slot) => slot.destinationPress === press && (!slot.toolId || (slot.readyAt !== null && slot.readyAt <= state.presses[press]?.availableAt)))) reasons.push(`Nenhuma posição livre de forno para a prensa ${press}`);
  const resourceOrder = order as V3Order & { boCode?: string; carcassCode?: string };
  const boCode = resourceOrder.boCode ? resourceKey(resourceOrder.boCode) : "";
  const carcassCode = resourceOrder.carcassCode ? resourceKey(resourceOrder.carcassCode) : "";
  if (boCode && Object.keys(state.bo).length > 0 && !state.bo[boCode]) reasons.push(`BO ${resourceOrder.boCode} não encontrado no catálogo carregado`);
  if (boCode && state.bo[boCode]?.available <= 0) reasons.push(`BO ${resourceOrder.boCode} sem disponibilidade`);
  if (carcassCode && Object.keys(state.carcasses).length > 0 && !state.carcasses[carcassCode]) reasons.push(`Carcaça ${resourceOrder.carcassCode} não encontrada no catálogo carregado`);
  if (carcassCode && state.carcasses[carcassCode]?.available <= 0) reasons.push(`Carcaça ${resourceOrder.carcassCode} sem disponibilidade`);
  return { allowed: reasons.length === 0, reasons };
}

function estimateMinutes(order: V3Order) {
  if (!order.remainingKg || order.remainingKg <= 0 || order.productivityKgH <= 0) return 0;
  return (order.remainingKg / order.productivityKgH) * 60;
}

export function generateCandidates(state: PlanningState, press: string, config = defaultPlanningEngineConfig): PlanningCandidate[] {
  return state.orders.map((order) => {
    const hard = checkHardConstraints(order, press, state);
    const minutes = estimateMinutes(order);
    const ageScore = Math.max(0, 100 - (order.officialPosition ?? 999));
    const deliveryScore = /atras|crític/i.test(order.status) ? 100 : 0;
    const volumeScore = Math.min(100, (order.remainingKg ?? 0) / Math.max(config.lowVolumeKg, 1) * 25);
    const resourceOrder = order as V3Order & { boCode?: string; carcassCode?: string; heatingReadyAt?: number | null };
    const heatingPenalty = resourceOrder.heatingReadyAt && resourceOrder.heatingReadyAt > state.now ? Math.min(60, (resourceOrder.heatingReadyAt - state.now) / 60_000) : 0;
    const bo = resourceOrder.boCode ? state.bo[resourceKey(resourceOrder.boCode)] : undefined;
    const carcass = resourceOrder.carcassCode ? state.carcasses[resourceKey(resourceOrder.carcassCode)] : undefined;
    const resourcePenalty = (bo ? Math.max(0, 10 - bo.available) * 4 : 0) + (carcass ? Math.max(0, 10 - carcass.available) * 2 : 0) + heatingPenalty;
    const preScore = ageScore * 0.45 + deliveryScore * 0.35 + volumeScore * 0.2 - resourcePenalty;
    return { orderId: order.id, press, estimatedMinutes: minutes, preScore, resourcePenalty, reasons: hard.reasons, hardRejected: !hard.allowed };
  }).filter((candidate) => !candidate.hardRejected).sort((a, b) => b.preScore - a.preScore).slice(0, config.maxCandidatesPerMachine);
}

export function inspectCandidates(state: PlanningState, press: string): CandidateInspection[] {
  return state.orders.map((order) => {
    const hard = checkHardConstraints(order, press, state);
    const estimatedMinutes = estimateMinutes(order);
    const resourceOrder = order as V3Order & { boCode?: string; carcassCode?: string };
    const bo = resourceOrder.boCode ? state.bo[resourceKey(resourceOrder.boCode)] : undefined;
    const carcass = resourceOrder.carcassCode ? state.carcasses[resourceKey(resourceOrder.carcassCode)] : undefined;
    const resourcePenalty = (bo ? Math.max(0, 10 - bo.available) * 4 : 0) + (carcass ? Math.max(0, 10 - carcass.available) * 2 : 0);
    const candidate = { orderId: order.id, press, estimatedMinutes, preScore: 0, resourcePenalty, reasons: hard.reasons, hardRejected: !hard.allowed };
    return { candidate, rejected: !hard.allowed, rejectionReasons: hard.reasons };
  }).sort((a, b) => Number(a.rejected) - Number(b.rejected));
}

function cloneState(state: PlanningState): PlanningState {
  return { ...state, presses: Object.fromEntries(Object.entries(state.presses).map(([key, value]) => [key, { ...value, queue: [...value.queue] }])), consumedOrderIds: [...state.consumedOrderIds], events: [...state.events], bo: Object.fromEntries(Object.entries(state.bo).map(([key, value]) => [key, { ...value }])), carcasses: Object.fromEntries(Object.entries(state.carcasses).map(([key, value]) => [key, { ...value }])), furnaces: state.furnaces.map((slot) => ({ ...slot })), toolCompatibility: Object.fromEntries(Object.entries(state.toolCompatibility).map(([tool, presses]) => [tool, [...presses]])) };
}

export function applyCandidate(state: PlanningState, candidate: PlanningCandidate): PlanningState {
  const next = cloneState(state); const press = next.presses[candidate.press];
  if (!press) return next;
  for (const slot of next.furnaces) {
    if (slot.destinationPress === candidate.press && slot.readyAt !== null && slot.readyAt <= press.availableAt) {
      slot.toolId = null;
      slot.heatingReadyAt = null;
      slot.readyAt = null;
    }
  }
  const order = next.orders.find((item) => item.id === candidate.orderId) as (V3Order & { boCode?: string; carcassCode?: string }) | undefined;
  const bo = order?.boCode ? next.bo[resourceKey(order.boCode)] : undefined;
  const carcass = order?.carcassCode ? next.carcasses[resourceKey(order.carcassCode)] : undefined;
  if (bo) { bo.available = Math.max(0, bo.available - 1); bo.inUse += 1; }
  if (carcass) { carcass.available = Math.max(0, carcass.available - 1); carcass.inUse += 1; }
  const slot = order ? next.furnaces.find((item) => item.destinationPress === candidate.press && (!item.toolId || (item.readyAt !== null && item.readyAt <= press.availableAt))) : undefined;
  const heatingReadyAt = slot?.toolId && slot.heatingReadyAt !== null ? slot.heatingReadyAt : Math.max(press.availableAt, next.now) + defaultPlanningEngineConfig.defaultHeatingMinutes * 60_000;
  const operationStart = Math.max(press.availableAt, next.now, heatingReadyAt);
  const operationEnd = operationStart + candidate.estimatedMinutes * 60_000;
  if (slot && order) { slot.toolId = order.tool; slot.heatingReadyAt = heatingReadyAt; slot.readyAt = operationEnd; }
  press.queue.push(candidate.orderId); press.currentOrderId = candidate.orderId;
  press.availableAt = operationEnd;
  next.consumedOrderIds.push(candidate.orderId);
  next.events.push({ at: press.availableAt, type: "press_available", resource: candidate.press });
  return next;
}

export function calculateProductionCoverage(state: PlanningState, press: string) {
  const available = state.orders.filter((order) => !state.consumedOrderIds.includes(order.id) && order.eligiblePresses.includes(press)).reduce((sum, order) => sum + estimateMinutes(order), 0);
  const nextReady = state.furnaces.filter((slot) => slot.destinationPress === press && slot.readyAt !== null).map((slot) => slot.readyAt as number).sort((a, b) => a - b)[0] ?? null;
  const heatingGapMinutes = nextReady === null ? 0 : Math.max(0, (nextReady - state.now) / 60_000 - available);
  return { coverageMinutes: available, heatingGapMinutes, risk: heatingGapMinutes > 0 ? "high" as const : available < 60 ? "medium" as const : "low" as const };
}

export function planningStateSignature(state: PlanningState) {
  const presses = Object.values(state.presses).sort((a, b) => a.press.localeCompare(b.press)).map((press) => `${press.press}:${press.currentOrderId ?? "-"}:${Math.round(press.availableAt / 60_000)}:${press.queue.join(",")}`).join("|");
  const bo = Object.values(state.bo).sort((a, b) => a.code.localeCompare(b.code)).map((item) => `${item.code}:${item.available}:${item.reserved}:${item.inUse}`).join("|");
  const carcasses = Object.values(state.carcasses).sort((a, b) => a.code.localeCompare(b.code)).map((item) => `${item.code}:${item.available}:${item.reserved}:${item.inUse}`).join("|");
  return `${Math.round(state.now / 60_000)}#${presses}#${bo}#${carcasses}#${state.consumedOrderIds.slice().sort().join(",")}`;
}

export function validatePlanningState(state: PlanningState): string[] {
  const errors: string[] = [];
  for (const [press, value] of Object.entries(state.presses)) {
    if (value.availableAt < state.now) errors.push(`Prensa ${press} possui disponibilidade anterior ao relógio da simulação`);
    if (value.queue.some((orderId) => !state.orders.some((order) => order.id === orderId))) errors.push(`Prensa ${press} contém pedido inexistente na fila`);
  }
  for (const pool of [...Object.values(state.bo), ...Object.values(state.carcasses)]) {
    if (pool.available < 0 || pool.reserved < 0 || pool.inUse < 0 || pool.available + pool.reserved + pool.inUse > pool.total) errors.push(`Recurso ${pool.code} possui saldo inconsistente`);
  }
  for (const slot of state.furnaces) {
    if (slot.heatingReadyAt !== null && slot.readyAt !== null && slot.heatingReadyAt > slot.readyAt) errors.push(`Slot ${slot.furnace}/${slot.position} libera antes do fim do aquecimento`);
  }
  return errors;
}

export function comparePlanningRuns(baseline: PlanningRunSummary, lookAhead: PlanningRunSummary): PlanningRunComparison {
  const differences = { decisions: lookAhead.decisions - baseline.decisions, totalMinutes: lookAhead.totalMinutes - baseline.totalMinutes, resourcePenalties: lookAhead.resourcePenalties - baseline.resourcePenalties, highRiskPresses: lookAhead.highRiskPresses - baseline.highRiskPresses, starvationCount: lookAhead.starvationCount - baseline.starvationCount };
  const improvement = differences.resourcePenalties <= 0 && differences.highRiskPresses <= 0 && differences.starvationCount <= 0;
  return { baseline, lookAhead, differences, conclusion: improvement ? "O Look Ahead reduz ou mantém os riscos avaliados em relação ao baseline." : "O Look Ahead precisa de calibração: houve aumento em um ou mais riscos avaliados." };
}

export function buildPlanningTimeline(state: PlanningState, decisions: PlanningDecision[]): PlanningTimelineBlock[] {
  const cursor = new Map(Object.keys(state.presses).map((press) => [press, state.now]));
  return decisions.map((decision) => {
    const start = cursor.get(decision.press) ?? state.now;
    const previous = state.presses[decision.press]?.availableAt ?? start;
    const gapBeforeMinutes = Math.max(0, (start - previous) / 60_000);
    const end = start + decision.candidate.estimatedMinutes * 60_000;
    cursor.set(decision.press, end);
    return { press: decision.press, orderId: decision.candidate.orderId, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), durationMinutes: decision.candidate.estimatedMinutes, gapBeforeMinutes };
  });
}

function stateScore(state: PlanningState) {
  const remaining = state.orders.length - state.consumedOrderIds.length;
  const imbalance = Math.max(...Object.values(state.presses).map((press) => press.availableAt), state.now) - Math.min(...Object.values(state.presses).map((press) => press.availableAt), state.now);
  return state.consumedOrderIds.length * 100 - remaining * 2 - imbalance / 60_000;
}

export function planWithLookAhead(initial: PlanningState, config = defaultPlanningEngineConfig): PlanningDecision[] {
  const visited = new Set<string>();
  let beam: Array<{ state: PlanningState; decisions: PlanningDecision[] }> = [{ state: initial, decisions: [] }];
  for (let depth = 0; depth < config.lookAheadDepth; depth += 1) {
    const expanded = beam.flatMap(({ state, decisions }) => Object.keys(state.presses).flatMap((press) => generateCandidates(state, press, config).map((candidate) => { const nextState = applyCandidate(state, candidate); const signature = planningStateSignature(nextState); if (visited.has(signature)) return null; visited.add(signature); return { state: nextState, decisions: [...decisions, { press, candidate, score: candidate.preScore, reasons: ["Passou pelas regras duras", "Avaliada no Look Ahead"], lookAheadDepth: depth + 1 }] }; }).filter(Boolean) as Array<{ state: PlanningState; decisions: PlanningDecision[] }>));
    if (!expanded.length) break;
    expanded.sort((a, b) => stateScore(b.state) - stateScore(a.state)); beam = expanded.slice(0, config.beamWidth);
  }
  return beam[0]?.decisions ?? [];
}

export function explainDecision(decision: PlanningDecision, state: PlanningState): PlanningDecisionLog {
  const risksBefore = Object.keys(state.presses).flatMap((press) => { const coverage = calculateProductionCoverage(state, press); return coverage.risk === "low" ? [] : [`Prensa ${press}: risco ${coverage.risk}, cobertura ${Math.round(coverage.coverageMinutes)} min`]; });
  const penalties = decision.candidate.resourcePenalty > 0 ? [`Penalidade de recursos/aquecimento: ${decision.candidate.resourcePenalty.toFixed(1)} pontos`] : [];
  return { timestamp: new Date().toISOString(), press: decision.press, selectedOrderId: decision.candidate.orderId, selectedScore: decision.score, lookAheadDepth: decision.lookAheadDepth, candidatesEvaluated: 0, decisionReasons: decision.reasons, penalties, risksBefore, risksAfter: risksBefore };
}
