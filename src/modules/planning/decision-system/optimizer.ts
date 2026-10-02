import { simulateMachineLoad, workingMinutesBetween, type LoadOrderInput, type LoadSimulation, type MachineLoadSettings, type WorkShiftInput, type ResourceUnavailabilityInput, type SimulationResourcesInput, type OvertimePeriodInput } from "../machine-load-simulator";
import type { MaterialAvailability } from "../planning-intelligence";
import { evaluateDecision, type DecisionEvaluation } from "./engine";
import type { DecisionProfile } from "./schema";
import { planningEngineDefaults } from "../source-of-truth";
import type { PressProductivityResult } from "./shift-goals";

/** Snapshot imutável usado por todos os cenários de uma mesma execução. */
export interface DecisionContext {
  orders: LoadOrderInput[];
  /** Sequência recebida da Simplificada. Nunca é alterada pelo otimizador. */
  originalOrders?: LoadOrderInput[];
  settings: Record<string, MachineLoadSettings>;
  start: Date;
  shifts: WorkShiftInput[];
  unavailable: ResourceUnavailabilityInput[];
  overtimePeriods: OvertimePeriodInput[];
  resources: SimulationResourcesInput;
  stock: MaterialAvailability[];
  stockKnown: boolean;
}

export interface DecisionCandidate {
  sequenceChange?: { orderId: string; toolCode: string; machineCode: string; from: number; to: number; reason: string; recordedAt: string };
  id: string;
  name: string;
  orderIds: Record<string, string[]>;
  simulation: LoadSimulation;
  evaluation: DecisionEvaluation;
  /** Itens temporariamente fora deste cenário, sem alterar a carteira real. */
  excludedOrders?: ExcludedOrder[];
  searched: number;
  durationMs: number;
}

export type OptimizationProfileId = "original" | "material_efficiency" | "max_throughput" | "balanced" | "delivery_priority";

export interface OptimizationProfile {
  id: OptimizationProfileId;
  name: string;
  description: string;
  decisionProfile: DecisionProfile;
}

export interface ScenarioKpis {
  projectedKg: number;
  projectedTonnes: number;
  /**
   * KPI operacional da janela usada pelo turno/critério configurado.
   * Não é a previsão de produtividade da carga; para essa previsão use
   * `pressPlans[].plannedVolumeKgH`, calculada pela média da Simplificada.
   */
  averageProductivityKgH: number;
  technicalProductivityKgH: number;
  operationalProductivityKgH: number;
  grossPerPressKgH: number;
  netPerPressKgH: number;
  totalGrossKgH: number;
  loadCoveragePercent: number;
  availabilityPercent: number;
  yieldPercent: number | null;
  grossKg: number;
  noLoadMinutes: number;
  efficiencyPercent: number | null;
  utilizationPercent: number;
  productiveMinutes: number;
  idleMinutes: number;
  setupMinutes: number;
  thermalWaitMinutes: number;
  resourceWaitMinutes: number;
  alloyChanges: number;
  toolChanges: number;
  totalBars: number;
  endingBilletKg: number;
  endAt: Date | null;
  lateOrders: number;
  /** Leitura individual, sem diluir o desempenho entre prensas. */
  presses: PressProductivityResult[];
  /** Resultado da carga completa de cada prensa, sem preencher artificialmente o turno. */
  pressPlans: ScenarioPressKpi[];
}

export interface ScenarioPressKpi {
  machineCode: string;
  plannedKg: number;
  plannedTonnes: number;
  startsAt: Date | null;
  endsAt: Date | null;
  /** Tempo útil previsto de extrusão. Não inclui preparação, espera ou parada. */
  workMinutes: number;
  /** Tempo da programação dentro das janelas, incluindo preparo e esperas. */
  scheduledMinutes: number;
  /** Média aritmética das produtividades informadas na Simplificada para a prensa. */
  plannedVolumeKgH: number;
  /** Quantidade de ferramentas usada na média de produtividade. */
  productivitySampleCount: number;
  turnsRequired: number;
  toolChanges: number;
  /** Tempo morto estimado entre as trocas, conforme configuração da prensa. */
  toolChangeMinutes: number;
  setupMinutes: number;
  waitingMinutes: number;
}

