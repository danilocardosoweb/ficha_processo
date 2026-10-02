/**
 * Motor determinístico da carteira.
 *
 * Não conhece React, banco ou LLM. Assim os mesmos fatos podem ser usados na
 * tela, nos snapshots e, futuramente, como contexto seguro do assistente.
 */

export type PlanningStatus = "NOT_PLANNED" | "PARTIALLY_PLANNED" | "PLANNED" | "COMPLETED" | "NO_BALANCE";
export type ToolAvailability = "AVAILABLE" | "TEMPORARILY_UNAVAILABLE" | "BLOCKED" | "IN_PROCESS" | "REQUIRES_ATTENTION";
export type PlanningEligibility = "READY_TO_PLAN" | "ALREADY_PLANNED" | "WAITING_TOOL" | "TOOL_BLOCKED" | "PARTIAL_PLANNING" | "REVIEW_REQUIRED" | "COMPLETED";
export type PriorityLevel = "CRITICAL" | "HIGH" | "NORMAL" | "MONITOR";
export type AttentionGroup = "IMMEDIATE" | "BLOCKED" | "FOLLOW_UP";

export type PortfolioOrderInput = {
  id: number | string;
  orderKey: string;
  orderNumber: string;
  toolCode: string | null;
  customerName: string | null;
  customerOrderNumber?: string | null;
  productCode: string | null;
  implantationDate: string | null;
  dueDate: string | null;
  serviceUnit: "kg" | "pieces" | null;
  orderedKg: number;
  orderedPieces: number;
  balanceKg: number;
  balancePieces: number;
  sourceStatus: string | null;
  commercialPriority: number | null;
  overtakenCount?: number | null;
};

export type ActivePlanInput = {
  id: string;
  orderNumber: string;
  toolCode: string;
  targetKg: number | null;
  targetQuantity: number | null;
  demandUnit: "kg" | "pieces" | "bars";
};

export type PlanningHistoryInput = {
  orderKey: string;
  planCount: number;
  lotCount: number;
  plannedKg: number;
  plannedPieces: number;
  fulfilledKg: number;
  fulfilledPieces: number;
  firstPlanDate: string | null;
};

export type ToolStatusInput = {
  toolCode: string;
  status: string | null;
  sourceStatus: string | null;
  sourceAvailable: boolean | null;
  physicalToolCount?: number;
  availableToolCount?: number;
};

export type PriorityWeights = {
  overdueBase: number;
  overduePerDay: number;
  deliveryToday: number;
  deliveryWithinThreeDays: number;
  deliveryWithinSevenDays: number;
  fifo: number;
  age: number;
  notPlanned: number;
  partialPlanning: number;
  toolAvailable: number;
  commercialPriority: number;
  overtakenPerOccurrence: number;
  temporarilyUnavailablePenalty: number;
  blockedPenalty: number;
  inProcessPenalty: number;
  missingToolStatusPenalty: number;
  inconsistentDataPenalty: number;
};

export const defaultPortfolioPriorityWeights: PriorityWeights = {
  overdueBase: 14,
  overduePerDay: 2.5,
  deliveryToday: 22,
  deliveryWithinThreeDays: 16,
  deliveryWithinSevenDays: 8,
  fifo: 16,
  age: 8,
  notPlanned: 20,
  partialPlanning: 10,
  toolAvailable: 16,
  commercialPriority: 10,
  overtakenPerOccurrence: 3,
  temporarilyUnavailablePenalty: 12,
  blockedPenalty: 32,
  inProcessPenalty: 8,
  missingToolStatusPenalty: 18,
  inconsistentDataPenalty: 6,
};

export type PortfolioAnalysisRow = PortfolioOrderInput & {
  balanceUnit: number;
  plannedUnit: number;
  plannedKg: number;
  unplannedUnit: number;
  planningPercent: number;
  planningStatus: PlanningStatus;
  toolAvailability: ToolAvailability;
  toolStatusLabel: string;
  planningEligibility: PlanningEligibility;
  priorityScore: number;
  priorityLevel: PriorityLevel;
  priorityReasons: string[];
  priorityPenalties: string[];
  daysToDue: number | null;
  daysLate: number;
  ageDays: number | null;
  fifoRank: number | null;
  history: PlanningHistoryInput | null;
  inconsistencies: string[];
};

