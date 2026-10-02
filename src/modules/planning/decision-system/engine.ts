import type { LoadSimulation, ScheduledLoadItem } from "../machine-load-simulator";
import type { MaterialAvailability } from "../planning-intelligence";
import { dueAt, lateMinutes } from "./dates";
import { factLabels, metricKeys, type CustomCriterion, type DecisionProfile, type FactKey, type MetricKey } from "./schema";
import { evaluateShiftGoals, type ShiftGoalsReport } from "./shift-goals";
import { planningEngineDefaults } from "../source-of-truth";

export interface DecisionTrace {
  orderId: string; toolCode: string; machineCode: string; position: number;
  dueAt: Date | null; lateMinutes: number; slackMinutes: number | null;
  facts: Partial<Record<FactKey, number>>; reasons: string[];
  ruleHits: { id: string; name: string; kind: string; penalty: number }[];
  missingData: string[];
}
export interface DecisionEvaluation {
  status: "viable" | "blocked" | "unconfirmed";
  score: number; cost: number; hardViolations: number;
  missingData: string[]; metrics: Record<MetricKey, number>;
  shiftGoals: ShiftGoalsReport;
  traces: DecisionTrace[];
  impacts: { resource: string; tools: number; orders: number; kg: number; steps: string[] }[];
  tradeoffs: string[];
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
function atLocalTime(day: Date, value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
}
/** A operação pode atravessar mais de um dia; confere cada janela de revezamento. */
function overlapsHandover(item: ScheduledLoadItem) {
  const first = new Date(item.extrusionStartAt.getFullYear(), item.extrusionStartAt.getMonth(), item.extrusionStartAt.getDate());
  const last = new Date(item.endAt.getFullYear(), item.endAt.getMonth(), item.endAt.getDate());
  for (const day = new Date(first); day <= last; day.setDate(day.getDate() + 1)) {
    const startsAt = atLocalTime(day, planningEngineDefaults.handoverStartTime);
    const endsAt = atLocalTime(day, planningEngineDefaults.handoverEndTime);
    if (item.extrusionStartAt < endsAt && item.endAt > startsAt) return true;
  }
  return false;
}
function matches(rule: CustomCriterion, facts: Partial<Record<FactKey, number>>) {
  return rule.conditions.every(condition => {
    const value = facts[condition.fact];
    if (value === undefined) return false;
    switch (condition.operator) {
      case "lt": return value < condition.value;
      case "lte": return value <= condition.value;
      case "gt": return value > condition.value;
      case "gte": return value >= condition.value;
      case "eq": return value === condition.value;
    }
  });
}
export function factsForItem(item: ScheduledLoadItem): Partial<Record<FactKey, number>> {
  return {
    remainingKg: item.remainingKg, ...(item.holes == null ? {} : { holes: item.holes }),
    productivityKgH: item.productivityKgH,
    ...(dueAt(item.dueDate) ? { lateMinutes: lateMinutes(item.dueDate, item.endAt) } : {}),
    thermalMinutes: item.thermalWaitMinutes, resourceMinutes: item.resourceWaitMinutes,
    remainderKg: item.billetBalanceAfterKg,
  };
}
export function evaluateDecision(
  simulation: LoadSimulation, profile: DecisionProfile, stock: MaterialAvailability[],
  stockKnown = true, sequenceOrigin = "Ordem definida pelo usuário ou pela sequência escolhida.",
): DecisionEvaluation {
  const items = simulation.machines.flatMap(machine => machine.items);
  const shiftGoals = evaluateShiftGoals(simulation);
  const missing = new Set<string>();
  let hard = 0;
  for (const conflict of simulation.conflicts) {
    if (conflict.type.startsWith("missing-") || conflict.id.startsWith("bo-catalog-"))
      missing.add(conflict.message);
    else if (conflict.severity === "blocking") hard++;
  }
  if (!stockKnown) missing.add("Estoque de tarugos não foi confirmado.");
  for (const billet of simulation.billets) {
    const available = stock.find(row => row.alloyCode.trim().toUpperCase() === billet.alloyCode.trim().toUpperCase());
    if (stockKnown && (!available || available.availableBars < billet.bars)) hard++;
  }
  if (!items.length) missing.add("Não há ordens para avaliar.");
  const traces: DecisionTrace[] = [];
  let shortExcess = 0, holesExcess = 0, handoverHighHoles = 0, ruleCost = 0;
  for (const machine of simulation.machines) {
    let shorts = 0, holes = 0;
    const consecutive = new Map<string, number>();
    for (const [index, item] of machine.items.entries()) {
      const facts = factsForItem(item);
      const itemMissing: string[] = [];
      if (!dueAt(item.dueDate)) itemMissing.push("Prazo não informado: não é possível confirmar a entrega.");
      if (item.productivitySource === "padrao") itemMissing.push("Produtividade estimada em 1.300 kg/h; confirme no arquivo ou no apontamento.");
      if (!item.carcassCode) itemMissing.push("Carcaça ou sequência física não confirmada.");
      if (!item.boCode) itemMissing.push("BO não informado.");
      const reasons = [
        sequenceOrigin,
        `Produzir ${Math.round(item.remainingKg)} kg a ${Math.round(item.productivityKgH)} kg/h exige ${Math.round(item.theoreticalMinutes)} min de produção líquida.`,
        `Preparação: ${Math.round(item.preparationMinutes)} min; espera térmica: ${Math.round(item.thermalWaitMinutes)} min; espera por recursos: ${Math.round(item.resourceWaitMinutes)} min.`,
        ...item.resourceConflicts.map(conflict => conflict.message),
      ];
      shorts = item.remainingKg < profile.thresholds.lowVolumeKg && item.theoreticalMinutes < profile.thresholds.shortRunMinutes ? shorts + 1 : 0;
      holes = (item.holes ?? 0) >= profile.thresholds.highHoles ? holes + 1 : 0;
      if (shorts > profile.thresholds.maxConsecutiveShortRuns) shortExcess++;
      if (holes > profile.thresholds.maxConsecutiveHighHoles) holesExcess++;
      const handoverRisk = (item.holes ?? 0) > profile.thresholds.handoverMaxHoles && overlapsHandover(item);
      if (handoverRisk) {
        handoverHighHoles++;
        reasons.push(`Revezamento ${planningEngineDefaults.handoverStartTime}–${planningEngineDefaults.handoverEndTime}: ${item.holes} furos acima do limite de ${profile.thresholds.handoverMaxHoles}; o motor procura alternativa quando viável.`);
      }
      const hits: DecisionTrace["ruleHits"] = [];
      for (const rule of profile.customCriteria.filter(rule => rule.enabled).sort((a, b) => a.priority - b.priority)) {
        const absent = rule.conditions.filter(condition => facts[condition.fact] === undefined);
        if (absent.length) {
          itemMissing.push(`Critério "${rule.name}" não pôde ser avaliado: faltam ${absent.map(c => factLabels[c.fact]).join(", ")}.`);
          if (rule.kind === "hard") missing.add(`Dados insuficientes para a restrição ${rule.name} na ferramenta ${item.toolCode}.`);
        }
        const count = matches(rule, facts) ? (consecutive.get(rule.id) ?? 0) + 1 : 0;
        consecutive.set(rule.id, count);
        if (count < rule.consecutive) continue;
        const penalty = rule.kind === "informational" ? 0 : rule.penalty * rule.weight / 100;
        hits.push({ id: rule.id, name: rule.name, kind: rule.kind, penalty });
        if (rule.kind === "hard") hard++;
        else ruleCost += penalty;
      }
      traces.push({ orderId: item.id, toolCode: item.toolCode, machineCode: item.machineCode,
        position: index + 1, dueAt: dueAt(item.dueDate), lateMinutes: lateMinutes(item.dueDate, item.endAt),
        slackMinutes: dueAt(item.dueDate) ? (dueAt(item.dueDate)!.getTime() - item.endAt.getTime()) / 60000 : null,
        facts, reasons, ruleHits: hits, missingData: itemMissing });
    }
  }
  const metrics: Record<MetricKey, number> = {
    lateMinutes: sum(traces.map(trace => trace.lateMinutes)),
    setupMinutes: sum(items.map(item => item.preparationMinutes)),
    thermalMinutes: sum(items.map(item => item.thermalWaitMinutes)),
    resourceMinutes: sum(items.map(item => item.resourceWaitMinutes)),
    shortRuns: shortExcess, highHoles: holesExcess, handoverHighHoles,
    remainderKg: sum(simulation.billets.map(billet => billet.endingBalanceKg)),
    makespanMinutes: Math.max(0, ...simulation.machines.map(machine => machine.simulatedMinutes)),
  };
  // Dimensionless scales fixed by the same workload, never by the candidate's score.
  const productive = Math.max(simulation.totalTheoreticalMinutes, 1);
  const scales: Record<MetricKey, number> = {
    lateMinutes: productive, setupMinutes: productive, thermalMinutes: productive,
    resourceMinutes: productive, shortRuns: Math.max(items.length, 1), highHoles: Math.max(items.length, 1), handoverHighHoles: Math.max(items.length, 1),
    remainderKg: Math.max(simulation.totalDemandKg, 1), makespanMinutes: productive,
  };
  const totalWeight = sum(Object.values(profile.weights));
  const cost = sum(metricKeys.map(key => profile.weights[key] * metrics[key] / scales[key])) / Math.max(totalWeight, 1)
    + ruleCost / Math.max(items.length * 100, 1);
  const grouped = new Map<string, ScheduledLoadItem[]>();
  for (const conflict of simulation.conflicts.filter(c => c.severity === "blocking")) {
    const key = `${conflict.type} · ${conflict.resourceCode}`;
    const item = items.find(item => item.id === conflict.orderId);
    if (item && !(grouped.get(key) ?? []).some(row => row.id === item.id)) grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  const impacts = [...grouped].map(([resource, affected]) => ({
    resource, tools: new Set(affected.map(item => item.toolCode)).size, orders: affected.length,
    kg: sum(affected.map(item => item.remainingKg)),
    steps: ["Confira o cadastro e a quantidade física com o responsável pelo recurso.",
      "Informe a disponibilidade e o horário de liberação confirmados.",
      "Recalcule o cenário e confira se o impedimento desapareceu."],
  })).sort((a, b) => b.orders - a.orders || b.kg - a.kg);
  const tradeoffs: string[] = [];
  if (metrics.lateMinutes > 0 && metrics.remainderKg > 0)
    tradeoffs.push("Há atraso e sobra de material no mesmo cenário. Compare as estratégias de prazo e material; o ganho só é confirmado após recalcular.");
  if (metrics.shortRuns > 0 && metrics.thermalMinutes > 0)
    tradeoffs.push("Corridas curtas e espera térmica aparecem juntas. A sequência alternativa precisa confirmar se intercalar ordens reduz essa espera.");
  if (handoverHighHoles > 0)
    tradeoffs.push(`${handoverHighHoles} ferramenta(s) acima de ${profile.thresholds.handoverMaxHoles} furos atravessam o revezamento de ${planningEngineDefaults.handoverStartTime}–${planningEngineDefaults.handoverEndTime}. O motor as penalizou, mas não encontrou substituição viável sem outro impacto.`);
  return { status: hard ? "blocked" : missing.size ? "unconfirmed" : "viable",
    score: Math.round(100 / (1 + cost)), cost, hardViolations: hard,
    missingData: [...missing], metrics, shiftGoals, traces, impacts, tradeoffs };
}
