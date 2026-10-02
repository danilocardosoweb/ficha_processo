import type { DecisionKind, DecisionProfile, MetricKey } from "./schema";

export interface DecisionNode {
  id: string; name: string; module: string; kind: DecisionKind; description: string;
  dependencies: string[]; requiredData: string[]; engine: string; application: string;
  metric?: MetricKey; protected: boolean;
}
export const decisionCatalog: DecisionNode[] = [
  { id: "calendar", name: "Calendário e capacidade", module: "Calendário", kind: "hard", description: "Produzir dentro dos turnos e respeitar indisponibilidades.", dependencies: [], requiredData: ["turnos", "paradas programadas"], engine: "Scheduling Engine", application: "nextWorkingInstant / addWorkingMinutes", protected: true },
  { id: "productivity", name: "Produtividade confiável", module: "Produtividade", kind: "hard", description: "Usar dado válido até 2.500 kg/h; estimar 1.300 kg/h quando faltar.", dependencies: [], requiredData: ["produtividade do arquivo"], engine: "Productivity Engine", application: "safeProductivityKgH", protected: true },
  { id: "resources", name: "Recursos físicos e reservas", module: "Recursos", kind: "hard", description: "Respeitar quantidade e intervalos de ferramenta, carcaça e BO.", dependencies: ["calendar"], requiredData: ["sequência física", "carcaça", "BO", "estoque físico", "reservas"], engine: "Resource Engine", application: "simulateMachineLoad / resourceConflicts", protected: true },
  { id: "thermal", name: "Ferramenta pronta e vagas do forno", module: "Forno", kind: "hard", description: "Aquecer pelo tempo configurado antes de iniciar; a vaga permanece ocupada até a retirada.", dependencies: ["calendar", "resources"], requiredData: ["ciclos de aquecimento", "vagas", "tempo mínimo"], engine: "Thermal Engine", application: "simulateMachineLoad / thermalCoverage", protected: true },
  { id: "material", name: "Material por liga", module: "Tarugos", kind: "hard", description: "Conferir consumo bruto, saldo e barras disponíveis por liga.", dependencies: ["productivity"], requiredData: ["liga homologada", "eficiência", "peso da barra", "estoque"], engine: "Material Engine", application: "billets / evaluateDecision", protected: true },
  ...([
    ["lateMinutes", "Prazo", ["calendar", "productivity", "thermal", "resources"]],
    ["setupMinutes", "Setup", ["calendar", "material"]],
    ["thermalMinutes", "Forno", ["thermal"]],
    ["resourceMinutes", "Recursos", ["resources"]],
    ["shortRuns", "Sequenciamento", ["productivity", "thermal"]],
    ["highHoles", "Sequenciamento", ["resources"]],
    ["remainderKg", "Tarugos", ["material"]],
    ["makespanMinutes", "Capacidade", ["calendar", "thermal", "resources"]],
  ] as const).map(([metric, module, dependencies]) => ({
    id: metric, name: metric, module, kind: "objective" as const,
    description: "Objetivo medido em cada cenário, com peso configurável.",
    dependencies: [...dependencies], requiredData: ["resultado da simulação"], engine: "Decision Engine",
    application: "evaluateDecision / cost", metric, protected: false,
  })),
];

export function graphForProfile(profile: DecisionProfile): DecisionNode[] {
  return [...decisionCatalog, ...profile.customCriteria.map(rule => ({
    id: rule.id, name: rule.name, module: rule.module, kind: rule.kind,
    description: rule.description, dependencies: [...new Set(rule.conditions.map(condition =>
      condition.fact === "lateMinutes" ? "lateMinutes" :
        condition.fact === "thermalMinutes" ? "thermal" :
          condition.fact === "resourceMinutes" ? "resources" :
            condition.fact === "remainderKg" ? "material" : "productivity"))],
    requiredData: rule.conditions.map(condition => condition.fact), engine: "Rule Engine",
    application: "evaluateCustomRules", protected: false,
  }))];
}