export interface ExcludedOrder {
  orderId: string;
  toolCode: string;
  machineCode: string;
  reason: string;
  expectedAvailability: Date | null;
}

export interface ScenarioDelta {
  projectedKg: number;
  averageProductivityKgH: number;
  alloyChanges: number;
  setupMinutes: number;
  idleMinutes: number;
  endMinutes: number | null;
}

export interface ScenarioChangeReason {
  orderId: string;
  toolCode: string;
  machineCode: string;
  from: number;
  to: number;
  reason: string;
  simulatedImpact: string;
}

export interface ScenarioResult {
  id: OptimizationProfileId;
  profile: OptimizationProfile;
  source: "simplificada" | "optimized";
  candidate: DecisionCandidate;
  sequence: Record<string, string[]>;
  kpis: ScenarioKpis;
  excludedOrders: ExcludedOrder[];
  limitingFactors: string[];
  decisionReasons: string[];
  changes: ScenarioChangeReason[];
  inputHash: string;
  configVersion: string;
  deltaFromBaseline?: ScenarioDelta;
}

export interface ScenarioComparison {
  scenarios: ScenarioResult[];
  recommendedScenarioId: OptimizationProfileId;
  reasonCodes: string[];
  tradeoffs: string[];
}

export type ScenarioProgress = {
  stage: "validation" | "simulation" | "comparison";
  completedProfiles: number;
  totalProfiles: number;
  profileName?: string;
  testedNodes: number;
};

type ProgressReporter = (progress: ScenarioProgress) => void;

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const lockStatus = (status: string) => status === "in_progress" || status === "paused";
const cloneOrders = (orders: LoadOrderInput[]) => orders.map((order) => ({ ...order, alternativeAlloys: [...order.alternativeAlloys] }));

function resequence(orders: LoadOrderInput[]) {
  const positions = new Map<string, number>();
  return [...orders].sort((left, right) => left.machineCode.localeCompare(right.machineCode) || left.sequence - right.sequence || left.id.localeCompare(right.id)).map((order) => {
    const sequence = (positions.get(order.machineCode) ?? 0) + 1;
    positions.set(order.machineCode, sequence);
    return { ...order, sequence };
  });
}

function sequenceSignature(orders: LoadOrderInput[]) {
  return [...orders]
    .sort((left, right) => left.machineCode.localeCompare(right.machineCode) || left.sequence - right.sequence || left.id.localeCompare(right.id))
    .map((order) => `${order.machineCode}:${order.id}:${order.sequence}`)
    .join("|");
}

function makeProfile(id: OptimizationProfileId, active: DecisionProfile): OptimizationProfile {
  const base = structuredClone(active);
  const withWeights = (name: string, description: string, weights: Partial<DecisionProfile["weights"]>): OptimizationProfile => ({
    id,
    name,
    description,
    decisionProfile: { ...base, name, description, weights: { ...base.weights, ...weights } },
  });
  switch (id) {
    case "original":
      return withWeights("Original · Simplificada", "Reproduz exatamente a sequência importada; não faz otimização.", {});
    case "material_efficiency":
      return withWeights("Material", "Reduz sobras, campanhas quebradas, trocas de liga e setups conhecidos.", {
        remainderKg: 100, setupMinutes: 90, thermalMinutes: 60, resourceMinutes: 70, lateMinutes: 65, makespanMinutes: 65,
      });
    case "max_throughput":
      return withWeights("Produtividade", "Busca atingir as metas de toneladas e kg/h sem relaxar restrições físicas.", {
        makespanMinutes: 100, setupMinutes: 85, thermalMinutes: 95, resourceMinutes: 95, lateMinutes: 65, remainderKg: 45,
      });
    case "delivery_priority":
      return withWeights("Prioridade de entrega", "Preparado para uso futuro; prioriza prazo sem alterar a realidade física.", { lateMinutes: 100, setupMinutes: 40, remainderKg: 20, makespanMinutes: 90 });
    case "balanced":
    default:
      return withWeights("Balanceado", "Equilibra prazo, continuidade, recursos, material e produtividade.", {});
  }
}

