import type { LoadSimulation } from "./machine-load-simulator";

export interface IntelligenceWeights {
  thermal: number;
  resources: number;
  material: number;
  delivery: number;
  flow: number;
  minimumConfidenceSamples: number;
}

export interface MaterialAvailability {
  alloyCode: string;
  availableBars: number;
  availableWeightKg: number;
}

export interface ScoreCriterion {
  key: keyof Omit<IntelligenceWeights, "minimumConfidenceSamples">;
  label: string;
  score: number;
  weight: number;
  explanation: string;
}

export interface PlanningRecommendation {
  id: string;
  priority: "critical" | "high" | "medium" | "opportunity";
  category: "resource" | "thermal" | "material" | "delivery" | "flow";
  title: string;
  reason: string;
  impact: string;
  action: string;
  orderId?: string;
  machineCode?: string;
  toolCode?: string;
}

export interface PlanningAnalysis {
  score: { overall: number; label: string; criteria: ScoreCriterion[] };
  recommendations: PlanningRecommendation[];
  summary: { conflicts: number; opportunities: number; predictedIdleMinutes: number; lateOrders: number; materialShortages: number };
}

export const defaultIntelligenceWeights: IntelligenceWeights = { thermal: 20, resources: 25, material: 25, delivery: 15, flow: 15, minimumConfidenceSamples: 5 };
const clamp = (value: number) => Math.max(0, Math.min(100, value));
const normalized = (value: string) => value.trim().toUpperCase();

