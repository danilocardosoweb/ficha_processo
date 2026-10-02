import { z } from "zod";

export const decisionKinds = ["hard", "soft", "objective", "preference", "informational"] as const;
export const metricKeys = ["lateMinutes", "setupMinutes", "thermalMinutes", "resourceMinutes", "shortRuns", "highHoles", "handoverHighHoles", "remainderKg", "makespanMinutes"] as const;
export const factKeys = ["remainingKg", "holes", "productivityKgH", "lateMinutes", "thermalMinutes", "resourceMinutes", "remainderKg"] as const;
export const predicateSchema = z.object({
  fact: z.enum(factKeys),
  operator: z.enum(["lt", "lte", "gt", "gte", "eq"]),
  value: z.number().finite().min(0).max(1_000_000),
});
export const customCriterionSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().trim().min(3).max(120),
  description: z.string().max(500).default(""),
  module: z.enum(["sequencing", "delivery", "thermal", "material", "resources", "productivity"]),
  kind: z.enum(decisionKinds),
  enabled: z.boolean(),
  weight: z.number().min(0).max(100),
  priority: z.number().int().min(1).max(5),
  penalty: z.number().min(0).max(100),
  conditions: z.array(predicateSchema).min(1).max(6),
  consecutive: z.number().int().min(1).max(20),
});
export const profileSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(3).max(120),
  description: z.string().max(600),
  weights: z.object({
    lateMinutes: z.number().min(0).max(100),
    setupMinutes: z.number().min(0).max(100),
    thermalMinutes: z.number().min(0).max(100),
    resourceMinutes: z.number().min(0).max(100),
    shortRuns: z.number().min(0).max(100),
    highHoles: z.number().min(0).max(100),
    handoverHighHoles: z.number().min(0).max(100).default(85),
    remainderKg: z.number().min(0).max(100),
    makespanMinutes: z.number().min(0).max(100),
  }).refine(w => Object.values(w).some(value => value > 0), "Informe pelo menos um objetivo com peso maior que zero."),
  thresholds: z.object({
    lowVolumeKg: z.number().positive().max(100_000),
    shortRunMinutes: z.number().positive().max(1440),
    maxConsecutiveShortRuns: z.number().int().min(1).max(20),
    highHoles: z.number().int().min(1).max(100),
    maxConsecutiveHighHoles: z.number().int().min(1).max(20),
    handoverMaxHoles: z.number().int().min(2).max(4).default(2),
  }),
  customCriteria: z.array(customCriterionSchema).max(40),
}).superRefine((profile, ctx) => {
  if (new Set(profile.customCriteria.map(rule => rule.id)).size !== profile.customCriteria.length)
    ctx.addIssue({ code: "custom", message: "Cada critério precisa ter um identificador único." });
});
export type DecisionProfile = z.infer<typeof profileSchema>;
export type CustomCriterion = z.infer<typeof customCriterionSchema>;
export type MetricKey = typeof metricKeys[number];
export type FactKey = typeof factKeys[number];
export type DecisionKind = typeof decisionKinds[number];

const baseline: DecisionProfile = {
  schemaVersion: 1, name: "Balanceado", description: "Equilibra prazo, continuidade e consumo. Pesos iniciais para avaliação do PCP.",
  weights: { lateMinutes: 90, setupMinutes: 70, thermalMinutes: 90, resourceMinutes: 90, shortRuns: 60, highHoles: 60, handoverHighHoles: 85, remainderKg: 50, makespanMinutes: 70 },
  thresholds: { lowVolumeKg: 300, shortRunMinutes: 30, maxConsecutiveShortRuns: 2, highHoles: 4, maxConsecutiveHighHoles: 2, handoverMaxHoles: 2 },
  customCriteria: [],
};
export const decisionPresets: DecisionProfile[] = [
  baseline,
  { ...baseline, name: "Prazo crítico", weights: { ...baseline.weights, lateMinutes: 100, setupMinutes: 40, remainderKg: 20, makespanMinutes: 90 } },
  { ...baseline, name: "Maior utilização", weights: { ...baseline.weights, setupMinutes: 100, thermalMinutes: 100, makespanMinutes: 100, shortRuns: 90 } },
  { ...baseline, name: "Economia de material", weights: { ...baseline.weights, remainderKg: 100, setupMinutes: 90, lateMinutes: 60 } },
  { ...baseline, name: "Menor risco operacional", weights: { ...baseline.weights, thermalMinutes: 100, resourceMinutes: 100, highHoles: 90, shortRuns: 90 } },
];
export const metricLabels: Record<MetricKey, string> = {
  lateMinutes: "Atraso dos pedidos", setupMinutes: "Preparação e troca de liga",
  thermalMinutes: "Espera por ferramenta quente", resourceMinutes: "Espera por recursos",
  shortRuns: "Corridas curtas seguidas", highHoles: "Muitos furos seguidos", handoverHighHoles: "Furos no revezamento",
  remainderKg: "Sobra de tarugo", makespanMinutes: "Tempo até terminar a carga",
};
export const factLabels: Record<FactKey, string> = {
  remainingKg: "Quantidade a produzir (kg)", holes: "Quantidade de furos",
  productivityKgH: "Produtividade (kg/h)", lateMinutes: "Atraso previsto (min)",
  thermalMinutes: "Espera térmica (min)", resourceMinutes: "Espera por recursos (min)",
  remainderKg: "Saldo após a ordem (kg)",
};