export type ToolPortfolioSummary = {
  toolCode: string;
  customers: string[];
  totalOrders: number;
  overdueOrders: number;
  notPlannedOrders: number;
  partialOrders: number;
  criticalOrders: number;
  totalBalanceKg: number;
  unplannedBalanceKg: number;
  earliestDueDate: string | null;
  greatestDaysLate: number;
  toolAvailability: ToolAvailability;
  toolStatusLabel: string;
  group: AttentionGroup | null;
};

export type CustomerPortfolioSummary = {
  customerName: string;
  openOrders: number;
  overdueOrders: number;
  overdueBalanceKg: number;
  unplannedBalanceKg: number;
  atRiskOrders: number;
  tools: string[];
};

export type PortfolioInconsistency = { orderId: number | string; orderNumber: string; toolCode: string | null; message: string };

export type PortfolioAnalysis = {
  generatedAt: string;
  rows: PortfolioAnalysisRow[];
  immediate: PortfolioAnalysisRow[];
  blocked: PortfolioAnalysisRow[];
  followUp: PortfolioAnalysisRow[];
  inconsistencies: PortfolioInconsistency[];
  tools: ToolPortfolioSummary[];
  customers: CustomerPortfolioSummary[];
  summary: {
    openOrders: number;
    overdueOrders: number;
    notPlannedOrders: number;
    partialOrders: number;
    plannedOrders: number;
    immediateCount: number;
    blockedCount: number;
    followUpCount: number;
    inconsistencyCount: number;
  };
};

const number = (value: unknown) => Number(value ?? 0) || 0;
export const normalizePortfolioText = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const normalizedToolCode = (value: unknown) => {
  const key = normalizePortfolioText(value);
  return key.startsWith("SF") ? key.slice(2) : key;
};
const normalizedOrder = (value: unknown) => {
  const digits = String(value ?? "").replace(/\D/g, "").replace(/^0+/, "");
  return digits || normalizePortfolioText(value);
};
const dateAtNoon = (value: string) => new Date(`${value}T12:00:00`);
const day = 86_400_000;
const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / day);
const currentDay = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);

export function classifyToolAvailability(tool?: ToolStatusInput): { availability: ToolAvailability; label: string } {
  const raw = tool?.sourceStatus || tool?.status || "";
  const normalized = normalizePortfolioText(raw);
  if (!normalized) return { availability: "REQUIRES_ATTENTION", label: "Status da ferramenta não informado" };
  if (/ESTOQUE|DISPONIVEL|AVAILABLE|LIVRE/.test(normalized) && tool?.sourceAvailable !== false) return { availability: "AVAILABLE", label: raw };
  if (/LIMPEZA|NITREX|NITRET/.test(normalized)) return { availability: "TEMPORARILY_UNAVAILABLE", label: raw };
  if (/CORRECAO|BLOQUE|MORT/.test(normalized)) return { availability: "BLOCKED", label: raw };
  if (/PRENSA|PRODUCAO|EMUSO|TESTE/.test(normalized)) return { availability: "IN_PROCESS", label: raw };
  if (tool?.sourceAvailable === true) return { availability: "AVAILABLE", label: raw };
  return { availability: "REQUIRES_ATTENTION", label: raw };
}

export function portfolioPlanningStatus(balance: number, planned: number, fulfilled: number, sourceStatus?: string | null): PlanningStatus {
  if (balance <= 0.0001) return fulfilled > 0 || /ATEND|CONCLU|FATUR|FINALIZ/.test(normalizePortfolioText(sourceStatus)) ? "COMPLETED" : "NO_BALANCE";
  if (planned <= 0.0001) return "NOT_PLANNED";
  if (planned < balance * 0.995) return "PARTIALLY_PLANNED";
  return "PLANNED";
}

function eligibility(status: PlanningStatus, availability: ToolAvailability): PlanningEligibility {
  if (status === "COMPLETED" || status === "NO_BALANCE") return "COMPLETED";
  if (status === "PLANNED") return availability === "AVAILABLE" ? "ALREADY_PLANNED" : "REVIEW_REQUIRED";
  if (availability === "AVAILABLE") return status === "PARTIALLY_PLANNED" ? "PARTIAL_PLANNING" : "READY_TO_PLAN";
  if (availability === "BLOCKED") return "TOOL_BLOCKED";
  if (availability === "TEMPORARILY_UNAVAILABLE" || availability === "IN_PROCESS") return "WAITING_TOOL";
  return "REVIEW_REQUIRED";
}