export function optimizationProfiles(active: DecisionProfile): OptimizationProfile[] {
  return (["original", "material_efficiency", "max_throughput", "balanced"] as const).map((id) => makeProfile(id, active));
}

export function runCandidate(context: DecisionContext, profile: DecisionProfile, orders = context.orders, name = "Atual"): DecisionCandidate {
  const sequence = resequence(cloneOrders(orders));
  const simulation = simulateMachineLoad(sequence, context.settings, context.start, "fifo", context.shifts, context.unavailable, context.resources, context.overtimePeriods);
  const orderIds = Object.fromEntries(simulation.machines.map((machine) => [machine.machineCode, machine.items.map((item) => item.id)]));
  return {
    id: name,
    name,
    orderIds,
    simulation,
    evaluation: evaluateDecision(
      simulation,
      profile,
      context.stock,
      context.stockKnown,
      name.includes("Original") || name === "Atual"
        ? "Sequência original da Simplificada, preservada para comparação."
        : `Sequência calculada pelo perfil "${name}" e recalculada com as mesmas restrições físicas.`,
    ),
    searched: 1,
    durationMs: 0,
  };
}

/** Portões comuns: nenhum perfil pode comprar uma violação física com peso. */
export function compareCandidates(a: DecisionCandidate, b: DecisionCandidate) {
  return a.evaluation.hardViolations - b.evaluation.hardViolations ||
    a.evaluation.missingData.length - b.evaluation.missingData.length ||
    a.evaluation.shiftGoals.shiftsBelowTargets - b.evaluation.shiftGoals.shiftsBelowTargets ||
    a.evaluation.shiftGoals.priorityPenalty - b.evaluation.shiftGoals.priorityPenalty ||
    b.evaluation.shiftGoals.projectedKg - a.evaluation.shiftGoals.projectedKg ||
    a.evaluation.cost - b.evaluation.cost ||
    a.id.localeCompare(b.id);
}

function alloyChanges(candidate: DecisionCandidate) {
  return sum(candidate.simulation.machines.map((machine) => machine.items.reduce((changes, item, index, items) =>
    index > 0 && items[index - 1]?.selectedAlloy !== item.selectedAlloy ? changes + 1 : changes, 0)));
}

function compareForProfile(left: DecisionCandidate, right: DecisionCandidate, profile: OptimizationProfileId) {
  const common = left.evaluation.hardViolations - right.evaluation.hardViolations ||
    left.evaluation.missingData.length - right.evaluation.missingData.length;
  if (common) return common;
  if (profile === "material_efficiency") {
    return left.simulation.totalBars - right.simulation.totalBars ||
      alloyChanges(left) - alloyChanges(right) ||
      left.evaluation.metrics.setupMinutes - right.evaluation.metrics.setupMinutes ||
      left.evaluation.metrics.remainderKg - right.evaluation.metrics.remainderKg ||
      left.evaluation.cost - right.evaluation.cost;
  }
  if (profile === "max_throughput") {
    return left.evaluation.shiftGoals.shiftsBelowTargets - right.evaluation.shiftGoals.shiftsBelowTargets ||
      left.evaluation.shiftGoals.priorityPenalty - right.evaluation.shiftGoals.priorityPenalty ||
      right.evaluation.shiftGoals.projectedKg - left.evaluation.shiftGoals.projectedKg ||
      right.evaluation.shiftGoals.averageProductivityKgH - left.evaluation.shiftGoals.averageProductivityKgH ||
      left.evaluation.metrics.setupMinutes - right.evaluation.metrics.setupMinutes ||
      left.evaluation.cost - right.evaluation.cost;
  }
  if (profile === "delivery_priority")
    return left.evaluation.metrics.lateMinutes - right.evaluation.metrics.lateMinutes || compareCandidates(left, right);
  return compareCandidates(left, right);
}

