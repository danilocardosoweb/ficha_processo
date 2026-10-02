import { z } from "zod";
import {
  planningSourceManifest,
  PLANNING_SPEC_VERSION,
  unresolvedPlanningAssumptions,
} from "../source-of-truth";

export const analysisRoles = [
  "planning",
  "preparation",
  "production",
  "monitoring",
  "replanning",
] as const;
export const analysisRoleSchema = z.enum(analysisRoles);
export type AnalysisRole = z.infer<typeof analysisRoleSchema>;

export const providerKinds = ["openrouter", "lmstudio", "openai", "openclaw"] as const;
export const providerKindSchema = z.enum(providerKinds);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const sourceReferenceSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(240),
  kind: z.enum(["calculation", "record", "configuration", "pending-data"]),
});

export const analysisValidationSchema = z.object({
  status: z.enum(["feasible", "blocked", "incomplete", "not_evaluated"]),
  hardViolations: z.number().int().min(0),
  unknowns: z.number().int().min(0),
  reason: z.string().min(3).max(500),
  checkedBy: z.literal("deterministic-engine"),
});
export type AnalysisValidation = z.infer<typeof analysisValidationSchema>;

const record = z.record(z.string(), z.unknown());

/**
 * Contrato compacto para o analista. A tela nunca envia tabelas arbitrárias:
 * o conteúdo é derivado de uma simulação já calculada.
 */
export const analysisPacketSchema = z.object({
  schemaVersion: z.literal(4),
  generatedAt: z.string().datetime(),
  role: analysisRoleSchema.default("planning"),
  mode: z.string().max(30),
  provenance: z.object({
    specVersion: z.string().min(1).max(40),
    engineVersion: z.string().min(1).max(80),
    configurationVersion: z.string().min(1).max(80),
    snapshotId: z.string().min(8).max(160),
    sourceDocuments: z.array(z.object({ id: z.string(), title: z.string() })).min(1).max(8),
  }),
  score: record,
  machines: z.array(record).max(10),
  materials: z.array(record).max(50),
  resources: record,
  deterministic: z.object({
    facts: z.array(sourceReferenceSchema).max(120),
    risks: z.array(record).max(80),
    missingData: z.array(z.string().max(400)).max(30),
    validation: analysisValidationSchema,
  }),
  decisionSystem: record.optional(),
  deterministicRecommendations: z.array(record).max(100),
});
export type AnalysisPacket = z.infer<typeof analysisPacketSchema>;

export type StandardAnalysisFields = {
  contract: {
    schemaVersion: 1;
    role: AnalysisRole;
    provenance: AnalysisPacket["provenance"];
  };
  facts: z.infer<typeof sourceReferenceSchema>[];
  warnings: string[];
  resourceConflicts: string[];
  planningChanges: Array<{
    action: "REORDER";
    machineCode: string;
    orderId: string;
    fromPosition: number;
    toPosition: number;
    reason: string;
    expectedImpact: Record<string, string | number>;
  }>;
  validation: AnalysisValidation;
};

export function packetProvenance(snapshotSeed: unknown, engineVersion: string) {
  const compact = JSON.stringify(snapshotSeed);
  // Deterministic and browser/server compatible signature. It is an identity
  // hint, not a cryptographic security primitive.
  let hash = 2166136261;
  for (let index = 0; index < compact.length; index++) {
    hash ^= compact.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return {
    specVersion: PLANNING_SPEC_VERSION,
    engineVersion,
    configurationVersion: "planning-intelligence-v3",
    snapshotId: `sim-${(hash >>> 0).toString(16).padStart(8, "0")}`,
    sourceDocuments: planningSourceManifest.documents.map((document) => ({
      id: document.id,
      title: document.title,
    })),
  };
}

export function deterministicValidation(input: {
  hardViolations?: number;
  missingData?: string[];
  conflictMessages?: string[];
}): AnalysisValidation {
  const hardViolations = Math.max(0, Math.round(input.hardViolations ?? 0));
  const missingData = [...new Set([
    ...(input.missingData ?? []),
    ...unresolvedPlanningAssumptions(),
  ])];
  if (hardViolations > 0)
    return {
      status: "blocked",
      hardViolations,
      unknowns: missingData.length,
      reason: "Há impedimentos físicos ou operacionais. Nenhuma sugestão pode ser tratada como pronta para executar.",
      checkedBy: "deterministic-engine",
    };
  if (missingData.length > 0)
    return {
      status: "incomplete",
      hardViolations: 0,
      unknowns: missingData.length,
      reason: "A simulação não encontrou impedimento conhecido, mas ainda há dados que precisam ser confirmados.",
      checkedBy: "deterministic-engine",
    };
  return {
    status: "feasible",
    hardViolations: 0,
    unknowns: 0,
    reason: "A sequência foi calculada sem impedimentos ou dados pendentes conhecidos neste snapshot.",
    checkedBy: "deterministic-engine",
  };
}

export function makeStandardAnalysisFields(
  packet: AnalysisPacket,
  proposed: Array<{ machineCode: string; orderedOrderIds: string[] }>,
): StandardAnalysisFields {
  const originals = new Map(
    packet.machines.map((machine) => [
      String(machine.machineCode ?? ""),
      Array.isArray(machine.items)
        ? machine.items
            .map((item) => (item && typeof item === "object" ? String((item as Record<string, unknown>).orderId ?? "") : ""))
            .filter(Boolean)
        : [],
    ]),
  );
  const planningChanges: StandardAnalysisFields["planningChanges"] = [];
  for (const machine of proposed) {
    const original = originals.get(machine.machineCode) ?? [];
    for (let index = 0; index < machine.orderedOrderIds.length; index++) {
      const orderId = machine.orderedOrderIds[index];
      const fromPosition = original.indexOf(orderId) + 1;
      if (fromPosition > 0 && fromPosition !== index + 1)
        planningChanges.push({
          action: "REORDER",
          machineCode: machine.machineCode,
          orderId,
          fromPosition,
          toPosition: index + 1,
          reason: "Ordem alternativa sugerida pela IA; compare o impacto calculado antes de confirmar.",
          expectedImpact: { status: "pendente de recálculo completo" },
        });
    }
  }
  const conflicts = packet.machines.flatMap((machine) => {
    const items = Array.isArray(machine.items) ? machine.items : [];
    return items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const conflicts = (item as Record<string, unknown>).conflicts;
      return Array.isArray(conflicts)
        ? conflicts.filter((value): value is string => typeof value === "string")
        : [];
    });
  });
  const validation = planningChanges.length
    ? {
        ...packet.deterministic.validation,
        status: packet.deterministic.validation.status === "blocked"
          ? "blocked" as const
          : "not_evaluated" as const,
        reason: packet.deterministic.validation.status === "blocked"
          ? packet.deterministic.validation.reason
          : "A ordem alternativa ainda precisa ser recalculada pelo motor determinístico antes de ser considerada viável.",
      }
    : packet.deterministic.validation;
  return {
    contract: { schemaVersion: 1, role: packet.role, provenance: packet.provenance },
    facts: packet.deterministic.facts,
    warnings: packet.deterministic.missingData,
    resourceConflicts: [...new Set(conflicts)],
    planningChanges,
    validation,
  };
}