function priorityLevel(score: number): PriorityLevel {
  if (score >= 65) return "CRITICAL";
  if (score >= 40) return "HIGH";
  if (score >= 20) return "NORMAL";
  return "MONITOR";
}

function unitFor(row: PortfolioOrderInput) { return row.serviceUnit === "pieces" ? number(row.balancePieces) : number(row.balanceKg); }
function kgPerPiece(row: PortfolioOrderInput) { return row.balancePieces > 0 ? number(row.balanceKg) / number(row.balancePieces) : row.orderedPieces > 0 ? number(row.orderedKg) / number(row.orderedPieces) : 0; }
function plannedAmountFor(row: PortfolioOrderInput, plan: ActivePlanInput) {
  if (row.serviceUnit === "pieces") {
    if (plan.demandUnit === "pieces") return number(plan.targetQuantity);
    const ratio = kgPerPiece(row);
    return ratio > 0 ? number(plan.targetKg) / ratio : 0;
  }
  if (plan.demandUnit === "kg") return number(plan.targetKg);
  return number(plan.targetQuantity) * kgPerPiece(row);
}

export function createPortfolioAnalysis(input: {
  orders: PortfolioOrderInput[];
  activePlans: ActivePlanInput[];
  history: PlanningHistoryInput[];
  tools: ToolStatusInput[];
  now?: Date;
  weights?: Partial<PriorityWeights>;
}): PortfolioAnalysis {
  const now = currentDay(input.now ?? new Date());
  const weights = { ...defaultPortfolioPriorityWeights, ...input.weights };
  const historyByOrder = new Map(input.history.map((item) => [normalizedOrder(item.orderKey), item]));
  const toolByCode = new Map<string, ToolStatusInput>();
  for (const tool of input.tools) {
    const key = normalizedToolCode(tool.toolCode);
    const current = toolByCode.get(key);
    if (!current || (tool.sourceAvailable === true && current.sourceAvailable !== true)) toolByCode.set(key, tool);
  }
  const plansByOrder = new Map<string, ActivePlanInput[]>();
  for (const plan of input.activePlans) {
    const key = normalizedOrder(plan.orderNumber);
    plansByOrder.set(key, [...(plansByOrder.get(key) ?? []), plan]);
  }
  const rowsByOrder = new Map<string, PortfolioOrderInput[]>();
  for (const order of input.orders) {
    const key = normalizedOrder(order.orderKey || order.orderNumber);
    rowsByOrder.set(key, [...(rowsByOrder.get(key) ?? []), order]);
  }
  const unmatchedPlanMessages: PortfolioInconsistency[] = [];
  for (const plan of input.activePlans) if (!rowsByOrder.has(normalizedOrder(plan.orderNumber))) unmatchedPlanMessages.push({ orderId: plan.id, orderNumber: plan.orderNumber, toolCode: plan.toolCode, message: "Existe uma Simplificada ativa para um pedido que não está na carteira atual." });

  const fifoByTool = new Map<string, Map<number | string, number>>();
  const toolRows = new Map<string, PortfolioOrderInput[]>();
  for (const row of input.orders) {
    const key = normalizedToolCode(row.toolCode);
    if (!key || unitFor(row) <= 0.0001) continue;
    toolRows.set(key, [...(toolRows.get(key) ?? []), row]);
  }
  for (const [tool, rows] of toolRows) {
    const ranking = new Map<number | string, number>();
    rows.slice().sort((a, b) => (a.implantationDate ?? "9999-12-31").localeCompare(b.implantationDate ?? "9999-12-31") || String(a.id).localeCompare(String(b.id))).forEach((row, index) => ranking.set(row.id, index + 1));
    fifoByTool.set(tool, ranking);
  }

  const sorted = input.orders.slice().sort((a, b) => (a.dueDate ?? "9999-12-31").localeCompare(b.dueDate ?? "9999-12-31") || (a.implantationDate ?? "9999-12-31").localeCompare(b.implantationDate ?? "9999-12-31"));
  const remainingPlans = new Map<string, ActivePlanInput[]>();
  for (const [key, plans] of plansByOrder) remainingPlans.set(key, plans.slice());
  const rows: PortfolioAnalysisRow[] = sorted.map((row) => {
    const balanceUnit = Math.max(unitFor(row), 0);
    const history = historyByOrder.get(normalizedOrder(row.orderKey || row.orderNumber)) ?? null;
    const plans = remainingPlans.get(normalizedOrder(row.orderKey || row.orderNumber)) ?? [];
    let plannedUnit = 0;
    while (plans.length && plannedUnit < balanceUnit) {
      const plan = plans.shift();
      if (!plan) break;
      plannedUnit += Math.max(0, plannedAmountFor(row, plan));
    }
    remainingPlans.set(normalizedOrder(row.orderKey || row.orderNumber), plans);
    plannedUnit = Math.min(plannedUnit, balanceUnit);
    const plannedKg = row.serviceUnit === "pieces" ? plannedUnit * kgPerPiece(row) : plannedUnit;
    const planningStatus = portfolioPlanningStatus(balanceUnit, plannedUnit, row.serviceUnit === "pieces" ? number(history?.fulfilledPieces) : number(history?.fulfilledKg), row.sourceStatus);
    const tool = toolByCode.get(normalizedToolCode(row.toolCode));
    const toolState = classifyToolAvailability(tool);
    const daysToDue = row.dueDate ? daysBetween(now, dateAtNoon(row.dueDate)) : null;
    const daysLate = daysToDue !== null && daysToDue < 0 ? Math.abs(daysToDue) : 0;
    const ageDays = row.implantationDate ? Math.max(0, daysBetween(dateAtNoon(row.implantationDate), now)) : null;
    const rank = fifoByTool.get(normalizedToolCode(row.toolCode))?.get(row.id) ?? null;
    const toolCount = toolRows.get(normalizedToolCode(row.toolCode))?.length ?? 0;
    const inconsistencies: string[] = [];
    if (!row.toolCode) inconsistencies.push("Pedido sem ferramenta informada.");
    if (!tool) inconsistencies.push("Ferramenta sem status cadastrado.");
    if ((rowsByOrder.get(normalizedOrder(row.orderKey || row.orderNumber))?.length ?? 0) > 1) inconsistencies.push("Pedido duplicado na carteira atual.");
    if (row.dueDate && row.implantationDate && row.dueDate < row.implantationDate) inconsistencies.push("Data de entrega anterior à implantação.");
    if (/PLANEJ/.test(normalizePortfolioText(row.sourceStatus)) && plannedUnit <= 0.0001 && balanceUnit > 0.0001) inconsistencies.push("A carteira indica planejado, mas não há quantidade ativa vinculada ao pedido.");
    if (planningStatus === "NOT_PLANNED" && balanceUnit - plannedUnit <= 0.0001 && balanceUnit > 0.0001) inconsistencies.push("Saldo não planejado calculado como zero para pedido não planejado.");
    if ((planningStatus === "COMPLETED" || planningStatus === "NO_BALANCE") && daysLate > 0) inconsistencies.push("Pedido sem saldo aparece atrasado; não deve entrar na fila de urgência.");
    if (tool?.sourceAvailable === false && toolState.availability === "AVAILABLE") inconsistencies.push("Ferramenta marcada como disponível e indisponível ao mesmo tempo.");
    const reasons: string[] = [];
    const penalties: string[] = [];
    let score = 0;
    if (balanceUnit > 0.0001 && planningStatus !== "COMPLETED" && planningStatus !== "NO_BALANCE") {
      if (daysLate) { const points = Math.min(40, weights.overdueBase + daysLate * weights.overduePerDay); score += points; reasons.push(`${daysLate} dia(s) de atraso com saldo aberto.`); }
      else if (daysToDue === 0) { score += weights.deliveryToday; reasons.push("Entrega prevista para hoje."); }
      else if (daysToDue !== null && daysToDue <= 3) { score += weights.deliveryWithinThreeDays; reasons.push(`Entrega em ${daysToDue} dia(s).`); }
      else if (daysToDue !== null && daysToDue <= 7) { score += weights.deliveryWithinSevenDays; reasons.push(`Entrega em ${daysToDue} dias.`); }
      if (rank !== null && toolCount > 1) { const fifoPoints = ((toolCount - rank + 1) / toolCount) * weights.fifo; score += fifoPoints; if (rank === 1) reasons.push("É o pedido mais antigo no FIFO desta ferramenta."); }
      if (ageDays !== null && ageDays >= 60) { score += weights.age; reasons.push(`Pedido implantado há ${ageDays} dias.`); }
      if (planningStatus === "NOT_PLANNED") { score += weights.notPlanned; reasons.push("Ainda não possui cobertura em Simplificada ativa."); }
      if (planningStatus === "PARTIALLY_PLANNED") { score += weights.partialPlanning; reasons.push("Possui cobertura parcial; ainda há saldo fora do planejamento."); }
      if (toolState.availability === "AVAILABLE") { score += weights.toolAvailable; reasons.push("Ferramenta disponível para programação."); }
      if (row.commercialPriority !== null && row.commercialPriority <= 2) { score += weights.commercialPriority; reasons.push("Prioridade comercial elevada na carteira."); }
      if (number(row.overtakenCount) > 0) { const points = Math.min(15, number(row.overtakenCount) * weights.overtakenPerOccurrence); score += points; reasons.push(`Pedido ultrapassado ${number(row.overtakenCount)} vez(es).`); }
      if (toolState.availability === "TEMPORARILY_UNAVAILABLE") { score -= weights.temporarilyUnavailablePenalty; penalties.push("Ferramenta em preparação temporária."); }
      if (toolState.availability === "BLOCKED") { score -= weights.blockedPenalty; penalties.push("Ferramenta bloqueada para programação."); }
      if (toolState.availability === "IN_PROCESS") { score -= weights.inProcessPenalty; penalties.push("Ferramenta está em processo ou na prensa."); }
      if (toolState.availability === "REQUIRES_ATTENTION") { score -= weights.missingToolStatusPenalty; penalties.push("Status operacional da ferramenta precisa ser confirmado."); }
      if (inconsistencies.length) { score -= weights.inconsistentDataPenalty; penalties.push("Há dados que precisam de conferência."); }
    }
    score = Math.max(0, Math.round(score * 10) / 10);
    return { ...row, balanceUnit, plannedUnit, plannedKg, unplannedUnit: Math.max(balanceUnit - plannedUnit, 0), planningPercent: balanceUnit > 0 ? Math.min(100, (plannedUnit / balanceUnit) * 100) : 100, planningStatus, toolAvailability: toolState.availability, toolStatusLabel: toolState.label, planningEligibility: eligibility(planningStatus, toolState.availability), priorityScore: score, priorityLevel: priorityLevel(score), priorityReasons: reasons, priorityPenalties: penalties, daysToDue, daysLate, ageDays, fifoRank: rank, history, inconsistencies };
  });
  const sortByPriority = (left: PortfolioAnalysisRow, right: PortfolioAnalysisRow) => right.priorityScore - left.priorityScore || right.daysLate - left.daysLate || (left.dueDate ?? "9999").localeCompare(right.dueDate ?? "9999");
  const immediate = rows.filter((row) => (row.planningEligibility === "READY_TO_PLAN" || row.planningEligibility === "PARTIAL_PLANNING") && row.priorityLevel !== "MONITOR").sort(sortByPriority);
  const blocked = rows.filter((row) => row.planningEligibility === "WAITING_TOOL" || row.planningEligibility === "TOOL_BLOCKED" || row.planningEligibility === "REVIEW_REQUIRED").filter((row) => row.balanceUnit > 0).sort(sortByPriority);
  const followUp = rows.filter((row) => (row.planningEligibility === "ALREADY_PLANNED" || row.planningEligibility === "PARTIAL_PLANNING") && row.daysToDue !== null && row.daysToDue <= 7 && row.daysToDue >= 0).sort(sortByPriority);
  const inconsistencies = [...unmatchedPlanMessages, ...rows.flatMap((row) => row.inconsistencies.map((message) => ({ orderId: row.id, orderNumber: row.orderNumber, toolCode: row.toolCode, message })) )];

  const tools = [...toolRows.keys()].map((key) => {
    const toolRowsAnalysis = rows.filter((row) => normalizedToolCode(row.toolCode) === key);
    const first = toolRowsAnalysis[0];
    const hasImmediate = toolRowsAnalysis.some((row) => immediate.includes(row));
    const hasBlocked = toolRowsAnalysis.some((row) => blocked.includes(row));
    const group: AttentionGroup | null = hasImmediate ? "IMMEDIATE" : hasBlocked ? "BLOCKED" : toolRowsAnalysis.some((row) => followUp.includes(row)) ? "FOLLOW_UP" : null;
    return { toolCode: first?.toolCode || key, customers: [...new Set(toolRowsAnalysis.map((row) => row.customerName).filter((name): name is string => Boolean(name)))].slice(0, 5), totalOrders: toolRowsAnalysis.length, overdueOrders: toolRowsAnalysis.filter((row) => row.daysLate > 0 && row.balanceUnit > 0).length, notPlannedOrders: toolRowsAnalysis.filter((row) => row.planningStatus === "NOT_PLANNED").length, partialOrders: toolRowsAnalysis.filter((row) => row.planningStatus === "PARTIALLY_PLANNED").length, criticalOrders: toolRowsAnalysis.filter((row) => row.priorityLevel === "CRITICAL").length, totalBalanceKg: toolRowsAnalysis.reduce((sum, row) => sum + Math.max(number(row.balanceKg), 0), 0), unplannedBalanceKg: toolRowsAnalysis.reduce((sum, row) => sum + Math.max(number(row.balanceKg) - row.plannedKg, 0), 0), earliestDueDate: toolRowsAnalysis.map((row) => row.dueDate).filter((value): value is string => Boolean(value)).sort()[0] ?? null, greatestDaysLate: Math.max(0, ...toolRowsAnalysis.map((row) => row.daysLate)), toolAvailability: first?.toolAvailability ?? "REQUIRES_ATTENTION", toolStatusLabel: first?.toolStatusLabel ?? "Status não informado", group };
  }).sort((left, right) => right.criticalOrders - left.criticalOrders || right.overdueOrders - left.overdueOrders || right.unplannedBalanceKg - left.unplannedBalanceKg);
  const customerGroups = new Map<string, PortfolioAnalysisRow[]>();
  for (const row of rows) { const key = row.customerName || "Sem cliente"; customerGroups.set(key, [...(customerGroups.get(key) ?? []), row]); }
  const customers = [...customerGroups.entries()].map(([customerName, customerRows]) => ({ customerName, openOrders: customerRows.filter((row) => row.balanceUnit > 0).length, overdueOrders: customerRows.filter((row) => row.daysLate > 0 && row.balanceUnit > 0).length, overdueBalanceKg: customerRows.filter((row) => row.daysLate > 0).reduce((sum, row) => sum + Math.max(row.balanceKg, 0), 0), unplannedBalanceKg: customerRows.reduce((sum, row) => sum + Math.max(row.balanceKg - row.plannedKg, 0), 0), atRiskOrders: customerRows.filter((row) => row.priorityLevel === "CRITICAL" || row.priorityLevel === "HIGH").length, tools: [...new Set(customerRows.map((row) => row.toolCode).filter((tool): tool is string => Boolean(tool)))].slice(0, 8) })).sort((left, right) => right.overdueBalanceKg - left.overdueBalanceKg || right.unplannedBalanceKg - left.unplannedBalanceKg);
  const open = rows.filter((row) => row.balanceUnit > 0);
  return { generatedAt: now.toISOString(), rows, immediate, blocked, followUp, inconsistencies, tools, customers, summary: { openOrders: open.length, overdueOrders: open.filter((row) => row.daysLate > 0).length, notPlannedOrders: open.filter((row) => row.planningStatus === "NOT_PLANNED").length, partialOrders: open.filter((row) => row.planningStatus === "PARTIALLY_PLANNED").length, plannedOrders: open.filter((row) => row.planningStatus === "PLANNED").length, immediateCount: immediate.length, blockedCount: blocked.length, followUpCount: followUp.length, inconsistencyCount: inconsistencies.length } };
}