export function analyzePlanning(simulation: LoadSimulation, stock: MaterialAvailability[], weights: IntelligenceWeights = defaultIntelligenceWeights): PlanningAnalysis {
  const items = simulation.machines.flatMap((machine) => machine.items);
  const thermalIdle = simulation.machines.reduce((sum, machine) => sum + machine.thermalCoverage.predictedIdleMinutes, 0);
  const thermalRisks = simulation.machines.reduce((sum, machine) => sum + machine.thermalCoverage.riskItemCount, 0);
  const blocking = simulation.conflicts?.filter((conflict) => conflict.severity === "blocking") ?? [];
  const resourceDelay = simulation.conflicts?.reduce((sum, conflict) => sum + conflict.delayMinutes, 0) ?? 0;
  const stockByAlloy = new Map(stock.map((item) => [normalized(item.alloyCode), item]));
  const shortages = simulation.billets.filter((billet) => billet.bars > (stockByAlloy.get(normalized(billet.alloyCode))?.availableBars ?? 0));
  const lateItems = items.filter((item) => item.dueDate && item.endAt > new Date(`${item.dueDate}T23:59:59`));
  const totalElapsed = simulation.machines.reduce((sum, machine) => sum + machine.simulatedMinutes, 0);
  const productive = simulation.machines.reduce((sum, machine) => sum + machine.theoreticalMinutes, 0);
  const flowLossRatio = totalElapsed > 0 ? Math.max(totalElapsed - productive, 0) / totalElapsed : 0;

  const criteria: ScoreCriterion[] = [
    { key: "thermal", label: "Cobertura térmica", weight: weights.thermal, score: clamp(100 - thermalRisks * 18 - thermalIdle / 3), explanation: thermalRisks ? `${thermalRisks} item(ns) com risco e ${Math.round(thermalIdle)} min de espera térmica.` : "Ferramentas aquecidas dentro da janela prevista." },
    { key: "resources", label: "Recursos físicos", weight: weights.resources, score: clamp(100 - blocking.length * 35 - resourceDelay / 4), explanation: blocking.length ? `${blocking.length} cadastro(s) ou capacidade(s) impedem a aprovação.` : resourceDelay ? `${Math.round(resourceDelay)} min absorvidos por ferramenta ou carcaça ocupada.` : "Sem sobreposição de ferramenta ou carcaça." },
    { key: "material", label: "Cobertura de material", weight: weights.material, score: clamp(100 - shortages.length * 45), explanation: shortages.length ? `${shortages.length} liga(s) sem barras suficientes.` : "Estoque livre cobre a carga bruta calculada." },
    { key: "delivery", label: "Atendimento de prazo", weight: weights.delivery, score: clamp(100 - lateItems.length * 20), explanation: lateItems.length ? `${lateItems.length} ordem(ns) terminam após o prazo.` : "Nenhuma ordem ultrapassa o prazo informado." },
    { key: "flow", label: "Fluidez operacional", weight: weights.flow, score: clamp(100 - flowLossRatio * 100), explanation: `${Math.round(flowLossRatio * 100)}% do horizonte está em setup, troca ou espera.` },
  ];
  const weightTotal = criteria.reduce((sum, criterion) => sum + criterion.weight, 0) || 100;
  const overall = Math.round(criteria.reduce((sum, criterion) => sum + criterion.score * criterion.weight, 0) / weightTotal);
  const recommendations: PlanningRecommendation[] = [];

  for (const conflict of blocking) {
    const affectedItem = items.find((item) => item.id === conflict.orderId);
    recommendations.push({ id: `resource-${conflict.id}`, priority: "critical", category: "resource", title: `Resolver ${conflict.resourceCode}`, reason: conflict.message, impact: "Cenário não pode ser aprovado enquanto o recurso estiver incompleto.", action: conflict.type === "missing-carcass" ? "Cadastrar o vínculo ferramenta–carcaça e informar o saldo físico." : "Liberar, reparar ou cadastrar capacidade adicional.", orderId: conflict.orderId, machineCode: conflict.machineCode, toolCode: affectedItem?.toolCode });
  }
  for (const machine of simulation.machines.filter((item) => item.thermalCoverage.status === "risk")) recommendations.push({ id: `thermal-${machine.machineCode}`, priority: "high", category: "thermal", title: `Proteger a cobertura térmica da prensa ${machine.machineCode}`, reason: `${Math.round(machine.thermalCoverage.predictedIdleMinutes)} min de parada térmica previstos a partir de ${machine.thermalCoverage.firstRiskToolCode ?? "uma próxima ferramenta"}.`, impact: `Recuperar até ${Math.round(machine.thermalCoverage.predictedIdleMinutes)} min de disponibilidade da prensa.`, action: "Antecipar o aquecimento indicado ou posicionar uma ordem de maior duração antes do primeiro risco.", machineCode: machine.machineCode });
  for (const shortage of shortages) { const available = stockByAlloy.get(normalized(shortage.alloyCode))?.availableBars ?? 0; recommendations.push({ id: `material-${shortage.alloyCode}`, priority: "critical", category: "material", title: `Cobrir ${shortage.alloyCode}`, reason: `Necessárias ${shortage.bars} barras e disponíveis ${available}.`, impact: `Faltam ${shortage.bars - available} barra(s) para executar a programação.`, action: "Programar recebimento, reduzir/redistribuir a carga ou substituir por liga alternativa homologada." }); }
  for (const billet of simulation.billets.filter((item) => item.endingBalanceKg > 0)) {
    const candidate = items.find((item) => normalized(item.selectedAlloy) !== normalized(billet.alloyCode) && item.alternativeAlloys.some((alloy) => normalized(alloy) === normalized(billet.alloyCode)));
    if (candidate) recommendations.push({ id: `remainder-${billet.alloyCode}-${candidate.id}`, priority: "opportunity", category: "material", title: `Aproveitar saldo de ${billet.alloyCode}`, reason: `A sequência termina com ${Math.round(billet.endingBalanceKg)} kg brutos disponíveis e a ferramenta ${candidate.toolCode} aceita esta liga.`, impact: "Pode reduzir sobra, nova carga e troca de liga.", action: `Simular a ordem ${candidate.orderNumber} com ${billet.alloyCode} antes da próxima virada.`, orderId: candidate.id, machineCode: candidate.machineCode });
  }
  if (lateItems.length) recommendations.push({ id: "delivery-late", priority: "high", category: "delivery", title: "Antecipar ordens em risco de prazo", reason: `${lateItems.length} ordem(ns) terminam após a data prometida.`, impact: "Redução do risco de atraso ao cliente.", action: "Priorizar as ordens vencendo primeiro, desde que não crie falta térmica ou de material." });
  if (flowLossRatio > 0.25) recommendations.push({ id: "flow-loss", priority: "medium", category: "flow", title: "Reduzir perdas de fluxo", reason: `${Math.round(flowLossRatio * 100)}% do horizonte está fora de extrusão produtiva.`, impact: `Potencial de recuperar aproximadamente ${Math.round(totalElapsed - productive)} min.`, action: "Agrupar ligas compatíveis e reduzir trocas sem romper prazo e cobertura térmica." });

  const priorityOrder = { critical: 0, high: 1, medium: 2, opportunity: 3 } as const;
  recommendations.sort((left, right) => priorityOrder[left.priority] - priorityOrder[right.priority]);
  return { score: { overall, label: overall >= 85 ? "Excelente" : overall >= 70 ? "Boa" : overall >= 50 ? "Atenção" : "Crítica", criteria }, recommendations, summary: { conflicts: blocking.length, opportunities: recommendations.filter((item) => item.priority === "opportunity").length, predictedIdleMinutes: Math.round(thermalIdle + resourceDelay), lateOrders: lateItems.length, materialShortages: shortages.length } };
}