function orderPriority(order: LoadOrderInput, profile: OptimizationProfileId) {
  const due = order.dueDate ? new Date(order.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
  const ready = order.toolHeatingState === "released" ? 0 : order.toolHeatingState === "heating" ? 1 : 2;
  if (profile === "material_efficiency") return `${order.alloyCode.padEnd(30)}|${ready}|${String(order.sequence).padStart(6, "0")}`;
  if (profile === "max_throughput") return `${ready}|${String(Math.round(9_999_999 - order.productivityKgH)).padStart(8, "0")}|${String(Math.round(9_999_999 - (order.targetKg - order.producedKg))).padStart(8, "0")}|${String(order.sequence).padStart(6, "0")}`;
  if (profile === "delivery_priority") return `${String(due).padStart(16, "0")}|${ready}|${String(order.sequence).padStart(6, "0")}`;
  return `${ready}|${String(due).padStart(16, "0")}|${order.alloyCode}|${String(order.sequence).padStart(6, "0")}`;
}

/** Expansões determinísticas. Cada nó move uma ordem não iniciada na própria prensa. */
function expansions(orders: LoadOrderInput[], profile: OptimizationProfileId, level: number, width: number) {
  const output: LoadOrderInput[][] = [];
  const machines = [...new Set(orders.map((order) => order.machineCode))].sort();
  for (const machineCode of machines) {
    const group = orders.filter((order) => order.machineCode === machineCode).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
    const locked = group.filter((order) => lockStatus(order.status));
    const movable = group.filter((order) => !lockStatus(order.status));
    const target = level;
    if (target >= movable.length) continue;
    const choices = movable.slice(target).sort((a, b) => orderPriority(a, profile).localeCompare(orderPriority(b, profile)) || a.id.localeCompare(b.id)).slice(0, width);
    for (const choice of choices) {
      const at = movable.findIndex((order) => order.id === choice.id);
      if (at === target) continue;
      const next = [...movable];
      next.splice(at, 1);
      next.splice(target, 0, choice);
      const replacement = [...locked, ...next];
      const byId = new Map(replacement.map((order, index) => [order.id, { ...order, sequence: index + 1 }]));
      output.push(orders.map((order) => byId.get(order.id) ?? order));
    }
  }
  return output;
}

function optimizeProfile(context: DecisionContext, profile: OptimizationProfile, budget: number): DecisionCandidate {
  const original = cloneOrders(context.originalOrders ?? context.orders);
  const baseline = profile.id === "original"
    ? runCandidate(context, profile.decisionProfile, original, profile.name)
    : runScenarioCandidate(context, profile.decisionProfile, original, profile.name);
  if (profile.id === "original") return baseline;
  const beamWidth = Math.max(1, planningEngineDefaults.beamWidth);
  const depth = Math.max(1, planningEngineDefaults.lookAheadDepth);
  const seen = new Set<string>([sequenceSignature(original)]);
  let searched = 1;
  let best = baseline;
  let frontier = [{ orders: original, candidate: baseline }];
  for (let level = 0; level < depth && searched < budget; level += 1) {
    const next: Array<{ orders: LoadOrderInput[]; candidate: DecisionCandidate }> = [];
    for (const state of frontier) {
      for (const proposal of expansions(state.orders, profile.id, level, beamWidth)) {
        if (searched >= budget) break;
        const signature = sequenceSignature(proposal);
        if (seen.has(signature)) continue;
        seen.add(signature);
        const candidate = runScenarioCandidate(context, profile.decisionProfile, proposal, profile.name);
        searched += 1;
        next.push({ orders: proposal, candidate });
        if (compareForProfile(candidate, best, profile.id) < 0) best = candidate;
      }
    }
    if (!next.length) break;
    next.sort((left, right) => compareForProfile(left.candidate, right.candidate, profile.id));
    frontier = next.slice(0, beamWidth);
  }
  best.searched = searched;
  return best;
}

export function pressPlansForSimulation(simulation: LoadSimulation): ScenarioPressKpi[] {
  const regularShiftMinutes = (() => {
    const [startHour, startMinute] = planningEngineDefaults.shiftStartTime.split(":").map(Number);
    const [endHour, endMinute] = planningEngineDefaults.shiftEndTime.split(":").map(Number);
    return Math.max(1, (endHour * 60 + endMinute) - (startHour * 60 + startMinute));
  })();
  return simulation.machines.map((machine) => {
    const startsAt = machine.startsAt;
    const endsAt = machine.endsAt;
    // Preserva o tempo operacional para explicar a data de término, mas não
    // o usa como "tempo de trabalho": ele contém preparação e esperas.
    const scheduledMinutes = startsAt && endsAt
      ? (simulation.shifts?.length
        ? workingMinutesBetween(startsAt, endsAt, simulation.shifts, machine.machineCode, [], simulation.overtimePeriods ?? [])
        : machine.simulatedMinutes)
      : 0;
    const plannedKg = sum(machine.items.map((item) => item.remainingKg));
    // A previsão solicitada pelo PCP é a média simples das produtividades
    // carregadas para cada ferramenta da Simplificada, sem deixar setup,
    // espera ou ociosidade distorcerem o indicador. O valor do item já vem da
    // Simplificada quando existe; cargas antigas podem trazer uma fonte
    // complementar, mas continuam participando com a produtividade válida.
    const validProductivities = machine.items
      .map((item) => item.productivityKgH)
      .filter((value) => Number.isFinite(value) && value > 0);
    const plannedVolumeKgH = validProductivities.length
      ? sum(validProductivities) / validProductivities.length
      : 0;
    // O tempo útil é derivado da mesma produtividade prevista exibida no
    // cartão. Assim, volume, produtividade e horas de extrusão fecham entre
    // si, sem somar troca de ferramenta, espera térmica ou máquina parada.
    const workMinutes = plannedVolumeKgH > 0
      ? plannedKg / plannedVolumeKgH * 60
      : 0;
    return {
      machineCode: machine.machineCode,
      plannedKg,
      plannedTonnes: plannedKg / 1_000,
      startsAt,
      endsAt,
      workMinutes,
      scheduledMinutes,
      plannedVolumeKgH,
      productivitySampleCount: validProductivities.length,
      turnsRequired: workMinutes > 0 ? Math.ceil(workMinutes / regularShiftMinutes) : 0,
      toolChanges: Math.max(0, machine.items.length - 1),
      toolChangeMinutes: machine.items.slice(1).reduce((total, item) => total + Math.max(0, item.toolChangeMinutes ?? 1), 0),
      setupMinutes: sum(machine.items.map((item) => item.preparationMinutes)),
      waitingMinutes: machine.waitingMinutes,
    } satisfies ScenarioPressKpi;
  }).sort((left, right) => left.machineCode.localeCompare(right.machineCode));
}

export function scenarioKpis(candidate: DecisionCandidate): ScenarioKpis {
  const items = candidate.simulation.machines.flatMap((machine) => machine.items);
  const rawRequired = sum(candidate.simulation.billets.map((billet) => billet.rawRequiredKg));
  const simulated = sum(candidate.simulation.machines.map((machine) => machine.simulatedMinutes));
  const productive = sum(items.map((item) => item.theoreticalMinutes));
  const setup = sum(items.map((item) => item.preparationMinutes));
  const thermal = sum(items.map((item) => item.thermalWaitMinutes));
  const resource = sum(items.map((item) => item.resourceWaitMinutes));
  const report = candidate.evaluation.shiftGoals;
  const projectedKg = report.shifts.length ? report.projectedKg : candidate.simulation.totalDemandKg;
  const endAt = candidate.simulation.machines.reduce<Date | null>((latest, machine) => !machine.endsAt || latest && latest >= machine.endsAt ? latest : machine.endsAt, null);
  const pressPlans = pressPlansForSimulation(candidate.simulation);
  return {
    projectedKg,
    projectedTonnes: projectedKg / 1_000,
    averageProductivityKgH: report.shifts.length ? report.averageProductivityKgH : productive ? candidate.simulation.totalDemandKg / (productive / 60) : 0,
    technicalProductivityKgH: report.productivity.technicalKgH || (productive ? candidate.simulation.totalDemandKg / (productive / 60) : 0),
    operationalProductivityKgH: report.productivity.operationalKgH,
    grossPerPressKgH: report.productivity.grossPerPressKgH,
    netPerPressKgH: report.productivity.netPerPressKgH,
    totalGrossKgH: report.productivity.totalGrossKgH,
    loadCoveragePercent: report.productivity.loadCoveragePercent,
    availabilityPercent: report.productivity.availabilityPercent,
    yieldPercent: report.productivity.yieldPercent,
    grossKg: report.productivity.grossKg || rawRequired,
    noLoadMinutes: report.productivity.noLoadMinutes,
    efficiencyPercent: rawRequired > 0 ? candidate.simulation.totalDemandKg / rawRequired * 100 : null,
    utilizationPercent: simulated > 0 ? productive / simulated * 100 : 0,
    productiveMinutes: productive,
    idleMinutes: Math.max(0, simulated - productive - setup),
    setupMinutes: setup,
    thermalWaitMinutes: thermal,
    resourceWaitMinutes: resource,
    alloyChanges: alloyChanges(candidate),
    toolChanges: sum(candidate.simulation.machines.map((machine) => Math.max(0, machine.items.length - 1))),
    totalBars: candidate.simulation.totalBars,
    endingBilletKg: sum(candidate.simulation.billets.map((billet) => billet.endingBalanceKg)),
    endAt,
    lateOrders: candidate.evaluation.traces.filter((trace) => trace.lateMinutes > 0).length,
    presses: report.presses,
    pressPlans,
  };
}

function excludedOrders(candidate: DecisionCandidate): ExcludedOrder[] {
  if (candidate.excludedOrders) return candidate.excludedOrders;
  const items = new Map(candidate.simulation.machines.flatMap((machine) => machine.items).map((item) => [item.id, item]));
  const grouped = new Map<string, ExcludedOrder>();
  for (const conflict of candidate.simulation.conflicts.filter((conflict) => conflict.severity === "blocking")) {
    const item = items.get(conflict.orderId);
    if (!item || grouped.has(item.id)) continue;
    grouped.set(item.id, { orderId: item.id, toolCode: item.toolCode, machineCode: item.machineCode, reason: conflict.message, expectedAvailability: item.calculatedToolReadyAt ?? null });
  }
  return [...grouped.values()].sort((left, right) => left.machineCode.localeCompare(right.machineCode) || left.orderId.localeCompare(right.orderId));
}

/**
 * Quando um cadastro físico obrigatório está ausente, o cenário continua com
 * as demais OPs viáveis. A carteira real não é modificada e o item excluído
 * segue exposto com o motivo. Conflitos temporais continuam no simulador,
 * pois podem ser resolvidos por espera, não por exclusão permanente.
 */
function runScenarioCandidate(context: DecisionContext, profile: DecisionProfile, orders: LoadOrderInput[], name: string): DecisionCandidate {
  const full = runCandidate(context, profile, orders, name);
  const byId = new Map(full.simulation.machines.flatMap((machine) => machine.items).map((item) => [item.id, item]));
  const excluded = new Map<string, ExcludedOrder>();
  for (const conflict of full.simulation.conflicts) {
    if (conflict.severity !== "blocking" || !/^(missing-|bo-catalog-)/.test(conflict.type) || excluded.has(conflict.orderId)) continue;
    const item = byId.get(conflict.orderId);
    if (!item) continue;
    excluded.set(item.id, { orderId: item.id, toolCode: item.toolCode, machineCode: item.machineCode, reason: conflict.message, expectedAvailability: item.calculatedToolReadyAt ?? null });
  }
  if (!excluded.size) return full;
  const viableOrders = orders.filter((order) => !excluded.has(order.id));
  const partial = runCandidate(context, profile, viableOrders, name);
  partial.excludedOrders = [...excluded.values()].sort((left, right) => left.machineCode.localeCompare(right.machineCode) || left.orderId.localeCompare(right.orderId));
  return partial;
}

function delta(baseline: ScenarioKpis, candidate: ScenarioKpis): ScenarioDelta {
  return {
    projectedKg: candidate.projectedKg - baseline.projectedKg,
    averageProductivityKgH: candidate.averageProductivityKgH - baseline.averageProductivityKgH,
    alloyChanges: candidate.alloyChanges - baseline.alloyChanges,
    setupMinutes: candidate.setupMinutes - baseline.setupMinutes,
    idleMinutes: candidate.idleMinutes - baseline.idleMinutes,
    endMinutes: baseline.endAt && candidate.endAt ? (candidate.endAt.getTime() - baseline.endAt.getTime()) / 60_000 : null,
  };
}

function changesFromOriginal(context: DecisionContext, candidate: DecisionCandidate, profile: OptimizationProfileId): ScenarioChangeReason[] {
  const original = context.originalOrders ?? context.orders;
  const originalPositions = new Map(original.map((order) => [order.id, order.sequence]));
  const orders = new Map(original.map((order) => [order.id, order]));
  const reason = profile === "material_efficiency"
    ? "Reposicionada para avaliar continuidade de liga, menos barras e menos setup conhecido."
    : profile === "max_throughput"
      ? "Reposicionada pela busca para reduzir espera e melhorar a meta de toneladas e kg/h."
      : profile === "balanced"
        ? "Reposicionada pela busca balanceada, mantendo os portões físicos e as prioridades avaliadas."
        : "Mantida na sequência recebida da Simplificada.";
  return Object.entries(candidate.orderIds).flatMap(([machineCode, ids]) => ids.flatMap((id, index) => {
    const from = originalPositions.get(id);
    const order = orders.get(id);
    const to = index + 1;
    return from && order && from !== to ? [{ orderId: id, toolCode: order.toolCode, machineCode, from, to, reason, simulatedImpact: "Impacto exibido no delta calculado deste cenário contra a Simplificada." }] : [];
  }));
}

function toScenario(context: DecisionContext, profile: OptimizationProfile, candidate: DecisionCandidate): ScenarioResult {
  const kpis = scenarioKpis(candidate);
  const excluded = excludedOrders(candidate);
  const blockers = candidate.evaluation.shiftGoals.shifts.flatMap((shift) => shift.blockers);
  const changes = changesFromOriginal(context, candidate, profile.id);
  return {
    id: profile.id,
    profile,
    source: profile.id === "original" ? "simplificada" : "optimized",
    candidate,
    sequence: candidate.orderIds,
    kpis,
    excludedOrders: excluded,
    limitingFactors: [...new Set([...blockers, ...excluded.map((item) => item.reason), ...candidate.evaluation.missingData])].slice(0, 12),
    decisionReasons: changes.length ? changes.slice(0, 8).map((change) => `${change.toolCode}: posição ${change.from} → ${change.to}. ${change.reason}`) : candidate.evaluation.traces.flatMap((trace) => trace.reasons.slice(0, 1)).slice(0, 8),
    changes,
    inputHash: sequenceSignature(context.originalOrders ?? context.orders),
    configVersion: "planning-scenarios-v1",
  };
}

function recommend(scenarios: ScenarioResult[]): { id: OptimizationProfileId; reasonCodes: string[]; tradeoffs: string[] } {
  const baseline = scenarios.find((scenario) => scenario.id === "original")!;
  const feasible = scenarios.filter((scenario) => scenario.candidate.evaluation.hardViolations === 0);
  const throughput = scenarios.find((scenario) => scenario.id === "max_throughput");
  const balanced = scenarios.find((scenario) => scenario.id === "balanced");
  const material = scenarios.find((scenario) => scenario.id === "material_efficiency");
  // A recomendação precisa ser comparável: entre cenários físicos viáveis,
  // vence a nota calculada pelo mesmo perfil e snapshot. Metas de turno têm
  // precedência para não recomendar uma nota alta que piora a operação.
  let selected = [...feasible].sort((left, right) =>
    right.candidate.evaluation.shiftGoals.shiftsMeetingBothTargets - left.candidate.evaluation.shiftGoals.shiftsMeetingBothTargets
    || right.candidate.evaluation.score - left.candidate.evaluation.score
    || right.kpis.projectedKg - left.kpis.projectedKg
    || (left.kpis.endAt?.getTime() ?? Number.POSITIVE_INFINITY) - (right.kpis.endAt?.getTime() ?? Number.POSITIVE_INFINITY),
  )[0] ?? baseline;
  const reasonCodes = ["hard_constraints_preserved", "same_snapshot", "deterministic_search", "highest_comparable_score"];
  const tradeoffs: string[] = [];
  if (throughput && throughput.candidate.evaluation.hardViolations === 0 && throughput.candidate.evaluation.shiftGoals.shiftsMeetingBothTargets > selected.candidate.evaluation.shiftGoals.shiftsMeetingBothTargets) {
    selected = throughput;
    reasonCodes.push("throughput_meets_more_shift_goals");
  } else if (selected.id === "balanced" && balanced) reasonCodes.push("balanced_operational_tradeoff");
  if (material && selected.id !== "material_efficiency" && material.kpis.alloyChanges < selected.kpis.alloyChanges)
    tradeoffs.push(`Material reduz ${selected.kpis.alloyChanges - material.kpis.alloyChanges} troca(s) de liga, mas não foi escolhido porque o cenário recomendado tem melhor resultado operacional pelos portões ativos.`);
  tradeoffs.unshift(`${selected.profile.name} recebeu nota ${selected.candidate.evaluation.score}/100: melhor resultado comparável entre os cenários viáveis, após priorizar as metas do turno.`);
  if (selected.id !== "original") tradeoffs.push(`${selected.profile.name} foi comparado contra a Simplificada sem alterar a sequência original.`);
  return { id: selected.id, reasonCodes, tradeoffs };
}

/** Executa os quatro cenários usando exatamente o mesmo snapshot físico. */
export function buildScenarioComparison(context: DecisionContext, activeProfile: DecisionProfile, maxNodesBudget = planningEngineDefaults.maxNodesBudget, onProgress?: ProgressReporter): ScenarioComparison {
  const profiles = optimizationProfiles(activeProfile);
  const perProfileBudget = Math.max(1, Math.floor(maxNodesBudget / Math.max(profiles.length - 1, 1)));
  onProgress?.({ stage: "validation", completedProfiles: 0, totalProfiles: profiles.length, testedNodes: 0 });
  const scenarios = profiles.map((profile, index) => {
    const candidate = optimizeProfile(context, profile, profile.id === "original" ? 1 : perProfileBudget);
    onProgress?.({ stage: index === 0 ? "validation" : "simulation", completedProfiles: index + 1, totalProfiles: profiles.length, profileName: profile.name, testedNodes: candidate.searched });
    return toScenario(context, profile, candidate);
  });
  const original = scenarios.find((scenario) => scenario.id === "original")!;
  for (const scenario of scenarios) if (scenario !== original) {
    scenario.deltaFromBaseline = delta(original.kpis, scenario.kpis);
    const impact = scenario.deltaFromBaseline;
    for (const change of scenario.changes) change.simulatedImpact = `${impact.projectedKg >= 0 ? "+" : ""}${Math.round(impact.projectedKg)} kg, ${impact.averageProductivityKgH >= 0 ? "+" : ""}${Math.round(impact.averageProductivityKgH)} kg/h, ${impact.alloyChanges >= 0 ? "+" : ""}${impact.alloyChanges} troca(s) de liga versus a Simplificada.`;
  }
  onProgress?.({ stage: "comparison", completedProfiles: profiles.length, totalProfiles: profiles.length, testedNodes: sum(scenarios.map((scenario) => scenario.candidate.searched)) });
  const recommended = recommend(scenarios);
  return { scenarios, recommendedScenarioId: recommended.id, reasonCodes: recommended.reasonCodes, tradeoffs: recommended.tradeoffs };
}

/** Compatibilidade com os consumidores já existentes da Central de Decisões. */
export function optimizeDecisions(context: DecisionContext, activeProfile: DecisionProfile, maxNodesBudget = planningEngineDefaults.maxNodesBudget): DecisionCandidate[] {
  const comparison = buildScenarioComparison(context, activeProfile, maxNodesBudget);
  const candidates = comparison.scenarios.map((scenario) => scenario.candidate);
  // Mantém compatibilidade com o perfil de prazo já configurável na Central de
  // Decisões, sem promovê-lo ainda como um dos quatro cenários da interface.
  if (activeProfile.name.toLocaleLowerCase("pt-BR").includes("prazo"))
    candidates.push(optimizeProfile(context, makeProfile("delivery_priority", activeProfile), Math.max(1, Math.floor(maxNodesBudget / 3))));
  return candidates;
}
