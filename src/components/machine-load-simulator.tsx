"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Boxes,
  BrainCircuit,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Columns3,
  Flame,
  FolderOpen,
  Gauge,
  GitCompareArrows,
  GripVertical,
  Loader2,
  PackageOpen,
  RefreshCw,
  Route,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { DecisionWorkspace } from "@/components/decision-workspace";
import { PlanningEnginePremises } from "@/components/planning-engine-premises";
import { decisionPresets, type DecisionProfile } from "@/modules/planning/decision-system/schema";
import { evaluateDecision } from "@/modules/planning/decision-system/engine";
import { evaluateShiftGoals } from "@/modules/planning/decision-system/shift-goals";
import type { ShiftGoalsReport } from "@/modules/planning/decision-system/shift-goals";
import { pressPlansForSimulation, type DecisionContext, type DecisionCandidate } from "@/modules/planning/decision-system/optimizer";
import { selectPhysicalTool } from "@/modules/planning/tool-selection";
import {
  DEFAULT_PRODUCTIVITY_KG_H,
  guardProductivityKgH,
  normalizeProductivityKgH,
} from "@/modules/planning/productivity";
import {
  simulateMachineLoad,
  type LoadOrderInput,
  type MachineLoadSettings,
  type ProductivitySource,
  type ResourceUnavailabilityInput,
  type WorkShiftInput,
  type OvertimePeriodInput,
} from "@/modules/planning/machine-load-simulator";
import { SIMULATION_MODEL_VERSION } from "@/modules/planning/simulation";
import {
  analyzePlanning,
  defaultIntelligenceWeights,
  type IntelligenceWeights,
  type PlanningAnalysis,
} from "@/modules/planning/planning-intelligence";
import {
  deterministicValidation,
  packetProvenance,
} from "@/modules/planning/ai/contracts";
import { unresolvedPlanningAssumptions } from "@/modules/planning/source-of-truth";
import { useCurrentUser } from "@/components/current-user-provider";
import { FieldHelp, LoadHelpGuide } from "@/components/load-help";
import type { LoadHelpKey } from "@/modules/planning/load-help";
import {
  machineLoadSectionKeys,
  useMachineLoadSectionVisibility,
} from "@/lib/machine-load-visibility";

interface RawOrder {
  id: string;
  order_number: string;
  plan_code: string | null;
  machine_code: string;
  tool_code: string;
  alloy_code: string | null;
  target_kg: number | string | null;
  produced_kg: number | string | null;
  sequence: number | null;
  due_date: string | null;
  status: string;
  last_productivity_kg_h: number | string | null;
  holes: number | string | null;
  bo_code: string | null;
  carcass_code: string | null;
  package_measure_mm: number | string | null;
  carcass_diameter_mm: number | string | null;
  source_data: Record<string, unknown> | null;
}
interface RawSheet {
  tool_code: string;
  machine_code: string | null;
  parameters: Record<string, unknown> | null;
}
interface RawTool {
  code: string;
  matrix_code: string | null;
  productivity_kg_h: string | null;
  holes: number | null;
  bo: string | null;
  sequence_number: number | null;
  source_available: boolean | null;
  package_measure_mm: number | string | null;
  carcass_diameter_mm: number | string | null;
  carcass_code: string | null;
}
interface RawSetting {
  machine_code: string;
  billet_bar_weight_kg: number | string;
  extrusion_efficiency: number | string;
  default_productivity_kg_h: number | string;
  setup_minutes: number;
  alloy_change_minutes: number;
  tool_change_minutes?: number | null;
  tool_heating_minutes: number;
  oven_count: number;
  oven_slots_per_oven: number;
}
interface RawShift {
  id: string;
  code: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  machine_codes: string[];
  is_active: boolean;
}
interface RawOvertimePeriod {
  id: string;
  work_date: string;
  start_time: string;
  end_time: string;
  machine_codes: string[];
  reason: string;
  is_active: boolean;
}
interface ProductionSettingsPayload {
  settings: RawSetting[];
  shifts: RawShift[];
  overtime_periods?: RawOvertimePeriod[];
}
interface RawCycleOrder {
  production_order_id: string;
  tool_heating_cycles: {
    status: string;
    entered_at: string;
    expected_ready_at: string | null;
    released_at: string | null;
    oven_position: number | null;
    tool_ovens: { code: string; name: string; machine_code: string } | null;
  } | null;
}
interface RawAlloy {
  tool_code: string;
  alloy_code: string;
  is_primary: boolean;
}
interface BilletStockSummary {
  alloyCode: string;
  lotCount: number;
  totalBars: number;
  reservedBars: number;
  availableBars: number;
  totalWeightKg: number | string;
  availableWeightKg: number | string;
}
interface BilletStockPayload {
  summary: BilletStockSummary[];
}
interface CarcassReservation {
  id: string;
  quantity: number;
  startsAt: string;
  endsAt: string;
  productionOrderId?: string | null;
}
interface CarcassResource {
  id: string;
  machineCode: string;
  sharedAcrossMachines?: boolean;
  carcassCode: string;
  totalQuantity: number;
  unavailableQuantity: number;
  physicalAvailableQuantity?: number;
  reservedQuantity: number;
  availableQuantity: number;
  reservations?: CarcassReservation[];
  status: "available" | "maintenance" | "blocked" | "inactive";
  location: string | null;
}
interface CarcassMapping {
  id: string;
  toolCode: string;
  machineCode: string | null;
  sequenceNumber: number | null;
  carcassCode: string;
  quantity: number;
  isActive: boolean;
}
interface CarcassMappingPayload {
  mappings: CarcassMapping[];
}
interface BoResource {
  id: string;
  boCode: string;
  totalQuantity: number;
  unavailableQuantity: number;
  availableQuantity: number;
  status: "available" | "maintenance" | "blocked" | "inactive";
  location: string | null;
}
interface RawUnavailability {
  id: string;
  resourceType: ResourceUnavailabilityInput["resourceType"];
  resourceCode: string;
  startsAt: string;
  endsAt: string;
  reason: string;
  status: ResourceUnavailabilityInput["status"];
}
interface ScenarioSummary {
  id: string;
  name: string;
  description: string | null;
  status: string;
  currentVersion: number;
  requestedStartAt: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

function simulationDisplayId(scenarioId: string) {
  const compactId = scenarioId.replace(/-/g, "").slice(0, 10).toUpperCase();
  return `SIM-${compactId}`;
}
interface LoadedScenario {
  scenarioId: string;
  name: string;
  description: string | null;
  status: string;
  versionNumber: number;
  mode: "fifo" | "optimized" | "manual";
  requestedStartAt: string;
  inputs?: { selectedMachine?: string; sequenceChanges?: NonNullable<DecisionCandidate["sequenceChange"]>[] };
  rules?: {
    unavailability?: ResourceUnavailabilityInput[];
    billetStock?: { capturedAt?: string; summary?: BilletStockSummary[] };
    carcassResources?: { capturedAt?: string; items?: CarcassResource[] };
    boResources?: { capturedAt?: string; items?: BoResource[] };
  };
  result: ReturnType<typeof simulateMachineLoad>;
  analysis?: PlanningAnalysis | null;
  createdAt: string;
}
interface ProjectedBilletBalance {
  beforeKg: number;
  consumedKg: number;
  afterKg: number;
  initialKg: number;
  barWeightKg: number;
  remainingBarEquivalent: number;
  isFinalForAlloy: boolean;
}
interface LearningGroup {
  tool_code: string;
  machine_code: string;
  tool_sequence: number | null;
  sample_count: number;
  average_actual_productivity_kg_h: number | null;
  average_predicted_productivity_kg_h: number | null;
  mean_absolute_error_percent: number | null;
  confidence_percent: number;
  latest_actual_productivity_kg_h: number | null;
  calibrated: boolean;
}
interface LearningObservation {
  id: string;
  machine_code: string;
  tool_code: string;
  tool_sequence: number | null;
  predicted_productivity_kg_h: number | null;
  actual_productivity_kg_h: number | null;
  productivity_error_percent: number | null;
  predicted_duration_minutes: number | null;
  actual_duration_minutes: number | null;
  observed_at: string;
}
interface IntelligencePayload {
  settings: IntelligenceWeights;
  summary: {
    observations: number;
    predictionsCompared: number;
    meanAbsoluteErrorPercent: number;
    confidencePercent: number;
  };
  groups: LearningGroup[];
  recent: LearningObservation[];
  aiConfigured?: boolean;
}
interface AiPlanningAnalysis {
  executiveSummary: string;
  decision: "approve" | "approve_with_adjustments" | "replan" | "blocked";
  confidence: number;
  recommendations: Array<{
    priority: "critical" | "high" | "medium" | "opportunity";
    title: string;
    evidence: string[];
    impact: string;
    action: string;
    plainExplanation: string;
    responsibleRole: string;
    steps: string[];
    successCheck: string;
    affectedTools: string[];
  }>;
  assumptions: string[];
  missingData: string[];
  proposedScenario: {
    title: string;
    rationale: string;
    expectedBenefits: string[];
    risks: string[];
    machines: Array<{
      machineCode: string;
      orderedOrderIds: string[];
    }>;
  };
  contract?: {
    schemaVersion: number;
    role: string;
    provenance: { specVersion: string; engineVersion: string; snapshotId: string };
  };
  warnings?: string[];
  resourceConflicts?: string[];
  planningChanges?: Array<{
    action: "REORDER";
    machineCode: string;
    orderId: string;
    fromPosition: number;
    toPosition: number;
    reason: string;
    expectedImpact: Record<string, string | number>;
  }>;
  validation?: {
    status: "feasible" | "blocked" | "incomplete" | "not_evaluated";
    hardViolations: number;
    unknowns: number;
    reason: string;
  };
}
interface AiAnalysisEnvelope {
  result: AiPlanningAnalysis;
  modelUsed: string;
  usage: Record<string, unknown>;
  durationMs: number;
  createdAt: string;
  cached: boolean;
  fallback?: boolean;
}
interface OpenRouterModelOption {
  id: string;
  name: string;
  contextLength: number | null;
  pricing: { prompt?: string; completion?: string } | null;
}

const providerModelOptions: Record<
  IntelligenceWeights["aiProvider"],
  Array<{ id: string; name: string }>
> = {
  openai: [
    { id: "gpt-4.1-mini", name: "GPT-4.1 mini · rápido e econômico" },
    { id: "gpt-4.1", name: "GPT-4.1 · maior capacidade de análise" },
    { id: "gpt-5-mini", name: "GPT-5 mini · raciocínio mais forte" },
    { id: "gpt-4o-mini", name: "GPT-4o mini · alternativa econômica" },
  ],
  lmstudio: [],
  openclaw: [],
  openrouter: [],
};

const defaultSettings: MachineLoadSettings = {
  billetBarWeightKg: 415,
  extrusionEfficiency: 0.85,
  defaultProductivityKgH: DEFAULT_PRODUCTIVITY_KG_H,
  setupMinutes: 20,
  alloyChangeMinutes: 15,
  toolChangeMinutes: 1,
  toolHeatingMinutes: 240,
  ovenCount: 3,
  ovenSlotsPerOven: 7,
  ovenSlots: 21,
};
const numberValue = (value: unknown) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9,.-]/g, "");
  if (!cleaned || /^[-.,]+$/.test(cleaned)) return 0;
  const negative = cleaned.startsWith("-");
  const unsigned = cleaned.replace(/-/g, "");
  const comma = unsigned.lastIndexOf(",");
  const dot = unsigned.lastIndexOf(".");
  let normalized = unsigned;

  if (comma >= 0 && dot >= 0) {
    // The last separator is the decimal separator: 1.234,56 or 1,234.56.
    normalized = comma > dot
      ? `${unsigned.replace(/\./g, "").replace(",", ".")}`
      : unsigned.replace(/,/g, "");
  } else if (comma >= 0) {
    const fraction = unsigned.slice(comma + 1);
    normalized = fraction.length <= 2
      ? unsigned.replace(",", ".")
      : unsigned.replace(/,/g, "");
  } else if (dot >= 0) {
    const parts = unsigned.split(".");
    if (parts.length > 2) {
      const last = parts.at(-1) ?? "";
      const thousands = parts.slice(1).every((part) => part.length === 3);
      normalized = thousands
        ? parts.join("")
        : `${parts.slice(0, -1).join("")}.${last}`;
    } else {
      const [whole = "", fraction = ""] = parts;
      // Preserve Brazilian thousand notation such as 1.300 while keeping
      // decimal database values such as 0.85 and 405.0 intact.
      normalized = fraction.length === 3 && whole.length > 0 && whole.length <= 3 && whole !== "0"
        ? `${whole}${fraction}`
        : unsigned;
    }
  }

  const parsed = Number(`${negative ? "-" : ""}${normalized}`);
  return Number.isFinite(parsed) ? parsed : 0;
};
const textValue = (...values: unknown[]) =>
  values
    .map((value) =>
      typeof value === "string" || typeof value === "number"
        ? String(value).trim()
        : "",
    )
    .find(Boolean) ?? "";
const formatNumber = (value: number, digits = 1) =>
  value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const formatDuration = (minutes: number) =>
  `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, "0")}min`;
const formatDateTime = (date: Date | null) =>
  date
    ? date.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const machineLabel = (code: string) =>
  code === "18"
    ? "Prensa 1.8"
    : code === "19"
      ? "Prensa 1.9"
      : `Prensa ${code}`;
const toInputDateTime = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};
const parseInputDateTime = (value: string) => {
  const [datePart, timePart] = value.split("T");
  if (!datePart || !timePart) return null;
  const [year, month, day] = datePart.split("-").map(Number);
  const [hours, minutes] = timePart.split(":").map(Number);
  const date = new Date(year, month - 1, day, hours, minutes);
  return Number.isNaN(date.getTime()) ? null : date;
};
const sourceLabel: Record<ProductivitySource, string> = {
  simplificada: "Ult. Prod.",
  aprendizado: "Aprendizado",
  ficha: "Ficha",
  ferramenta: "Histórico",
  padrao: "Padrão",
};

function hydrateSimulation(value: unknown) {
  return JSON.parse(JSON.stringify(value), (key, item) =>
    key.endsWith("At") && typeof item === "string" ? new Date(item) : item,
  ) as ReturnType<typeof simulateMachineLoad>;
}

function readSheetProductivity(parameters: Record<string, unknown> | null) {
  if (!parameters) return 0;
  return normalizeProductivityKgH(
    parameters.target_productivity_kg_h ??
      parameters.productivity_kg_h ??
      parameters.produtividade_kg_h ??
      parameters.produtividade,
  ) ?? 0;
}

function nestedRecord(parameters: Record<string, unknown> | null, key: string) {
  const value = parameters?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function aiDecisionPacket(
  simulation: ReturnType<typeof simulateMachineLoad>,
  analysis: PlanningAnalysis,
  mode: string,
  generatedAt: Date,
  stock: BilletStockSummary[],
  carcasses: CarcassResource[],
  bos: BoResource[],
  decisionSystem?: Record<string, unknown>,
) {
  const rawEvaluation = decisionSystem?.evaluation as
    | { hardViolations?: number; missingData?: string[] }
    | undefined;
  const validation = deterministicValidation({
    hardViolations: rawEvaluation?.hardViolations,
    missingData: rawEvaluation?.missingData,
  });
  const sourcePending = unresolvedPlanningAssumptions();
  const provenance = packetProvenance(
    {
      mode,
      generatedAt: generatedAt.toISOString(),
      machines: simulation.machines.map((machine) => machine.machineCode),
      orders: simulation.machines.flatMap((machine) => machine.items.map((item) => item.id)),
      score: analysis.score.overall,
    },
    SIMULATION_MODEL_VERSION,
  );
  return {
    schemaVersion: 4,
    generatedAt: generatedAt.toISOString(),
    role: "planning" as const,
    mode,
    provenance,
    decisionSystem,
    score: {
      overall: analysis.score.overall,
      label: analysis.score.label,
      criteria: analysis.score.criteria.map((item) => ({
        key: item.key,
        score: Math.round(item.score),
        weight: item.weight,
        explanation: item.explanation,
      })),
    },
    machines: simulation.machines.map((machine) => ({
      machineCode: machine.machineCode,
      thermalCoverage: machine.thermalCoverage,
      items: machine.items.map((item, index) => ({
        orderId: item.id,
        position: index + 1,
        toolCode: item.toolCode,
        orderNumber: item.orderNumber,
        alloy: item.selectedAlloy,
        netKg: Math.round(item.remainingKg * 10) / 10,
        rawKg: Math.round(item.billetRequiredKg * 10) / 10,
        productivityKgH: Math.round(item.productivityKgH),
        durationMinutes: Math.round(item.theoreticalMinutes),
        holes: item.holes ?? null,
        bo: item.boCode ?? null,
        carcass: item.carcassCode ?? null,
        packageMeasureMm: item.packageMeasureMm ?? null,
        carcassDiameterMm: item.carcassDiameterMm ?? null,
        startsAt: item.startAt.toISOString(),
        endsAt: item.endAt.toISOString(),
        dueDate: item.dueDate ?? null,
        thermalWaitMinutes: Math.round(item.thermalWaitMinutes),
        resourceWaitMinutes: Math.round(item.resourceWaitMinutes),
        conflicts: item.resourceConflicts.map((conflict) => conflict.message),
      })),
    })),
    materials: simulation.billets.map((item) => ({
      ...item,
      availableBars:
        stock.find((stockItem) => stockItem.alloyCode === item.alloyCode)
          ?.availableBars ?? 0,
    })),
    resources: {
      carcasses: carcasses.map((item) => ({
        code: item.carcassCode,
        available: item.availableQuantity,
        status: item.status,
      })),
      bos: bos.map((item) => ({
        code: item.boCode,
        available: item.availableQuantity,
        status: item.status,
      })),
      ovenDesign: simulation.machines.map(machine => ({ machine: machine.machineCode, slots: machine.thermalCoverage.ovenSlots })),
      conflicts: simulation.conflicts.map((item) => ({
        type: item.type,
        resource: item.resourceCode,
        machine: item.machineCode,
        tool: item.toolCode,
        delayMinutes: Math.round(item.delayMinutes),
        severity: item.severity,
      })),
    },
    deterministic: {
      facts: [
        ...analysis.score.criteria.map((criterion) => ({
          id: `criterion:${criterion.key}`,
          label: criterion.explanation,
          kind: "calculation" as const,
        })),
        ...simulation.machines.map((machine) => ({
          id: `coverage:${machine.machineCode}`,
          label: `Prensa ${machine.machineCode}: ${Math.round(machine.thermalCoverage.predictedIdleMinutes)} min de espera térmica previstos.`,
          kind: "calculation" as const,
        })),
      ],
      risks: simulation.conflicts.map((conflict) => ({
        type: conflict.type,
        message: conflict.message,
        severity: conflict.severity,
        machineCode: conflict.machineCode,
        orderId: conflict.orderId,
      })),
      missingData: [...new Set([...(rawEvaluation?.missingData ?? []), ...sourcePending])],
      validation,
    },
    deterministicRecommendations: analysis.recommendations.map((item) => ({
      priority: item.priority,
      category: item.category,
      title: item.title,
      reason: item.reason,
      action: item.action,
      impact: item.impact,
      responsibleRole: item.responsibleRole,
      steps: item.steps,
      successCheck: item.successCheck,
      toolCode: item.toolCode ?? null,
      machineCode: item.machineCode ?? null,
    })),
  };
}

export function MachineLoadSimulator() {
  const { role, user_id: userId, machine_codes: userMachineCodes } = useCurrentUser();
  const { visibility: sectionVisibility } =
    useMachineLoadSectionVisibility(userId);
  const canPlan = role === "admin" || role === "pcp";
  const allowedMachines = useMemo(
    () =>
      canPlan || !userMachineCodes?.length ? null : new Set(userMachineCodes),
    [canPlan, userMachineCodes],
  );
  const [orders, setOrders] = useState<LoadOrderInput[]>([]);
  const [decisionProfile, setDecisionProfile] = useState<DecisionProfile>(() => structuredClone(decisionPresets[0]));
  const [settings, setSettings] = useState<Record<string, MachineLoadSettings>>(
    {},
  );
  const [shifts, setShifts] = useState<WorkShiftInput[]>([]);
  const [overtimePeriods, setOvertimePeriods] = useState<OvertimePeriodInput[]>([]);
  const [billetStock, setBilletStock] = useState<BilletStockSummary[]>([]);
  const [billetStockAvailable, setBilletStockAvailable] = useState(false);
  const [carcassResources, setCarcassResources] = useState<CarcassResource[]>(
    [],
  );
  const [carcassResourcesAvailable, setCarcassResourcesAvailable] =
    useState(false);
  const [boResources, setBoResources] = useState<BoResource[]>([]);
  const [boResourcesAvailable, setBoResourcesAvailable] = useState(false);
  const [unavailability, setUnavailability] = useState<
    ResourceUnavailabilityInput[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"fifo" | "optimized" | "manual">(
    "optimized",
  );
  const [manualOrder, setManualOrder] = useState<Record<string, string[]>>({});
  const [sequenceChanges, setSequenceChanges] = useState<NonNullable<DecisionCandidate["sequenceChange"]>[]>([]);
  const [machine, setMachine] = useState("all");
  const [tab, setTab] = useState<"timeline" | "gantt" | "billets">("timeline");
  const [expandedSections, setExpandedSections] = useState<
    Record<(typeof machineLoadSectionKeys)[number], boolean>
  >({
    intelligence: false,
    copilot: false,
    learning: false,
    thermal: false,
    alerts: false,
    simulation: false,
  });
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [startInput, setStartInput] = useState("");
  const [scenarioPanel, setScenarioPanel] = useState<"save" | "list" | null>(
    null,
  );
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioDescription, setScenarioDescription] = useState("");
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenarioBusy, setScenarioBusy] = useState(false);
  const [scenarioError, setScenarioError] = useState("");
  const [scenarioNotice, setScenarioNotice] = useState("");
  const [historicalScenario, setHistoricalScenario] =
    useState<LoadedScenario | null>(null);
  const [comparePanel, setComparePanel] = useState(false);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [intelligence, setIntelligence] = useState<IntelligencePayload>({
    settings: defaultIntelligenceWeights,
    summary: {
      observations: 0,
      predictionsCompared: 0,
      meanAbsoluteErrorPercent: 0,
      confidencePercent: 0,
    },
    groups: [],
    recent: [],
  });
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisEnvelope | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");

  const load = useCallback(async function load() {
    setLoading(true);
    setError("");
    try {
      if (!isSupabaseConfigured()) throw new Error("Supabase não configurado.");
      const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
      if (!organizationId)
        throw new Error("Organização padrão não configurada.");
      const supabase = createClient();
      const [
        ordersResult,
        sheetsResult,
        toolsResult,
        cyclesResult,
        alloysResult,
        productionSettingsResponse,
        billetStockResponse,
        carcassResponse,
        boResponse,
        calendarResponse,
        mappingResponse,
        intelligenceResponse,
      ] = await Promise.all([
        supabase
          .from("production_orders")
          .select(
            "id,order_number,plan_code,machine_code,tool_code,alloy_code,target_kg,produced_kg,sequence,due_date,status,last_productivity_kg_h,holes,bo_code,carcass_code,package_measure_mm,carcass_diameter_mm,source_data",
          )
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .in("status", ["planned", "released", "in_progress", "paused"])
          .order("machine_code")
          .order("sequence"),
        supabase
          .from("process_sheets")
          .select("tool_code,machine_code,parameters")
          .eq("organization_id", organizationId)
          .eq("is_active", true),
        (async () => {
          const allTools: RawTool[] = [];
          const pageSize = 500;
          for (let offset = 0; ; offset += pageSize) {
            const page = await supabase.from("tools")
              .select("code,matrix_code,productivity_kg_h,holes,bo,sequence_number,source_available,package_measure_mm,carcass_diameter_mm,carcass_code")
              .eq("organization_id", organizationId)
              .order("id")
              .range(offset, offset + pageSize - 1);
            if (page.error) throw page.error;
            allTools.push(...(page.data ?? []) as RawTool[]);
            if ((page.data?.length ?? 0) < pageSize) break;
          }
          return { data: allTools, error: null };
        })(),
        supabase
          .from("tool_heating_cycle_orders")
          .select(
            "production_order_id,tool_heating_cycles!inner(status,entered_at,expected_ready_at,released_at,oven_position,organization_id,tool_ovens(code,name,machine_code))",
          )
          .eq("tool_heating_cycles.organization_id", organizationId)
          .in("tool_heating_cycles.status", ["heating", "released"]),
        supabase
          .from("tool_alloy_options")
          .select("tool_code,alloy_code,is_primary")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("priority"),
        fetch("/api/production-settings", { cache: "no-store" }),
        fetch("/api/billet-stock", { cache: "no-store" }),
        fetch("/api/press-resources", { cache: "no-store" }),
        fetch("/api/bo-resources", { cache: "no-store" }),
        fetch("/api/resource-calendar", { cache: "no-store" }),
        fetch("/api/tool-carcass-mappings", { cache: "no-store" }),
        fetch("/api/planning-intelligence", { cache: "no-store" }),
      ]);
      const firstError = [
        ordersResult.error,
        sheetsResult.error,
        toolsResult.error,
        cyclesResult.error,
        alloysResult.error,
      ].find(Boolean);
      if (firstError) throw firstError;
      const productionSettings = (await productionSettingsResponse
        .json()
        .catch(() => ({}))) as ProductionSettingsPayload & { error?: string };
      if (!productionSettingsResponse.ok)
        throw new Error(
          productionSettings.error ||
            "Não foi possível carregar os turnos de produção.",
        );
      const stockPayload = (await billetStockResponse
        .json()
        .catch(() => null)) as BilletStockPayload | null;
      setBilletStock(
        billetStockResponse.ok ? (stockPayload?.summary ?? []) : [],
      );
      setBilletStockAvailable(billetStockResponse.ok);
      const carcassPayload = (await carcassResponse
        .json()
        .catch(() => null)) as CarcassResource[] | null;
      setCarcassResources(
        carcassResponse.ok && Array.isArray(carcassPayload)
          ? carcassPayload
          : [],
      );
      setCarcassResourcesAvailable(carcassResponse.ok);
      const boPayload = (await boResponse.json().catch(() => null)) as
        BoResource[] | null;
      setBoResources(
        boResponse.ok && Array.isArray(boPayload) ? boPayload : [],
      );
      setBoResourcesAvailable(boResponse.ok);
      const mappingPayload = (await mappingResponse
        .json()
        .catch(() => null)) as CarcassMappingPayload | null;
      const intelligencePayload = (await intelligenceResponse
        .json()
        .catch(() => null)) as IntelligencePayload | null;
      const learningGroups = Array.isArray(intelligencePayload?.groups)
        ? intelligencePayload.groups
        : [];
      if (intelligenceResponse.ok && intelligencePayload?.settings)
        setIntelligence({
          ...intelligencePayload,
          settings: {
            ...defaultIntelligenceWeights,
            ...intelligencePayload.settings,
          },
          groups: learningGroups,
          recent: Array.isArray(intelligencePayload.recent)
            ? intelligencePayload.recent
            : [],
          summary: intelligencePayload.summary ?? {
            observations: 0,
            predictionsCompared: 0,
            meanAbsoluteErrorPercent: 0,
            confidencePercent: 0,
          },
        });
      const calendarPayload = (await calendarResponse
        .json()
        .catch(() => null)) as RawUnavailability[] | null;
      setUnavailability(
        calendarResponse.ok && Array.isArray(calendarPayload)
          ? calendarPayload.map((period) => ({
              ...period,
              startsAt: new Date(period.startsAt),
              endsAt: new Date(period.endsAt),
            }))
          : [],
      );
      const rawOrders = (ordersResult.data ?? []) as RawOrder[];
      const rawSheets = (sheetsResult.data ?? []) as RawSheet[];
      const rawTools = (toolsResult.data ?? []) as RawTool[];
      const rawSettings = productionSettings.settings ?? [];
      const rawCycles = (cyclesResult.data ?? []) as unknown as RawCycleOrder[];
      const rawAlloys = (alloysResult.data ?? []) as RawAlloy[];
      const settingMap: Record<string, MachineLoadSettings> = {};
      for (const code of [
        ...new Set(rawOrders.map((order) => order.machine_code)),
      ]) {
        const row = rawSettings.find((item) => item.machine_code === code);
        settingMap[code] = row
          ? {
              billetBarWeightKg: numberValue(row.billet_bar_weight_kg),
              extrusionEfficiency: numberValue(row.extrusion_efficiency),
              defaultProductivityKgH:
                normalizeProductivityKgH(row.default_productivity_kg_h) ??
                DEFAULT_PRODUCTIVITY_KG_H,
              setupMinutes: row.setup_minutes,
              alloyChangeMinutes: row.alloy_change_minutes,
              toolChangeMinutes: row.tool_change_minutes == null ? 1 : Math.max(numberValue(row.tool_change_minutes), 0),
              toolHeatingMinutes: row.tool_heating_minutes,
              ovenCount: Math.max(numberValue(row.oven_count) || 3, 1),
              ovenSlotsPerOven: Math.max(
                numberValue(row.oven_slots_per_oven) || 7,
                1,
              ),
              ovenSlots:
                Math.max(numberValue(row.oven_count) || 3, 1) *
                Math.max(numberValue(row.oven_slots_per_oven) || 7, 1),
            }
          : { ...defaultSettings };
      }
      const input = rawOrders.map((order) => {
        const sourceData = order.source_data ?? {};
        const requestedToolSequence =
          Math.round(
            numberValue(
              sourceData.sequencia ??
                sourceData.sequenceNumber ??
                sourceData.toolSequence,
            ),
          ) || null;
        const sheet = rawSheets.find(
          (item) =>
            item.tool_code.toUpperCase() === order.tool_code.toUpperCase() &&
            (!item.machine_code || item.machine_code === order.machine_code),
        );
        const tool = selectPhysicalTool(rawTools, order.tool_code, requestedToolSequence);
        const sheetExtrusion = nestedRecord(
          sheet?.parameters ?? null,
          "extrusion",
        );
        const sheetBillet = nestedRecord(sheet?.parameters ?? null, "billet");
        const learned = learningGroups
          .filter(
            (item) =>
              item.calibrated &&
              item.tool_code.toUpperCase() === order.tool_code.toUpperCase() &&
              item.machine_code === order.machine_code &&
              (!item.tool_sequence || item.tool_sequence === requestedToolSequence),
          )
          .sort(
            (left, right) =>
              Number(right.tool_sequence === requestedToolSequence) -
              Number(left.tool_sequence === requestedToolSequence),
          )[0];
        const sources: Array<[number | null, ProductivitySource]> = [
          [normalizeProductivityKgH(order.last_productivity_kg_h), "simplificada"],
          [normalizeProductivityKgH(readSheetProductivity(sheet?.parameters ?? null)), "ficha"],
          [normalizeProductivityKgH(tool?.productivity_kg_h), "ferramenta"],
          [normalizeProductivityKgH(learned?.average_actual_productivity_kg_h), "aprendizado"],
          [DEFAULT_PRODUCTIVITY_KG_H, "padrao"],
        ];
        const productivity = sources.find(([value]) => value !== null) ?? [
          DEFAULT_PRODUCTIVITY_KG_H,
          "padrao" as const,
        ];
        const guardedProductivity = guardProductivityKgH(productivity[0], order.alloy_code);
        const guardedProductivitySource: ProductivitySource =
          productivity[0] !== guardedProductivity ? "padrao" : productivity[1];
        const cycle = rawCycles.find(
          (item) => item.production_order_id === order.id,
        )?.tool_heating_cycles;
        const toolHeatingState =
          cycle?.status === "released"
            ? "released"
            : cycle?.status === "heating"
              ? "heating"
              : "waiting";
        const toolReadyAt =
          cycle?.status === "released"
            ? new Date()
            : cycle?.expected_ready_at
              ? new Date(cycle.expected_ready_at)
              : null;
        const matchingMappings = (mappingPayload?.mappings ?? []).filter(
          (item) =>
            item.isActive &&
            item.toolCode.toUpperCase() === order.tool_code.toUpperCase() &&
            (!item.machineCode || item.machineCode === order.machine_code) &&
            (!item.sequenceNumber || item.sequenceNumber === requestedToolSequence),
        );
        const mapping = matchingMappings.sort(
          (left, right) =>
            Number(right.sequenceNumber === requestedToolSequence) -
              Number(left.sequenceNumber === requestedToolSequence) ||
            Number(!!right.machineCode) - Number(!!left.machineCode),
        )[0];
        const packageMeasureMm =
          numberValue(order.package_measure_mm) ||
          numberValue(sourceData.medidaPacote) ||
          numberValue(tool?.package_measure_mm) ||
          null;
        const carcassDiameterMm =
          numberValue(order.carcass_diameter_mm) ||
          numberValue(sourceData.diametro) ||
          numberValue(tool?.carcass_diameter_mm) ||
          null;
        const derivedCarcass =
          packageMeasureMm && carcassDiameterMm
            ? `${carcassDiameterMm}X${packageMeasureMm}`
            : "";
        return {
          id: order.id,
          orderNumber: order.order_number,
          planCode: order.plan_code ?? "—",
          machineCode: order.machine_code,
          toolCode: order.tool_code,
          alloyCode: order.alloy_code ?? "SEM LIGA",
          alternativeAlloys: rawAlloys
            .filter(
              (item) =>
                item.tool_code.toUpperCase() ===
                  order.tool_code.toUpperCase() && !item.is_primary,
            )
            .map((item) => item.alloy_code),
          targetKg: numberValue(order.target_kg),
          producedKg: numberValue(order.produced_kg),
          sequence: order.sequence ?? 9999,
          dueDate: order.due_date,
          status: order.status,
          productivityKgH: guardedProductivity,
          productivitySource: guardedProductivitySource,
          toolReadyAt,
          toolHeatingState,
          toolHeatingEnteredAt: cycle?.entered_at ? new Date(cycle.entered_at) : null,
          toolOvenCode: cycle?.tool_ovens?.code ?? null,
          toolOvenPosition: cycle?.oven_position ?? null,
          holes:
            numberValue(order.holes) ||
            numberValue(sourceData.furos) ||
            numberValue(sheetExtrusion.holes) ||
            tool?.holes ||
            null,
          boCode: textValue(order.bo_code, sourceData.bo, tool?.bo) || null,
          packageMeasureMm,
          carcassDiameterMm,
          carcassCode:
            textValue(
              order.carcass_code,
              derivedCarcass,
              sourceData.carcaca,
              sourceData.carcassCode,
              sheetBillet.casing,
              tool?.carcass_code,
              mapping?.carcassCode,
            ) || null,
          carcassQuantity: mapping?.quantity ?? 1,
        } satisfies LoadOrderInput;
      });
      setOrders(input);
      setSettings(settingMap);
      setShifts(
        (productionSettings.shifts ?? []).map((shift) => ({
          id: shift.id,
          code: shift.code,
          name: shift.name,
          startTime: shift.start_time.slice(0, 5),
          endTime: shift.end_time.slice(0, 5),
          breakMinutes: shift.break_minutes,
          machineCodes: shift.machine_codes ?? [],
          isActive: shift.is_active,
        })),
      );
      setOvertimePeriods((productionSettings.overtime_periods ?? []).map((period) => ({
        id: period.id,
        date: period.work_date,
        startTime: period.start_time.slice(0, 5),
        endTime: period.end_time.slice(0, 5),
        machineCodes: period.machine_codes ?? [],
        reason: period.reason,
        isActive: period.is_active,
      })));
      const initialStart = new Date();
      setStartedAt(initialStart);
      setStartInput(toInputDateTime(initialStart));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível montar a simulação.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const visibleOrders = useMemo(() => {
    const assigned = orders.filter(
      (order) => !allowedMachines || allowedMachines.has(order.machineCode),
    );
    return machine === "all"
      ? assigned
      : assigned.filter((order) => order.machineCode === machine);
  }, [orders, machine, allowedMachines]);
  const orderedVisibleOrders = useMemo(() => {
    if (mode !== "manual") return visibleOrders;
    return visibleOrders.map((order) => {
      const machineOrder = manualOrder[order.machineCode] ?? [];
      const position = machineOrder.indexOf(order.id);
      return {
        ...order,
        sequence:
          position >= 0 ? position + 1 : machineOrder.length + order.sequence,
      };
    });
  }, [visibleOrders, mode, manualOrder]);
  const machineOptions = [
    ...new Set(
      orders
        .map((order) => order.machineCode)
        .filter((code) => !allowedMachines || allowedMachines.has(code)),
    ),
  ].sort();
  const decisionResources = useMemo(() => ({
            carcasses: carcassResources.map((item) => ({
              code: item.carcassCode,
              totalQuantity: item.totalQuantity,
              unavailableQuantity: item.unavailableQuantity,
              capacity:
                item.status === "available"
                  ? Math.max(
                      item.physicalAvailableQuantity ??
                        item.totalQuantity - item.unavailableQuantity,
                      0,
                    )
                  : 0,
              reservations: (item.reservations ?? []).map((reservation) => ({
                ...reservation,
                startsAt: reservation.startsAt
                  ? new Date(reservation.startsAt)
                  : null,
                endsAt: reservation.endsAt
                  ? new Date(reservation.endsAt)
                  : null,
              })),
            })),
            bos: boResources.map((item) => ({
              code: item.boCode,
              capacity:
                item.status === "available" ? item.availableQuantity : 0,
            })),
          }), [carcassResources, boResources]);
  const simulationState = useMemo(() => {
    if (!startedAt) return { simulation: null, problem: "" };
    try {
      return {
        simulation: simulateMachineLoad(
          orderedVisibleOrders,
          settings,
          startedAt,
          mode === "manual" ? "fifo" : mode,
          shifts,
          unavailability,
          decisionResources,
          overtimePeriods,
        ),
        problem: "",
      };
    } catch (cause) {
      return {
        simulation: null,
        problem:
          cause instanceof Error
            ? cause.message
            : "Não foi possível aplicar os turnos.",
      };
    }
  }, [
    orderedVisibleOrders,
    settings,
    startedAt,
    mode,
    shifts,
    overtimePeriods,
    unavailability,
    decisionResources,
  ]);
  const currentAnalysis = useMemo(
    () =>
      simulationState.simulation
        ? analyzePlanning(
            simulationState.simulation,
            billetStock.map((item) => ({
              alloyCode: item.alloyCode,
              availableBars: item.availableBars,
              availableWeightKg: numberValue(item.availableWeightKg),
            })),
            intelligence.settings,
          )
        : null,
    [simulationState.simulation, billetStock, intelligence.settings],
  );
  const decisionContext = useMemo<DecisionContext | null>(() => startedAt && simulationState.simulation ? ({
    // A sequência da Simplificada fica preservada separadamente. Mesmo em modo
    // manual ou sugerido, os quatro cenários sempre partem do mesmo baseline.
    orders: orderedVisibleOrders.map((order) => ({ ...order })),
    originalOrders: visibleOrders.map((order) => ({ ...order })),
    settings, start: startedAt, shifts, unavailable: unavailability, overtimePeriods, resources: decisionResources,
    stock: billetStock.map(item => ({ alloyCode: item.alloyCode, availableBars: item.availableBars, availableWeightKg: numberValue(item.availableWeightKg) })),
    stockKnown: billetStockAvailable,
  }) : null, [startedAt, simulationState.simulation, orderedVisibleOrders, visibleOrders, settings, shifts, unavailability, overtimePeriods, decisionResources, billetStock, billetStockAvailable]);
  function applyDecisionCandidate(candidate: DecisionCandidate) {
    if (!canPlan) { setScenarioNotice("Seu acesso permite consultar. Peça ao PCP para aplicar a sequência."); return; }
    const currentIds = new Set(orderedVisibleOrders.filter(order => order.targetKg > order.producedKg).map(order => order.id));
    const proposedIds = Object.values(candidate.orderIds).flat();
    if (proposedIds.length !== currentIds.size || new Set(proposedIds).size !== currentIds.size || proposedIds.some(id => !currentIds.has(id))) {
      setScenarioNotice("A carga mudou. Gere uma nova alternativa antes de aplicar."); return;
    }
    setManualOrder(candidate.orderIds); setMode("manual"); setHistoricalScenario(null);
    if (candidate.sequenceChange) setSequenceChanges(current => [...current, candidate.sequenceChange!]);
    setAiAnalysis(null);
    setScenarioNotice(`Estratégia "${candidate.name}" carregada para avaliação manual. Confira e salve o cenário se desejar.`);
  }
  async function openScenarioList() {
    setScenarioBusy(true);
    setScenarioError("");
    setScenarioPanel("list");
    try {
      const response = await fetch("/api/simulation-scenarios", {
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => null)) as
        ScenarioSummary[] | { error?: string } | null;
      if (!response.ok)
        throw new Error(
          !Array.isArray(payload) && payload?.error
            ? payload.error
            : "Não foi possível carregar os cenários.",
        );
      setScenarios(Array.isArray(payload) ? payload : []);
    } catch (cause) {
      setScenarioError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível carregar os cenários.",
      );
    } finally {
      setScenarioBusy(false);
    }
  }

  async function openSavedScenario(id: string) {
    setScenarioBusy(true);
    setScenarioError("");
    try {
      const response = await fetch(
        `/api/simulation-scenarios?id=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json().catch(() => null)) as
        | (Omit<LoadedScenario, "result"> & { result: unknown })
        | { error?: string }
        | null;
      if (!response.ok || !payload || !("result" in payload))
        throw new Error(
          payload && "error" in payload && payload.error
            ? payload.error
            : "Não foi possível abrir o cenário.",
        );
      const loaded: LoadedScenario = {
        ...payload,
        result: hydrateSimulation(payload.result),
      };
      setHistoricalScenario(loaded);
      setSequenceChanges(loaded.inputs?.sequenceChanges ?? []);
      setScenarioId(loaded.scenarioId);
      setScenarioName(loaded.name);
      setScenarioDescription(loaded.description ?? "");
      setMode(loaded.mode);
      const requestedStart = new Date(loaded.requestedStartAt);
      if (!Number.isNaN(requestedStart.getTime())) {
        setStartedAt(requestedStart);
        setStartInput(toInputDateTime(requestedStart));
      }
      if (loaded.inputs?.selectedMachine)
        setMachine(loaded.inputs.selectedMachine);
      setScenarioPanel(null);
    } catch (cause) {
      setScenarioError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível abrir o cenário.",
      );
    } finally {
      setScenarioBusy(false);
    }
  }

  async function saveScenario() {
    if (!simulationState.simulation || !startedAt) return;
    setScenarioBusy(true);
    setScenarioError("");
    try {
      const response = await fetch("/api/simulation-scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scenarioId,
          name: scenarioName,
          description: scenarioDescription,
          machineCode: machine,
          mode,
          requestedStartAt: startedAt.toISOString(),
          inputSnapshot: {
            selectedMachine: machine,
            manualOrder,
            sequenceChanges,
            orders: orderedVisibleOrders,
          },
          rulesSnapshot: {
            modelVersion: SIMULATION_MODEL_VERSION,
            decisionProfile,
            settingsByMachine: settings,
            shifts,
            unavailability,
            billetStock: {
              confirmed: billetStockAvailable,
              capturedAt: new Date().toISOString(),
              summary: billetStock,
            },
            carcassResources: {
              capturedAt: new Date().toISOString(),
              items: carcassResources,
            },
            boResources: {
              capturedAt: new Date().toISOString(),
              items: boResources,
            },
          },
          resultSnapshot: simulationState.simulation,
          analysisSnapshot: { ...currentAnalysis, decision: decisionContext ? evaluateDecision(simulationState.simulation, decisionProfile, decisionContext.stock, decisionContext.stockKnown) : null },
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        id?: string;
        versionNumber?: number;
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || "Não foi possível salvar o cenário.");
      const savedScenarioId = payload?.id ?? scenarioId;
      setScenarioId(savedScenarioId);
      setScenarioNotice(
        `${savedScenarioId ? `${simulationDisplayId(savedScenarioId)} · ` : ""}cenário salvo com segurança como versão ${payload?.versionNumber ?? 1}.`,
      );
      setScenarioPanel(null);
    } catch (cause) {
      setScenarioError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar o cenário.",
      );
    } finally {
      setScenarioBusy(false);
    }
  }

  async function approveAndApplyScenario() {
    if (!historicalScenario || historicalScenario.status === "approved") return;
    setApprovalBusy(true);
    setScenarioError("");
    setScenarioNotice("");
    try {
      const response = await fetch("/api/simulation-scenarios", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "approve-and-apply",
          scenarioId: historicalScenario.scenarioId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(
          payload?.error || "Não foi possível aprovar o cenário.",
        );
      setHistoricalScenario({ ...historicalScenario, status: "approved" });
      setScenarioNotice(
        `${simulationDisplayId(historicalScenario.scenarioId)} · v${historicalScenario.versionNumber} aprovada e aplicada às prensas. A Simplificada original foi preservada para consulta e auditoria.`,
      );
    } catch (cause) {
      setScenarioError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível aprovar o cenário.",
      );
    } finally {
      setApprovalBusy(false);
    }
  }

  async function saveIntelligenceWeights(weights: IntelligenceWeights) {
    const response = await fetch("/api/planning-intelligence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(weights),
    });
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      settings?: IntelligenceWeights;
      savedAt?: string;
    } | null;
    if (!response.ok)
      throw new Error(
        payload?.error || "Não foi possível salvar os critérios.",
      );
    if (!payload?.settings)
      throw new Error("O banco não confirmou os critérios salvos.");
    setIntelligence((current) => ({ ...current, settings: payload.settings! }));
    setScenarioNotice(
      "Critérios da nota atualizados e registrados na auditoria.",
    );
    return payload.settings;
  }

  if (loading)
    return (
      <div className="grid min-h-72 place-items-center rounded-2xl border bg-white">
        <Loader2 className="size-7 animate-spin text-orange-500" />
      </div>
    );
  if (error)
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700">
        <TriangleAlert className="size-5" />
        {error}
        <Button variant="outline" size="sm" onClick={load}>
          Tentar novamente
        </Button>
      </div>
    );
  if (!historicalScenario && simulationState.problem)
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 size-5 shrink-0" />
          <div>
            <strong className="block">
              Simulação aguardando calendário de produção
            </strong>
            <p className="mt-1">{simulationState.problem}</p>
            <a
              href="/configuracoes/producao"
              className="mt-3 inline-flex rounded-xl bg-amber-900 px-3 py-2 text-xs font-bold text-white"
            >
              Cadastrar ou ajustar turnos
            </a>
          </div>
        </div>
      </div>
    );
  const simulation = historicalScenario?.result ?? simulationState.simulation;
  if (!simulation) return null;
  const shiftGoals = evaluateShiftGoals(simulation);
  const simulatedMachines = simulation.machines;
  const displayedBilletStock = historicalScenario
    ? (historicalScenario.rules?.billetStock?.summary ?? [])
    : billetStock;
  const hasBilletStockSnapshot = historicalScenario
    ? !!historicalScenario.rules?.billetStock
    : billetStockAvailable;
  const displayedCarcassResources = historicalScenario
    ? (historicalScenario.rules?.carcassResources?.items ?? [])
    : carcassResources;
  const hasCarcassSnapshot = historicalScenario
    ? !!historicalScenario.rules?.carcassResources
    : carcassResourcesAvailable;
  const displayedBoResources = historicalScenario
    ? (historicalScenario.rules?.boResources?.items ?? [])
    : boResources;
  const hasBoSnapshot = historicalScenario
    ? !!historicalScenario.rules?.boResources
    : boResourcesAvailable;
  const displayedUnavailability = historicalScenario
    ? (historicalScenario.rules?.unavailability ?? [])
    : unavailability;
  const planningAnalysis =
    historicalScenario?.analysis ??
    (historicalScenario
      ? analyzePlanning(
          simulation,
          displayedBilletStock.map((item) => ({
            alloyCode: item.alloyCode,
            availableBars: item.availableBars,
            availableWeightKg: numberValue(item.availableWeightKg),
          })),
          intelligence.settings,
        )
      : currentAnalysis);
  const estimatedEnd = simulation.machines.reduce<Date | null>(
    (latest, item) =>
      !item.endsAt
        ? latest
        : !latest || item.endsAt > latest
          ? item.endsAt
          : latest,
    null,
  );
  const visibleSectionKeys = machineLoadSectionKeys.filter(
    (key) => sectionVisibility[key],
  );
  const allSectionsExpanded = machineLoadSectionKeys.every(
    (key) => !sectionVisibility[key] || expandedSections[key],
  );
  function toggleSection(key: (typeof machineLoadSectionKeys)[number]) {
    setExpandedSections((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }
  function setAllSections(expanded: boolean) {
    setExpandedSections(
      Object.fromEntries(
        machineLoadSectionKeys.map((key) => [key, expanded]),
      ) as Record<(typeof machineLoadSectionKeys)[number], boolean>,
    );
  }
  async function requestAiAnalysis() {
    if (!planningAnalysis || !startedAt) return;
    setAiBusy(true);
    setAiError("");
    setAiAnalysis(null);
    try {
      const response = await fetch("/api/planning-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          aiDecisionPacket(
            simulation!,
            planningAnalysis,
            mode,
            startedAt,
            displayedBilletStock,
            displayedCarcassResources,
            displayedBoResources,
            !historicalScenario && decisionContext ? {
              profile: decisionProfile,
              evaluation: evaluateDecision(simulation!, decisionProfile, decisionContext.stock, decisionContext.stockKnown),
              instruction: "Explique as regras efetivamente avaliadas. Não transforme estimativas em garantias nem ignore impedimentos."
            } : undefined,
          ),
        ),
      });
      const payload = (await response.json().catch(() => null)) as
        AiAnalysisEnvelope | { error?: string } | null;
      if (!response.ok || !payload || !("result" in payload))
        throw new Error(
          payload && "error" in payload
            ? payload.error
            : "Não foi possível executar a análise por IA.",
        );
      setAiAnalysis(payload);
    } catch (cause) {
      setAiError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível executar a análise por IA.",
      );
    } finally {
      setAiBusy(false);
    }
  }
  function activateManualMode() {
    if (mode !== "manual") {
      setManualOrder(
        Object.fromEntries(
          simulatedMachines.map((item) => [
            item.machineCode,
            item.items.map((row) => row.id),
          ]),
        ),
      );
    }
    setMode("manual");
  }
  function applyAiScenario() {
    const proposed = aiAnalysis?.result.proposedScenario;
    if (!proposed?.machines.length) return;
    setManualOrder(
      Object.fromEntries(
        proposed.machines.map((item) => [
          item.machineCode,
          item.orderedOrderIds,
        ]),
      ),
    );
    setMode("manual");
    setScenarioId(null);
    setHistoricalScenario(null);
    setScenarioName(proposed.title);
    setScenarioDescription(
      `Cenário proposto pela IA para avaliação do PCP. ${proposed.rationale}`,
    );
    setScenarioNotice(
      "Cenário da IA carregado no modo manual. O motor recalculou tempos, recursos e bloqueios; revise e salve se quiser comparar.",
    );
    setTab("timeline");
  }
  function moveManualOrder(
    machineCode: string,
    draggedId: string,
    targetId: string,
  ) {
    if (draggedId === targetId) return;
    setManualOrder((current) => {
      const fallback =
        simulatedMachines
          .find((item) => item.machineCode === machineCode)
          ?.items.map((item) => item.id) ?? [];
      const sequence = [...(current[machineCode] ?? fallback)];
      const from = sequence.indexOf(draggedId);
      const to = sequence.indexOf(targetId);
      if (from < 0 || to < 0) return current;
      sequence.splice(from, 1);
      sequence.splice(to, 0, draggedId);
      return { ...current, [machineCode]: sequence };
    });
  }

  function openSavePanel() {
    if (!scenarioName.trim())
      setScenarioName(
        `Carga ${machine === "all" ? "todas as prensas" : machineLabel(machine)} · ${formatDateTime(startedAt)}`,
      );
    setScenarioError("");
    setScenarioPanel("save");
  }

  function returnToCurrentSimulation() {
    setHistoricalScenario(null);
    setScenarioId(null);
    setScenarioName("");
    setScenarioDescription("");
    setScenarioNotice("");
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><LoadHelpGuide /></div>
      {historicalScenario ? (
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <FolderOpen className="size-5 text-blue-600" />
          <div className="min-w-0 flex-1">
            <strong className="block truncate">
              Histórico: {historicalScenario.name} · versão{" "}
              {historicalScenario.versionNumber}
            </strong>
            <span className="text-xs text-blue-700">
              <span
                className="mr-2 font-mono font-bold"
                title={`ID completo da simulação: ${historicalScenario.scenarioId}`}
              >
                {simulationDisplayId(historicalScenario.scenarioId)}
              </span>
              Cenário congelado em{" "}
              {formatDateTime(new Date(historicalScenario.createdAt))}. Status:{" "}
              {historicalScenario.status === "approved"
                ? "aprovado e aplicado"
                : "calculado, aguardando aprovação"}
              .
            </span>
          </div>
          {canPlan && historicalScenario.status !== "approved" ? (
            <Button
              size="sm"
              disabled={approvalBusy || !simulation.feasible}
              onClick={() => void approveAndApplyScenario()}
            >
              {approvalBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Aprovar sequência de trabalho
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="outline"
            onClick={returnToCurrentSimulation}
          >
            Voltar à simulação atual
          </Button>
        </section>
      ) : null}
      {scenarioError && !scenarioPanel ? (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          <TriangleAlert className="size-4" />
          {scenarioError}
        </div>
      ) : null}
      {scenarioNotice ? (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800">
          <span>{scenarioNotice}</span>
          <button
            type="button"
            aria-label="Fechar aviso"
            onClick={() => setScenarioNotice("")}
          >
            <X className="size-4" />
          </button>
        </div>
      ) : null}
      <section className="flex flex-wrap items-center gap-2 rounded-2xl border bg-white p-3 shadow-sm">
        <select
          disabled={!!historicalScenario}
          value={machine}
          onChange={(event) => setMachine(event.target.value)}
          className="h-10 rounded-xl border bg-white px-3 text-sm font-semibold disabled:bg-slate-100"
        >
          <option value="all">
            {allowedMachines ? "Minhas prensas" : "Todas as prensas"}
          </option>
          {machineOptions.map((code) => (
            <option key={code} value={code}>
              {machineLabel(code)}
            </option>
          ))}
        </select>
        <label className="flex h-10 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-semibold text-slate-600">
          Início da simulação
          <input
            disabled={!!historicalScenario}
            type="datetime-local"
            value={startInput}
            onChange={(event) => {
              setStartInput(event.target.value);
              const parsed = parseInputDateTime(event.target.value);
              if (parsed) setStartedAt(parsed);
            }}
            className="min-w-0 bg-transparent text-sm font-bold text-slate-900 outline-none disabled:text-slate-500"
          />
        </label>
        <div className="flex rounded-xl bg-slate-100 p-1">
          <button
            disabled={!!historicalScenario}
            type="button"
            onClick={() => setMode("fifo")}
            className={`rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-60 ${mode === "fifo" ? "bg-white shadow-sm" : "text-slate-500"}`}
          >
            FIFO
          </button>
          <button
            disabled={!!historicalScenario}
            type="button"
            onClick={() => setMode("optimized")}
            className={`rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-60 ${mode === "optimized" ? "bg-white shadow-sm" : "text-slate-500"}`}
          >
            Sequência sugerida
          </button>
          <button
            disabled={!!historicalScenario}
            type="button"
            onClick={activateManualMode}
            className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-60 ${mode === "manual" ? "bg-orange-500 text-white shadow-sm" : "text-slate-500"}`}
          >
            <GripVertical className="size-3.5" />
            Sequência manual
          </button>
        </div>
        <span className="ml-auto text-xs text-slate-500">
          Base: {formatDateTime(startedAt)}
        </span>
        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
          {shifts
            .filter((shift) => shift.isActive)
            .map((shift) => `${shift.code} ${shift.startTime}–${shift.endTime}`)
            .join(" · ")}
        </span>
        {!historicalScenario && decisionContext ? <Button
          type="button"
          size="sm"
          variant="outline"
          className="border-violet-300 bg-violet-50 text-violet-900 hover:bg-violet-100"
          onClick={() => {
            document.getElementById("central-de-decisoes")?.scrollIntoView({ behavior: "smooth", block: "start" });
            window.dispatchEvent(new Event("open-decision-workspace"));
          }}
        >
          <BrainCircuit className="size-4" />
          Central de Decisões
        </Button> : null}
        <Button
          variant="outline"
          size="sm"
          onClick={() => void openScenarioList()}
        >
          <FolderOpen className="size-4" />
          Cenários
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setComparePanel(true)}
        >
          <GitCompareArrows className="size-4" />
          Comparar
        </Button>
        {canPlan && !historicalScenario ? (
          <Button size="sm" onClick={openSavePanel}>
            <Save className="size-4" />
            Salvar cenário
          </Button>
        ) : null}
        <Button
          variant="outline"
          size="sm"
          disabled={!!historicalScenario}
          onClick={load}
        >
          <RefreshCw className="size-4" />
          Atualizar
        </Button>
      </section>

      <section className="flex gap-3 overflow-x-auto pb-1 lg:grid lg:grid-cols-5 lg:overflow-visible">
        <Metric
          icon={Boxes}
          label="Carga ativa"
          helpTopic="activeLoad"
          value={`${formatNumber(simulation.totalDemandKg, 0)} kg`}
          className="w-[250px] shrink-0 lg:w-auto"
        />
        <Metric
          icon={Gauge}
          label="Produção líquida · soma das prensas"
          helpTopic="netTime"
          value={formatDuration(simulation.totalTheoreticalMinutes)}
          tone="orange"
          className="w-[250px] shrink-0 lg:w-auto"
        />
        <Metric
          icon={CalendarClock}
          label="Término simulado"
          helpTopic="end"
          value={formatDateTime(estimatedEnd)}
          tone="blue"
          className="w-[250px] shrink-0 lg:w-auto"
        />
        <Metric
          icon={PackageOpen}
          label="Barras a preparar"
          helpTopic="bars"
          value={`${simulation.totalBars}`}
          tone="violet"
          className="w-[250px] shrink-0 lg:w-auto"
        />
        <Metric
          icon={Route}
          label="Itens na sequência"
          helpTopic="items"
          value={`${simulation.machines.reduce((sum, item) => sum + item.items.length, 0)}`}
          tone="green"
          className="w-[250px] shrink-0 lg:w-auto"
        />
      </section>
      {!historicalScenario && decisionContext && <DecisionWorkspace
        context={decisionContext} profile={decisionProfile} canEdit={role === "admin"} canAdjust={canPlan}
        onProfile={setDecisionProfile} onApply={applyDecisionCandidate}
      />}
      {sequenceChanges.length > 0 && <details className="rounded-xl border bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold">Motivos das mudanças de sequência ({sequenceChanges.length})</summary>
        <p className="mt-2 text-xs text-slate-500">{historicalScenario ? "Registro guardado nesta versão do cenário." : "Registro desta sessão. Salve o cenário para guardar os motivos no histórico."}</p>
        <ol className="mt-3 space-y-3">{sequenceChanges.map((change,index)=><li key={index} className="rounded-lg bg-slate-50 p-3 text-sm">
          <strong>{change.toolCode} · prensa {change.machineCode} · posição {change.from} → {change.to}</strong>
          <p>{change.reason}</p><span className="text-xs text-slate-500">{formatDateTime(new Date(change.recordedAt))}</span>
        </li>)}</ol>
      </details>}
      <section className="flex flex-col gap-3 rounded-2xl border bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center">
        <div className="flex-1">
          <h2 className="font-heading font-bold text-slate-950">
            Seções da Carga Máquina
          </h2>
          <p className="text-xs text-slate-500">
            {visibleSectionKeys.length} de {machineLoadSectionKeys.length} seções visíveis. <Link
              href="/configuracoes"
              className="ml-1 inline-flex items-center gap-1 font-bold text-violet-700 underline decoration-violet-300 underline-offset-2 transition hover:text-violet-900"
            ><Settings2 className="size-3" /> Ajustar exibição</Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAllSections(true)}
            disabled={allSectionsExpanded || visibleSectionKeys.length === 0}
          >
            <ChevronDown className="size-4" /> Expandir tudo
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setAllSections(false)}
            disabled={visibleSectionKeys.length === 0 || visibleSectionKeys.every((key) => !expandedSections[key])}
          >
            <ChevronUp className="size-4" /> Recolher tudo
          </Button>
        </div>
      </section>

      {visibleSectionKeys.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-violet-300 bg-violet-50 px-5 py-6 text-sm text-violet-950 shadow-sm">
          <strong className="block">Nenhuma seção está visível.</strong>
          <span className="mt-1 block text-xs text-violet-800">
            Abra Configurações para escolher quais partes da Base Teste · IA devem aparecer.
          </span>
        </section>
      ) : null}

      {sectionVisibility.intelligence && planningAnalysis ? (
        <CollapsibleDashboardSection
          title="Inteligência explicável e copiloto de decisão"
          summary={`Nota ${planningAnalysis.score.overall} de 100 · ${planningAnalysis.summary.conflicts} bloqueio(s) · ${planningAnalysis.summary.predictedIdleMinutes} min de espera previstos`}
          expanded={expandedSections.intelligence}
          onToggle={() => toggleSection("intelligence")}
          tone={planningAnalysis.summary.conflicts ? "red" : "violet"}
        >
          <PlanningIntelligencePanel
            analysis={planningAnalysis}
            weights={intelligence.settings}
            canEdit={false}
          aiConfigured={Boolean(intelligence.aiConfigured)}
          onSave={saveIntelligenceWeights}
          />
        </CollapsibleDashboardSection>
      ) : null}

      {sectionVisibility.copilot ? <CollapsibleDashboardSection
        title="Copiloto de decisão"
        summary={
          aiBusy
            ? "Análise em andamento"
            : aiAnalysis
              ? `${aiAnalysis.result.recommendations.length} orientação(ões) · cenário para avaliação`
              : "Analise a sequência e receba um cenário alternativo explicado passo a passo"
        }
        expanded={expandedSections.copilot}
        onToggle={() => toggleSection("copilot")}
        tone="violet"
      >
        <AiDecisionPanel
          configured={Boolean(intelligence.aiConfigured)}
          enabled={intelligence.settings.aiEnabled}
          analysis={aiAnalysis}
          busy={aiBusy}
          error={aiError}
          shiftGoals={shiftGoals}
          onAnalyze={() => void requestAiAnalysis()}
          onApplyScenario={applyAiScenario}
          orderLabels={Object.fromEntries(
            simulation.machines.flatMap((machine) =>
              machine.items.map((item) => [item.id, item.toolCode]),
            ),
          )}
        />
      </CollapsibleDashboardSection> : null}

      {sectionVisibility.learning ? <PlanningLearningPanel
        data={intelligence}
        expanded={expandedSections.learning}
        onToggle={() => toggleSection("learning")}
      /> : null}

      {sectionVisibility.thermal ? <CollapsibleDashboardSection
        title="Prontidão térmica das prensas"
        summary={`${simulation.machines.filter((item) => item.thermalCoverage.status === "risk").length} prensa(s) com risco · ${simulation.machines.filter((item) => item.thermalCoverage.status === "attention").length} em atenção`}
        expanded={expandedSections.thermal}
        onToggle={() => toggleSection("thermal")}
        tone={
          simulation.machines.some(
            (item) => item.thermalCoverage.status === "risk",
          )
            ? "red"
            : "amber"
        }
      >
        <ThermalCoveragePanel machines={simulation.machines} />
      </CollapsibleDashboardSection> : null}

      {sectionVisibility.alerts ? <CollapsibleDashboardSection
        title="Alertas, materiais e recursos compartilhados"
        summary={`${simulation.conflicts.filter((item) => item.severity === "blocking").length} impedimento(s) · carcaças, BOs, tarugos e calendário`}
        expanded={expandedSections.alerts}
        onToggle={() => toggleSection("alerts")}
        tone={
          simulation.conflicts.some((item) => item.severity === "blocking")
            ? "red"
            : "amber"
        }
      >
        <ConstraintPanel simulation={simulation} />
        <AlloyWarnings machines={simulation.machines} />
        <BilletStockWarnings
          billets={simulation.billets}
          stock={displayedBilletStock}
          available={hasBilletStockSnapshot}
        />
        <PressResourceWarnings
          machines={simulation.machines}
          resources={displayedCarcassResources}
          available={hasCarcassSnapshot}
        />
        <BoResourceWarnings
          machines={simulation.machines}
          resources={displayedBoResources}
          available={hasBoSnapshot}
        />
        <OperationalCalendarPanel
          periods={displayedUnavailability}
          machines={simulation.machines.map((item) => item.machineCode)}
        />
      </CollapsibleDashboardSection> : null}

      {sectionVisibility.simulation ? <CollapsibleDashboardSection
        title="Simulação operacional"
        summary={`${simulation.machines.reduce((sum, item) => sum + item.items.length, 0)} itens · término ${formatDateTime(estimatedEnd)} · Gantt, tabela e tarugos`}
        expanded={expandedSections.simulation}
        onToggle={() => toggleSection("simulation")}
        tone="blue"
      >
        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-heading font-bold text-slate-900">
                Simulação operacional
              </h2>
              <p className="text-xs text-slate-500">
                Prensa + ferramenta/forno + carcaça + tarugo/liga.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <PlanningEnginePremises report={shiftGoals} pressForecasts={pressPlansForSimulation(simulation)} />
              <div className="flex rounded-xl bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setTab("gantt")}
                className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === "gantt" ? "bg-white shadow-sm" : "text-slate-500"}`}
              >
                <Columns3 className="mr-1 inline size-3.5" />
                Gantt
              </button>
              <button
                type="button"
                onClick={() => setTab("timeline")}
                className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === "timeline" ? "bg-white shadow-sm" : "text-slate-500"}`}
              >
                <Clock3 className="mr-1 inline size-3.5" />
                Tabela
              </button>
              <button
                type="button"
                onClick={() => setTab("billets")}
                className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === "billets" ? "bg-white shadow-sm" : "text-slate-500"}`}
              >
                <PackageOpen className="mr-1 inline size-3.5" />
                Tarugo
              </button>
              </div>
            </div>
          </div>
          {tab === "gantt" ? (
            <GanttChart machines={simulation.machines} />
          ) : tab === "timeline" ? (
            <Timeline
              machines={simulation.machines}
              projectedBalances={projectedBilletBalances(simulation)}
              manual={!historicalScenario && mode === "manual"}
              onMove={moveManualOrder}
            />
          ) : (
            <BilletTable
              billets={simulation.billets}
              settings={settings}
              stock={displayedBilletStock}
              available={hasBilletStockSnapshot}
            />
          )}
        </section>
        <div className="flex items-start gap-2 rounded-xl bg-blue-50 px-4 py-3 text-xs text-blue-800">
          <Settings2 className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong>Premissas atuais:</strong> peso, eficiência, tempo térmico e
            quantidade de vagas seguem a configuração de cada prensa.
            Ferramentas, carcaças e BOs compartilhados são protegidos contra uso
            simultâneo; a aprovação só ocorre com estoque físico suficiente.
          </p>
        </div>
      </CollapsibleDashboardSection> : null}
      {scenarioPanel ? (
        <ScenarioDialog
          mode={scenarioPanel}
          name={scenarioName}
          description={scenarioDescription}
          scenarios={scenarios}
          busy={scenarioBusy}
          error={scenarioError}
          scenarioId={scenarioId}
          onName={setScenarioName}
          onDescription={setScenarioDescription}
          onClose={() => {
            setScenarioPanel(null);
            setScenarioError("");
          }}
          onSave={() => void saveScenario()}
          onOpen={(id) => void openSavedScenario(id)}
        />
      ) : null}
      {comparePanel ? (
        <ScenarioComparisonDialog onClose={() => setComparePanel(false)} />
      ) : null}
    </div>
  );
}

function ScenarioDialog({
  mode,
  name,
  description,
  scenarios,
  busy,
  error,
  scenarioId,
  onName,
  onDescription,
  onClose,
  onSave,
  onOpen,
}: {
  mode: "save" | "list";
  name: string;
  description: string;
  scenarios: ScenarioSummary[];
  busy: boolean;
  error: string;
  scenarioId: string | null;
  onName: (value: string) => void;
  onDescription: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="scenario-dialog-title"
    >
      <section className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
        <header className="flex items-start gap-3 border-b px-5 py-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600">
            {mode === "save" ? (
              <Save className="size-5" />
            ) : (
              <FolderOpen className="size-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="scenario-dialog-title"
              className="font-heading text-lg font-black text-slate-950"
            >
              {mode === "save"
                ? scenarioId
                  ? "Salvar nova versão"
                  : "Salvar cenário"
                : "Cenários salvos"}
            </h2>
            <p className="text-xs text-slate-500">
              {mode === "save"
                ? "Guarde entradas, regras e resultados para consulta e comparação futura."
                : "Abra uma fotografia histórica sem recalcular os valores."}
            </p>
          </div>
          <button
            type="button"
            aria-label="Fechar"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="overflow-y-auto p-5">
          {error ? (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : null}
          {mode === "save" ? (
            <div className="space-y-4">
              {scenarioId ? (
                <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
                  <strong>Versionamento ativo.</strong> Este salvamento criará
                  uma nova versão imutável do cenário selecionado.
                </div>
              ) : null}
              <label className="block text-sm font-bold text-slate-800">
                Nome do cenário
                <input
                  autoFocus
                  value={name}
                  onChange={(event) => onName(event.target.value)}
                  maxLength={120}
                  placeholder="Ex.: Carga P1.8 · turno B"
                  className="mt-1.5 h-11 w-full rounded-xl border px-3 font-medium outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </label>
              <label className="block text-sm font-bold text-slate-800">
                Descrição{" "}
                <span className="font-normal text-slate-400">(opcional)</span>
                <textarea
                  value={description}
                  onChange={(event) => onDescription(event.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="Registre a hipótese, prioridade ou decisão que está sendo avaliada."
                  className="mt-1.5 w-full resize-none rounded-xl border px-3 py-2 font-medium outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                />
              </label>
            </div>
          ) : busy ? (
            <div className="grid min-h-40 place-items-center">
              <Loader2 className="size-6 animate-spin text-orange-500" />
            </div>
          ) : scenarios.length ? (
            <div className="space-y-2">
              {scenarios.map((scenario) => (
                <article
                  key={scenario.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border p-3 hover:border-orange-200 hover:bg-orange-50/30"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="truncate text-sm text-slate-950">
                        {scenario.name}
                      </strong>
                      <span
                        className="rounded-full bg-violet-100 px-2 py-0.5 font-mono text-[10px] font-black text-violet-800"
                        title={`ID completo da simulação: ${scenario.id}`}
                      >
                        {simulationDisplayId(scenario.id)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">
                        v{scenario.currentVersion}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {scenario.description || "Sem descrição"}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Simulação:{" "}
                      {scenario.requestedStartAt
                        ? formatDateTime(new Date(scenario.requestedStartAt))
                        : "—"}{" "}
                      · salva por {scenario.createdBy || "usuário"}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onOpen(scenario.id)}
                  >
                    <FolderOpen className="size-4" />
                    Abrir
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <div className="grid min-h-40 place-items-center rounded-xl border border-dashed text-center">
              <div>
                <FolderOpen className="mx-auto mb-2 size-7 text-slate-300" />
                <p className="text-sm font-bold text-slate-700">
                  Nenhum cenário salvo
                </p>
                <p className="text-xs text-slate-400">
                  Salve uma simulação para iniciar o histórico.
                </p>
              </div>
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          {mode === "save" ? (
            <Button disabled={busy || !name.trim()} onClick={onSave}>
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              {scenarioId ? "Salvar nova versão" : "Salvar cenário"}
            </Button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function ScenarioComparisonDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<ScenarioSummary[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<LoadedScenario[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/simulation-scenarios", {
          cache: "no-store",
        });
        const payload = (await response.json().catch(() => null)) as
          ScenarioSummary[] | { error?: string } | null;
        if (!response.ok || !Array.isArray(payload))
          throw new Error(
            !Array.isArray(payload) && payload?.error
              ? payload.error
              : "Não foi possível carregar os cenários.",
          );
        if (active) setItems(payload);
      } catch (cause) {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Não foi possível carregar os cenários.",
          );
      } finally {
        if (active) setBusy(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);
  async function compare() {
    if (selected.length !== 2) return;
    setBusy(true);
    setError("");
    try {
      const results = await Promise.all(
        selected.map(async (id) => {
          const response = await fetch(
            `/api/simulation-scenarios?id=${encodeURIComponent(id)}`,
            { cache: "no-store" },
          );
          const payload = (await response.json().catch(() => null)) as
            | (Omit<LoadedScenario, "result"> & { result: unknown })
            | { error?: string }
            | null;
          if (!response.ok || !payload || !("result" in payload))
            throw new Error(
              payload && "error" in payload
                ? payload.error
                : "Não foi possível abrir um dos cenários.",
            );
          return {
            ...payload,
            result: hydrateSimulation(payload.result),
          } as LoadedScenario;
        }),
      );
      setLoaded(results);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível comparar os cenários.",
      );
    } finally {
      setBusy(false);
    }
  }
  const metrics = loaded.map((scenario) => ({
    scenario,
    totalHours:
      scenario.result.machines.reduce(
        (sum, machine) => sum + machine.simulatedMinutes,
        0,
      ) / 60,
    waitingHours:
      scenario.result.machines.reduce(
        (sum, machine) => sum + machine.waitingMinutes,
        0,
      ) / 60,
    endAt: scenario.result.machines.reduce<Date | null>(
      (latest, machine) =>
        !machine.endsAt
          ? latest
          : !latest || machine.endsAt > latest
            ? machine.endsAt
            : latest,
      null,
    ),
    bars: scenario.result.totalBars,
    conflicts: scenario.result.conflicts?.length ?? 0,
  }));
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4"
      role="dialog"
      aria-modal="true"
    >
      <section className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
        <header className="flex items-start gap-3 border-b px-5 py-4">
          <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <GitCompareArrows className="size-5" />
          </span>
          <div className="flex-1">
            <h2 className="font-heading text-lg font-black">
              Comparar cenários
            </h2>
            <p className="text-xs text-slate-500">
              Selecione duas versões para avaliar prazo, espera, material e
              conflitos antes da aprovação.
            </p>
          </div>
          <button type="button" aria-label="Fechar" onClick={onClose}>
            <X className="size-5" />
          </button>
        </header>
        <div className="overflow-y-auto p-5">
          {error ? (
            <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700">
              {error}
            </div>
          ) : null}
          {!loaded.length ? (
            busy ? (
              <div className="grid min-h-48 place-items-center">
                <Loader2 className="size-7 animate-spin text-orange-500" />
              </div>
            ) : (
              <div className="grid gap-2 md:grid-cols-2">
                {items.map((item) => {
                  const active = selected.includes(item.id);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() =>
                        setSelected((current) =>
                          active
                            ? current.filter((id) => id !== item.id)
                            : current.length < 2
                              ? [...current, item.id]
                              : [current[1], item.id],
                        )
                      }
                      className={`rounded-xl border p-4 text-left ${active ? "border-orange-400 bg-orange-50 ring-2 ring-orange-100" : "hover:border-slate-300"}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <strong>{item.name}</strong>
                        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black">
                          v{item.currentVersion}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        {formatDateTime(
                          item.requestedStartAt
                            ? new Date(item.requestedStartAt)
                            : null,
                        )}{" "}
                        · {item.status}
                      </p>
                    </button>
                  );
                })}
              </div>
            )
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {metrics.map((metric, index) => (
                <article
                  key={metric.scenario.scenarioId}
                  className={`overflow-hidden rounded-2xl border ${index === 0 ? "border-blue-200" : "border-orange-200"}`}
                >
                  <header
                    className={`p-4 ${index === 0 ? "bg-blue-50" : "bg-orange-50"}`}
                  >
                    <p className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                      Cenário {index + 1}
                    </p>
                    <h3 className="font-heading text-lg font-black">
                      {metric.scenario.name}
                    </h3>
                    <p className="text-xs text-slate-500">
                      versão {metric.scenario.versionNumber} ·{" "}
                      {metric.scenario.status}
                    </p>
                  </header>
                  <div className="grid grid-cols-2 gap-px bg-slate-200">
                    <CompareMetric
                      label="Término"
                      value={formatDateTime(metric.endAt)}
                    />
                    <CompareMetric
                      label="Tempo total"
                      value={`${formatNumber(metric.totalHours, 1)} h`}
                    />
                    <CompareMetric
                      label="Espera/setup"
                      value={`${formatNumber(metric.waitingHours, 1)} h`}
                    />
                    <CompareMetric label="Barras" value={String(metric.bars)} />
                    <CompareMetric
                      label="Conflitos"
                      value={String(metric.conflicts)}
                    />
                    <CompareMetric
                      label="Viabilidade"
                      value={
                        metric.scenario.result.feasible === false
                          ? "Bloqueado"
                          : "Viável"
                      }
                    />
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        <footer className="flex items-center justify-between border-t bg-slate-50 px-5 py-3">
          <Button
            variant="ghost"
            onClick={() => {
              setLoaded([]);
              setSelected([]);
            }}
            disabled={!loaded.length}
          >
            Nova comparação
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
            {!loaded.length ? (
              <Button
                disabled={selected.length !== 2 || busy}
                onClick={() => void compare()}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <GitCompareArrows className="size-4" />
                )}
                Comparar selecionados
              </Button>
            ) : null}
          </div>
        </footer>
      </section>
    </div>
  );
}

function CompareMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-4">
      <p className="text-[9px] font-black uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="mt-1 font-black text-slate-900">{value}</p>
    </div>
  );
}

function CollapsibleDashboardSection({
  title,
  summary,
  expanded,
  onToggle,
  children,
  tone = "slate",
}: {
  title: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  tone?: "slate" | "violet" | "amber" | "red" | "blue";
}) {
  const toneClasses = {
    slate: "bg-slate-100 text-slate-700",
    violet: "bg-violet-100 text-violet-700",
    amber: "bg-amber-100 text-amber-800",
    red: "bg-red-100 text-red-700",
    blue: "bg-blue-100 text-blue-700",
  }[tone];
  const helpTopic: LoadHelpKey | undefined = ({ "Copiloto de decisão": "ai", "Inteligência explicável e copiloto de decisão": "legacyScore", "Simulação operacional": "sequence" } as Record<string, LoadHelpKey>)[title];
  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex items-center pr-3"><button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <span
          className={`grid size-10 shrink-0 place-items-center rounded-xl ${toneClasses}`}
        >
          {expanded ? (
            <ChevronUp className="size-5" />
          ) : (
            <ChevronDown className="size-5" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <strong className="block font-heading text-base text-slate-950">
            {title}
          </strong>
          <span className="block truncate text-xs text-slate-500">
            {summary}
          </span>
        </span>
        <span className="shrink-0 rounded-lg border bg-white px-3 py-2 text-xs font-bold text-slate-600">
          {expanded ? "Recolher" : "Expandir"}
        </span>
      </button>{helpTopic && <FieldHelp topic={helpTopic} />}</div>
      {expanded ? (
        <div className="space-y-3 border-t bg-slate-50/50 p-3 sm:p-4">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function ConstraintPanel({
  simulation,
}: {
  simulation: ReturnType<typeof simulateMachineLoad>;
}) {
  const blocking =
    simulation.conflicts?.filter((item) => item.severity === "blocking") ?? [];
  const delayed =
    simulation.conflicts?.filter(
      (item) => item.severity === "warning" && item.delayMinutes > 0,
    ) ?? [];
  if (!blocking.length && !delayed.length)
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <ShieldCheck className="size-5" />
        <div>
          <strong className="block">Recursos compatíveis</strong>
          <span className="text-xs">
            Ferramentas, carcaças e BOs não apresentam sobreposição na sequência
            calculada.
          </span>
        </div>
      </div>
    );
  return (
    <section
      className={`rounded-2xl border px-4 py-3 ${blocking.length ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}
    >
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" />
        <div>
          <strong className="block">
            {blocking.length
              ? `${blocking.length} impedimento(s) para aprovação`
              : `${delayed.length} espera(s) de recurso incorporada(s)`}
          </strong>
          <div className="mt-1 space-y-1 text-xs">
            {[...blocking, ...delayed].slice(0, 6).map((item) => (
              <p key={item.id}>
                {item.message}
                {item.delayMinutes > 0
                  ? ` A simulação aguardou ${formatDuration(item.delayMinutes)}.`
                  : ""}
              </p>
            ))}
          </div>
          {blocking.length ? (
            <a
              href="/configuracoes/recursos-prensa"
              className="mt-2 inline-flex rounded-lg bg-red-700 px-3 py-1.5 text-xs font-bold text-white"
            >
              Completar cadastros
            </a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function PlanningIntelligencePanel({
  analysis,
  weights,
  canEdit,
  aiConfigured,
  onSave,
}: {
  analysis: PlanningAnalysis;
  weights: IntelligenceWeights;
  canEdit: boolean;
  aiConfigured: boolean;
  onSave: (weights: IntelligenceWeights) => Promise<IntelligenceWeights>;
}) {
  const [editing, setEditing] = useState(false);
  const [showAllRecommendations, setShowAllRecommendations] = useState(false);
  const [draft, setDraft] = useState(weights);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [modelCatalog, setModelCatalog] = useState<OpenRouterModelOption[]>([]);
  const [modelCatalogState, setModelCatalogState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const loadModelCatalog = useCallback(async () => {
    setModelCatalogState("loading");
    try {
      const response = await fetch("/api/planning-ai", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as {
        models?: OpenRouterModelOption[];
        error?: string;
      } | null;
      if (!response.ok || !Array.isArray(payload?.models)) {
        throw new Error(payload?.error || "Catálogo indisponível.");
      }
      setModelCatalog(
        payload.models.filter((item) => item.id !== "openrouter/auto"),
      );
      setModelCatalogState("ready");
    } catch {
      setModelCatalogState("error");
    }
  }, []);
  const total =
    draft.thermal +
    draft.resources +
    draft.material +
    draft.delivery +
    draft.flow +
    draft.holeSequence +
    draft.shortRun;
  const hasUnsavedChanges =
    savedSignature !== null && JSON.stringify(draft) !== savedSignature;
  function closeEditor() {
    if (
      hasUnsavedChanges &&
      !window.confirm(
        "Existem alterações que ainda não foram salvas. Deseja fechar e perder essas alterações?",
      )
    )
      return;
    setEditing(false);
  }
  const tone =
    analysis.score.overall >= 85
      ? "emerald"
      : analysis.score.overall >= 70
        ? "blue"
        : analysis.score.overall >= 50
          ? "amber"
          : "red";
  const toneClasses = {
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-800",
    blue: "border-blue-200 bg-blue-50 text-blue-800",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
  }[tone];
  const criterionNextStep: Record<string, string> = {
    thermal: "Confira se as próximas ferramentas já estão no forno.",
    resources: "Confira carcaças, BOs e ferramentas livres.",
    material: "Confira se as barras necessárias estão separadas.",
    delivery: "Confira primeiro as ordens com prazo mais próximo.",
    flow: "Procure reduzir trocas, preparações e esperas.",
    holeSequence: "Evite muitas ferramentas de vários furos seguidas.",
    shortRun: "Intercale uma ordem mais longa entre corridas rápidas.",
  };
  const recommendationGroups = useMemo(() => {
    type Recommendation = PlanningAnalysis["recommendations"][number];
    const grouped = new Map<
      string,
      { representative: Recommendation; items: Recommendation[] }
    >();
    for (const item of analysis.recommendations) {
      const key = `${item.priority}|${item.category}|${item.title}|${item.action}`;
      const current = grouped.get(key);
      if (current) current.items.push(item);
      else grouped.set(key, { representative: item, items: [item] });
    }
    return [...grouped.values()];
  }, [analysis.recommendations]);
  const visibleRecommendationGroups = showAllRecommendations
    ? recommendationGroups
    : recommendationGroups.slice(0, 4);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const confirmed = await onSave(draft);
      setDraft(confirmed);
      setSavedAt(new Date());
      setSavedSignature(JSON.stringify(confirmed));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível salvar os critérios.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b px-5 py-4 lg:flex-row lg:items-center">
        <div
          className={`grid size-16 shrink-0 place-items-center rounded-2xl border ${toneClasses}`}
        >
          <div className="text-center">
            <strong className="block text-2xl leading-none">
              {analysis.score.overall}
            </strong>
            <span className="text-[9px] font-black uppercase">de 100</span>
          </div>
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-orange-600">
            Inteligência explicável
          </p>
          <h2 className="font-heading text-xl font-black">
            Sequência {analysis.score.label.toLowerCase()}
          </h2>
          <p className="text-sm text-slate-500">
            {analysis.summary.conflicts} conflito(s),{" "}
            {analysis.summary.opportunities} oportunidade(s) e{" "}
            {analysis.summary.predictedIdleMinutes} min de parada/espera
            previstos.
          </p>
        </div>
        {canEdit ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(weights);
              setSavedAt(null);
              setSavedSignature(JSON.stringify(weights));
              setError("");
              setEditing(true);
              if (modelCatalogState === "idle") void loadModelCatalog();
            }}
          >
            <Settings2 className="size-4" />
            Ajustar critérios
          </Button>
        ) : null}
      </header>
      <div className="grid gap-4 p-5 xl:grid-cols-[.9fr_1.35fr]">
        <div>
          <h3 className="mb-3 text-xs font-black uppercase tracking-wide text-slate-500">
            Composição da nota
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {analysis.score.criteria.map((criterion) => (
              <div key={criterion.key} className="rounded-xl border p-3">
                <div className="flex items-center gap-3">
                  <span
                    className={`grid size-9 place-items-center rounded-lg text-sm font-black ${criterion.score >= 80 ? "bg-emerald-50 text-emerald-700" : criterion.score >= 50 ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}
                  >
                    {Math.round(criterion.score)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2">
                      <strong className="text-sm">{criterion.label}</strong>
                      <span className="text-[10px] font-bold text-slate-400">
                        peso {criterion.weight}%
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">
                      {criterion.explanation}
                    </p>
                    {criterion.score < 80 ? (
                      <p className="mt-1 text-xs font-semibold text-slate-700">
                        Próxima conferência: {criterionNextStep[criterion.key]}
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-xs font-black uppercase tracking-wide text-slate-500">
              Recomendações priorizadas
            </h3>
            {analysis.recommendations.length ? (
              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">
                {recommendationGroups.length} grupo(s) ·{" "}
                {analysis.recommendations.length} ação(ões)
              </span>
            ) : null}
          </div>
          {analysis.recommendations.length ? (
            <div className="grid gap-2 lg:grid-cols-2">
              {visibleRecommendationGroups.map((group) => {
                const item = group.representative;
                const toolCodes = [
                  ...new Set(
                    group.items.map((entry) => entry.toolCode).filter(Boolean),
                  ),
                ] as string[];
                return (
                  <details
                    key={`${item.priority}-${item.category}-${item.title}`}
                    className={`group rounded-xl border ${item.priority === "critical" ? "border-red-200 bg-red-50/60" : item.priority === "high" ? "border-amber-200 bg-amber-50/60" : item.priority === "opportunity" ? "border-emerald-200 bg-emerald-50/60" : "bg-slate-50"}`}
                  >
                    <summary className="flex cursor-pointer list-none items-start gap-2 p-3">
                      <span
                        className={`mt-0.5 rounded-full px-2 py-1 text-[9px] font-black uppercase ${item.priority === "critical" ? "bg-red-600 text-white" : item.priority === "high" ? "bg-amber-500 text-white" : item.priority === "opportunity" ? "bg-emerald-600 text-white" : "bg-slate-600 text-white"}`}
                      >
                        {item.priority === "critical"
                          ? "Crítica"
                          : item.priority === "high"
                            ? "Alta"
                            : item.priority === "opportunity"
                              ? "Oportunidade"
                              : "Melhoria"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <strong className="block truncate text-sm">
                          {item.title}
                        </strong>
                        <p className="mt-0.5 text-xs text-slate-600">
                          {group.items.length > 1
                            ? `${group.items.length} ocorrências agrupadas`
                            : item.impact}
                        </p>
                        {toolCodes.length ? (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {toolCodes.slice(0, 6).map((tool) => (
                              <span
                                key={tool}
                                className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-700 ring-1 ring-slate-200"
                              >
                                {tool}
                              </span>
                            ))}
                            {toolCodes.length > 6 ? (
                              <span className="text-[10px] font-bold text-slate-500">
                                +{toolCodes.length - 6}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <ChevronDown className="mt-1 size-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-current/10 px-3 pb-3 pt-2 text-xs text-slate-600">
                      <p>
                        <b>O que foi encontrado:</b>{" "}
                        {group.items.length > 1
                          ? `${group.items.length} situações do mesmo tipo foram reunidas para facilitar a leitura.`
                          : item.reason}
                      </p>
                      <p className="mt-2 rounded-lg bg-red-50 p-2 text-red-900">
                        <b>O que pode acontecer:</b> {item.impact}
                      </p>
                      <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-2 text-blue-950">
                        <b>Quem deve agir:</b> {item.responsibleRole}
                        <b className="mt-2 block">Passo a passo:</b>
                        <ol className="mt-1 space-y-1.5">
                          {item.steps.map((step, index) => (
                            <li key={`${step}-${index}`} className="flex gap-2">
                              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-blue-700 text-[10px] font-black text-white">
                                {index + 1}
                              </span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-emerald-900">
                        <b>Como conferir:</b> {item.successCheck}
                      </p>
                    </div>
                  </details>
                );
              })}
            </div>
          ) : (
            <div className="grid min-h-36 place-items-center rounded-xl border border-emerald-200 bg-emerald-50 text-center text-sm text-emerald-800">
              <div>
                <ShieldCheck className="mx-auto mb-2 size-6" />
                <strong>Sem ação prioritária</strong>
                <p className="text-xs">
                  A sequência atende aos critérios configurados.
                </p>
              </div>
            </div>
          )}
          {recommendationGroups.length > 4 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-3 w-full text-slate-600"
              onClick={() => setShowAllRecommendations((current) => !current)}
            >
              {showAllRecommendations ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
              {showAllRecommendations
                ? "Mostrar somente as principais"
                : `Ver todos os ${recommendationGroups.length} grupos`}
            </Button>
          ) : null}
        </div>
      </div>
      {editing ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4">
          <section className="flex max-h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
            <header className="flex items-start border-b px-5 py-4">
              <div className="flex-1">
                <h2 className="font-heading text-lg font-black">
                  Critérios e analista IA do AluPilot
                </h2>
                <p className="text-xs text-slate-500">
                  A regra calcula e protege; a IA interpreta o pacote de decisão
                  e explica alternativas.
                </p>
              </div>
              <button type="button" onClick={closeEditor}>
                <X className="size-5" />
              </button>
            </header>
            <div className="overflow-y-auto p-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <WeightField
                  label="Cobertura térmica"
                  value={draft.thermal}
                  onChange={(value) => setDraft({ ...draft, thermal: value })}
                />
                <WeightField
                  label="Recursos físicos"
                  value={draft.resources}
                  onChange={(value) => setDraft({ ...draft, resources: value })}
                />
                <WeightField
                  label="Material"
                  value={draft.material}
                  onChange={(value) => setDraft({ ...draft, material: value })}
                />
                <WeightField
                  label="Prazo"
                  value={draft.delivery}
                  onChange={(value) => setDraft({ ...draft, delivery: value })}
                />
                <WeightField
                  label="Fluidez"
                  value={draft.flow}
                  onChange={(value) => setDraft({ ...draft, flow: value })}
                />
                <WeightField
                  label="Sequência de furos"
                  value={draft.holeSequence}
                  onChange={(value) =>
                    setDraft({ ...draft, holeSequence: value })
                  }
                />
                <WeightField
                  label="Corridas curtas"
                  value={draft.shortRun}
                  onChange={(value) => setDraft({ ...draft, shortRun: value })}
                />
                <WeightField
                  label="Amostras para calibrar"
                  value={draft.minimumConfidenceSamples}
                  onChange={(value) =>
                    setDraft({ ...draft, minimumConfidenceSamples: value })
                  }
                  max={100}
                />
                <div
                  className={`rounded-xl border p-3 text-sm font-bold lg:col-span-1 ${total === 100 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}
                >
                  Soma dos pesos: {total}%
                  <span className="block text-xs font-normal">
                    {total === 100
                      ? "Configuração válida"
                      : "Ajuste para exatamente 100%"}
                  </span>
                </div>
              </div>
              <div className="mt-5 rounded-2xl border bg-slate-50 p-4">
                <h3 className="font-heading font-black">
                  Limites operacionais configuráveis
                </h3>
                <p className="mb-3 text-xs text-slate-500">
                  Ajuste sem alterar o código quando o processo da fábrica
                  evoluir.
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <NumberSetting
                    label="Furos considerados altos"
                    value={draft.highHoleThreshold}
                    suffix="furos"
                    onChange={(value) =>
                      setDraft({ ...draft, highHoleThreshold: value })
                    }
                  />
                  <NumberSetting
                    label="Máximo consecutivo"
                    value={draft.maxConsecutiveHighHoleTools}
                    suffix="ferramentas"
                    onChange={(value) =>
                      setDraft({ ...draft, maxConsecutiveHighHoleTools: value })
                    }
                  />
                  <NumberSetting
                    label="Volume baixo"
                    value={draft.lowVolumeThresholdKg}
                    suffix="kg"
                    onChange={(value) =>
                      setDraft({ ...draft, lowVolumeThresholdKg: value })
                    }
                  />
                </div>
              </div>
              <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
                <div className="flex items-start gap-3">
                  <BrainCircuit className="mt-0.5 size-5 text-violet-600" />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-heading font-black">Analista IA</h3>
                      <span
                        className={`rounded-full px-2 py-1 text-[9px] font-black uppercase ${aiConfigured ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}
                      >
                        {aiConfigured ? "Chave configurada" : "Chave pendente"}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500">
                      A chave fica somente no servidor. Nenhum dado de cliente é
                      enviado no pacote.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-bold">
                    <input
                      type="checkbox"
                      checked={draft.aiEnabled}
                      onChange={(event) =>
                        setDraft({ ...draft, aiEnabled: event.target.checked })
                      }
                      className="size-4 accent-violet-600"
                    />
                    Ativar
                  </label>
                </div>
                {!aiConfigured ? (
                  <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <strong className="block text-sm">
                      Como conectar a IA
                    </strong>
                    <ol className="mt-1 list-decimal space-y-1 pl-4">
                      <li>
                        Revogue a chave que foi compartilhada na conversa e gere
                        uma nova.
                      </li>
                      <li>
                        Abra o arquivo{" "}
                        <code className="rounded bg-white px-1">
                          .env.local
                        </code>{" "}
                        na pasta principal do projeto.
                      </li>
                      <li>
                        Adicione{" "}
                        <code className="rounded bg-white px-1">
                          OPENROUTER_API_KEY=sua_nova_chave
                        </code>{" "}
                        e reinicie o app.
                      </li>
                    </ol>
                    <p className="mt-2 text-amber-700">
                      Por segurança, a chave não pode ser salva por este
                      formulário.
                    </p>
                  </div>
                ) : null}
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-sm font-bold">
                    Provedor de IA
                    <select
                      value={draft.aiProvider}
                      onChange={(event) => {
                        const aiProvider = event.target.value as IntelligenceWeights["aiProvider"];
                        setDraft({
                          ...draft,
                          aiProvider,
                          aiModelMode: aiProvider === "openrouter" ? draft.aiModelMode : "manual",
                          aiModel:
                            aiProvider === "openrouter"
                              ? draft.aiModel || "openrouter/auto"
                              : aiProvider === "lmstudio"
                                ? draft.aiModel === "openrouter/auto" ? "" : draft.aiModel
                                : "",
                        });
                      }}
                      className="mt-1.5 h-11 w-full rounded-xl border bg-white px-3"
                    >
                      <option value="openrouter">OpenRouter</option>
                      <option value="lmstudio">LM Studio · local</option>
                      <option value="openai">OpenAI API</option>
                      <option value="openclaw">OpenClaw · servidor aprovado</option>
                    </select>
                  </label>
                  <label className="text-sm font-bold">
                    Endpoint do provedor
                    <input
                      value={draft.aiProviderEndpoint}
                      onChange={(event) => setDraft({ ...draft, aiProviderEndpoint: event.target.value })}
                      placeholder={draft.aiProvider === "lmstudio" ? "http://127.0.0.1:1234/v1" : draft.aiProvider === "openclaw" ? "https://servidor-aprovado/v1" : "Padrão seguro do provedor"}
                      className="mt-1.5 h-11 w-full rounded-xl border bg-white px-3 font-normal"
                    />
                    <span className="mt-1 block text-[10px] font-normal text-slate-500">A chave não é salva aqui; ela fica somente no servidor. Endpoints externos são conferidos pelo servidor.</span>
                  </label>
                  <label className="flex items-start gap-2 rounded-xl border bg-white p-3 text-xs text-slate-700 sm:col-span-2">
                    <input
                      type="checkbox"
                      checked={draft.aiExternalDataEnabled}
                      onChange={(event) => setDraft({ ...draft, aiExternalDataEnabled: event.target.checked })}
                      className="mt-0.5 size-4 accent-violet-600"
                    />
                    <span><strong className="block text-sm text-slate-900">Permitir enviar o pacote mínimo para um provedor externo</strong>Desative para impedir análises por OpenRouter, OpenAI e OpenClaw. O LM Studio local continua disponível. A IA recebe somente o contexto compacto desta análise.</span>
                  </label>
                  {draft.aiProvider === "openrouter" ? <>
                  <label className="text-sm font-bold">
                    Seleção do modelo
                    <select
                      value={draft.aiModelMode}
                      onChange={(event) => {
                        const nextMode = event.target.value as
                          "auto" | "manual";
                        setDraft({
                          ...draft,
                          aiModelMode: nextMode,
                          aiModel:
                            nextMode === "auto"
                              ? "openrouter/auto"
                              : draft.aiModel,
                        });
                        if (
                          nextMode === "manual" &&
                          modelCatalogState !== "ready"
                        )
                          void loadModelCatalog();
                      }}
                      className="mt-1.5 h-11 w-full rounded-xl border bg-white px-3"
                    >
                      <option value="auto">Automática · recomendada</option>
                      <option value="manual">Modelo específico</option>
                    </select>
                  </label>
                  <label className="text-sm font-bold">
                    Modelo OpenRouter
                    {draft.aiModelMode === "auto" ? (
                      <div className="mt-1.5 flex h-11 items-center rounded-xl border bg-slate-100 px-3 text-sm text-slate-600">
                        Automático · OpenRouter escolhe o melhor modelo
                      </div>
                    ) : modelCatalogState === "loading" ? (
                      <div className="mt-1.5 flex h-11 items-center gap-2 rounded-xl border bg-white px-3 text-sm text-slate-500">
                        <Loader2 className="size-4 animate-spin" /> Carregando
                        modelos compatíveis…
                      </div>
                    ) : modelCatalogState === "ready" && modelCatalog.length ? (
                      <select
                        value={
                          draft.aiModel === "openrouter/auto"
                            ? ""
                            : draft.aiModel
                        }
                        onChange={(event) =>
                          setDraft({ ...draft, aiModel: event.target.value })
                        }
                        className="mt-1.5 h-11 w-full rounded-xl border bg-white px-3"
                      >
                        <option value="" disabled>
                          Selecione um modelo
                        </option>
                        {modelCatalog.map((model) => (
                          <option key={model.id} value={model.id}>
                            {model.name} · {model.id}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="mt-1.5 flex gap-2">
                        <input
                          value={
                            draft.aiModel === "openrouter/auto"
                              ? ""
                              : draft.aiModel
                          }
                          onChange={(event) =>
                            setDraft({ ...draft, aiModel: event.target.value })
                          }
                          placeholder="provedor/modelo"
                          className="h-11 min-w-0 flex-1 rounded-xl border bg-white px-3 font-normal"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void loadModelCatalog()}
                        >
                          <RefreshCw className="size-4" /> Tentar novamente
                        </Button>
                      </div>
                    )}
                    {draft.aiModelMode === "manual" &&
                    modelCatalogState === "ready" ? (
                      <span className="mt-1 block text-[10px] font-normal text-slate-500">
                        {modelCatalog.length} modelos com resposta estruturada
                        disponíveis.
                      </span>
                    ) : null}
                  </label>
                  </> : <label className="text-sm font-bold sm:col-span-2">
                    Modelo
                    {providerModelOptions[draft.aiProvider].length ? (
                      <select
                        value={providerModelOptions[draft.aiProvider].some((model) => model.id === draft.aiModel) ? draft.aiModel : "custom"}
                        onChange={(event) => setDraft({ ...draft, aiModel: event.target.value === "custom" ? "" : event.target.value })}
                        className="mt-1.5 h-11 w-full rounded-xl border bg-white px-3 font-normal"
                      >
                        <option value="" disabled>Selecione um modelo</option>
                        {providerModelOptions[draft.aiProvider].map((model) => (
                          <option key={model.id} value={model.id}>{model.name}</option>
                        ))}
                        <option value="custom">Outro identificador…</option>
                      </select>
                    ) : null}
                    {(!providerModelOptions[draft.aiProvider].length || !providerModelOptions[draft.aiProvider].some((model) => model.id === draft.aiModel)) ? (
                      <input
                        value={draft.aiModel === "openrouter/auto" ? "" : draft.aiModel}
                        onChange={(event) => setDraft({ ...draft, aiModel: event.target.value })}
                        placeholder={draft.aiProvider === "lmstudio" ? "Identificador do modelo carregado no LM Studio" : "Modelo configurado neste provedor"}
                        className="mt-1.5 h-11 w-full rounded-xl border bg-white px-3 font-normal"
                      />
                    ) : null}
                    <span className="mt-1 block text-[10px] font-normal text-slate-500">Escolha uma opção ou informe o identificador exato. Use “Equipe de IA” para testar a conexão antes de uma rodada operacional.</span>
                  </label>}
                  <NumberSetting
                    label="Máximo de recomendações"
                    value={draft.aiMaxRecommendations}
                    suffix="itens"
                    onChange={(value) =>
                      setDraft({ ...draft, aiMaxRecommendations: value })
                    }
                  />
                  <div className="rounded-xl border bg-white p-3 text-xs text-slate-600">
                    <strong className="block text-slate-900">
                      Modelo automático
                    </strong>
                    O OpenRouter escolhe conforme complexidade e
                    disponibilidade; o modelo efetivamente usado fica
                    registrado.
                  </div>
                  <label className="text-sm font-bold sm:col-span-2">
                    Personalidade da analista
                    <textarea
                      rows={4}
                      value={draft.aiPersonalityPrompt}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          aiPersonalityPrompt: event.target.value,
                        })
                      }
                      className="mt-1.5 w-full rounded-xl border bg-white px-3 py-2 font-normal outline-none focus:border-violet-400"
                    />
                  </label>
                  <label className="text-sm font-bold sm:col-span-2">
                    Critérios adicionais para observar
                    <textarea
                      rows={5}
                      value={draft.aiAnalysisCriteria}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          aiAnalysisCriteria: event.target.value,
                        })
                      }
                      className="mt-1.5 w-full rounded-xl border bg-white px-3 py-2 font-normal outline-none focus:border-violet-400"
                    />
                  </label>
                </div>
              </div>
              {error ? (
                <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </p>
              ) : null}
              {savedAt && !hasUnsavedChanges ? (
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <CheckCircle2 className="size-5 shrink-0" />
                  <div>
                    <strong className="block">
                      Configuração confirmada no banco
                    </strong>
                    <span className="text-xs">
                      Salva às{" "}
                      {savedAt.toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                      . Você pode fechar esta janela.
                    </span>
                  </div>
                </div>
              ) : null}
              {hasUnsavedChanges ? (
                <div className="mt-4 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  <TriangleAlert className="size-5 shrink-0" />
                  <span>
                    <strong>Alterações ainda não salvas.</strong> Clique em
                    “Salvar alterações” para confirmar novamente no banco.
                  </span>
                </div>
              ) : null}
            </div>
            <footer className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-3">
              <Button variant="outline" onClick={closeEditor}>
                {savedAt ? "Fechar" : "Cancelar"}
              </Button>
              <Button
                disabled={
                  busy ||
                  total !== 100 ||
                  (draft.aiProvider === "openrouter"
                    ? draft.aiModelMode === "manual" &&
                      (!draft.aiModel || draft.aiModel === "openrouter/auto")
                    : !draft.aiModel)
                }
                onClick={() => void save()}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Save className="size-4" />
                )}
                {hasUnsavedChanges
                  ? "Salvar alterações"
                  : savedAt
                    ? "Salvar novamente"
                    : "Salvar critérios e IA"}
              </Button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}

function AiDecisionPanel({
  configured,
  enabled,
  analysis,
  busy,
  error,
  shiftGoals,
  onAnalyze,
  onApplyScenario,
  orderLabels,
}: {
  configured: boolean;
  enabled: boolean;
  analysis: AiAnalysisEnvelope | null;
  busy: boolean;
  error: string;
  shiftGoals: ShiftGoalsReport;
  onAnalyze: () => void;
  onApplyScenario: () => void;
  orderLabels: Record<string, string>;
}) {
  const decisionLabels = {
    approve: "Pode seguir",
    approve_with_adjustments: "Ajustar antes de seguir",
    replan: "Reorganizar a programação",
    blocked: "Não iniciar agora",
  } as const;
  const priorityLabels = {
    critical: "Ação urgente",
    high: "Atenção",
    medium: "Melhoria",
    opportunity: "Oportunidade",
  } as const;
  const validation = analysis?.result.validation;
  return (
    <div className="rounded-xl bg-gradient-to-r from-violet-50/80 via-white to-blue-50/70 p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-violet-600 text-white">
          <BrainCircuit className="size-5" />
        </span>
        <div className="flex-1">
          <p className="text-[10px] font-black uppercase tracking-[.16em] text-violet-600">
            Copiloto de decisão
          </p>
          <h3 className="font-heading text-lg font-black">
            Analista IA de PCP e Processos
          </h3>
          <p className="text-xs text-slate-500">
            Explica os dados da simulação e propõe ações para você conferir.
            Os impedimentos físicos continuam valendo.
          </p>
        </div>
        <Button
          disabled={busy || !configured || !enabled}
          onClick={onAnalyze}
          className="bg-violet-600 text-white hover:bg-violet-700"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Sparkles className="size-4" />
          )}
          {analysis ? "Atualizar análise" : "Analisar cenário"}
        </Button>
      </div>
      {!configured ? (
        <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800">
          Integração preparada, mas nenhum provedor está configurado no servidor.
          Configure OpenRouter, OpenAI, LM Studio local ou OpenClaw nos critérios.
        </p>
      ) : !enabled ? (
        <p className="mt-3 rounded-xl border bg-white p-3 text-xs text-slate-600">
          Ative a IA em Configurações → Critérios e analista IA do AluPilot para liberar esta análise.
        </p>
      ) : null}
        <div className="mt-3 grid gap-2 rounded-xl border border-violet-200 bg-white p-3 text-xs sm:grid-cols-5">
        <div><span className="block font-bold uppercase tracking-wide text-slate-500">Produção acumulada</span><strong>{formatNumber(shiftGoals.projectedKg, 0)} kg · {formatNumber(shiftGoals.projectedTonnes, 1)} t</strong></div>
        <div><span className="block font-bold uppercase tracking-wide text-slate-500">Média operacional da janela ({shiftGoals.goals.productivityBasis})</span><strong>{formatNumber(shiftGoals.averageProductivityKgH, 0)} kg/h</strong><small className="mt-1 block text-xs text-slate-500">não é a previsão da Simplificada</small></div>
        <div><span className="block font-bold uppercase tracking-wide text-slate-500">Técnica / operacional</span><strong>{formatNumber(shiftGoals.productivity.technicalKgH, 0)} / {formatNumber(shiftGoals.productivity.operationalKgH, 0)} kg/h</strong></div>
        <div><span className="block font-bold uppercase tracking-wide text-slate-500">Cobertura</span><strong>{formatNumber(shiftGoals.productivity.loadCoveragePercent, 1)}%</strong></div>
        <div><span className="block font-bold uppercase tracking-wide text-slate-500">Meta do turno</span><strong>{shiftGoals.shiftsMeetingBothTargets}/{shiftGoals.shifts.length || 0} turno(s) atendem as duas metas</strong></div>
      </div>
      {error ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
          {error}
        </p>
      ) : null}
      {busy ? (
        <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
          <strong className="block">
            Montando uma orientação simples e segura…
          </strong>
          <span>
            A analista confere prensas, ferramentas, fornos, material e prazo.
            Isso pode levar até 1 minuto.
          </span>
        </div>
      ) : null}
      {analysis?.fallback ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <strong className="block">
            A IA demorou, mas você não ficou sem orientação.
          </strong>
          O AluPilot mostrou abaixo o passo a passo calculado pelas regras
          seguras da fábrica. Para receber um cenário alternativo da IA, tente
          novamente depois de resolver os avisos urgentes.
        </div>
      ) : null}
      {analysis ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-[.8fr_1.2fr]">
          <article className="rounded-2xl border bg-white p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[10px] font-black uppercase text-violet-700">
                {decisionLabels[analysis.result.decision]}
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-black ${analysis.result.confidence >= 70 ? "bg-emerald-50 text-emerald-700" : analysis.result.confidence >= 40 ? "bg-amber-50 text-amber-800" : "bg-red-50 text-red-700"}`}
              >
                {analysis.result.confidence >= 70
                  ? "Boa confiança nos dados"
                  : analysis.result.confidence >= 40
                    ? "Confirme alguns dados"
                    : "Dados insuficientes: confirme antes de agir"}
              </span>
            </div>
            <p className="mt-3 text-[10px] font-black uppercase tracking-wide text-slate-500">
              Situação atual
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-700">
              {analysis.result.executiveSummary}
            </p>
            {validation ? (
              <div className={`mt-3 rounded-xl border p-3 text-xs ${validation.status === "feasible" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : validation.status === "blocked" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
                <strong className="block">Validação do motor: {validation.status === "feasible" ? "sem impedimento conhecido" : validation.status === "blocked" ? "não viável agora" : validation.status === "not_evaluated" ? "aguarda recálculo da alternativa" : "precisa de conferência"}</strong>
                <span>{validation.reason} {validation.hardViolations ? `${validation.hardViolations} impedimento(s). ` : ""}{validation.unknowns ? `${validation.unknowns} dado(s) pendente(s).` : ""}</span>
              </div>
            ) : null}
            {analysis.result.planningChanges?.length ? (
              <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-950">
                <strong className="block">O que a IA sugere mudar</strong>
                <span>
                  {analysis.result.planningChanges.length} posição(ões) seriam alteradas. A cópia da simulação será recalculada antes de qualquer decisão humana.
                </span>
              </div>
            ) : null}
            {analysis.result.resourceConflicts?.length ? (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-900">
                <strong className="block">Conflitos de recurso encontrados</strong>
                <ul className="mt-1 list-disc space-y-1 pl-4">
                  {analysis.result.resourceConflicts.slice(0, 3).map((conflict) => <li key={conflict}>{conflict}</li>)}
                </ul>
              </div>
            ) : null}
            {analysis.result.missingData.length ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <strong className="block">Antes de decidir, confira:</strong>
                <ol className="mt-2 space-y-1.5">
                  {analysis.result.missingData.map((item, index) => (
                    <li key={item} className="flex gap-2">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-amber-200 font-black">
                        {index + 1}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            <details className="mt-3 text-[10px] text-slate-400">
              <summary className="cursor-pointer font-semibold">
                Ver informações técnicas da análise
              </summary>
              <p className="mt-1">
                Avaliação declarada pelo analista (não é garantia): {Math.round(analysis.result.confidence)}% ·{" "}
                modelo {analysis.modelUsed} ·{" "}
                {(analysis.durationMs / 1000).toLocaleString("pt-BR", {
                  maximumFractionDigits: 1,
                })}
                s{analysis.cached ? " · resultado reaproveitado" : ""}
              </p>
              {analysis.result.contract ? (
                <p className="mt-1">
                  Contrato {analysis.result.contract.schemaVersion} · snapshot {analysis.result.contract.provenance.snapshotId} · regras {analysis.result.contract.provenance.engineVersion}.
                </p>
              ) : null}
            </details>
          </article>
          <div className="grid gap-3">
            <article className="rounded-2xl border border-violet-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700">
                  <Route className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-black uppercase tracking-wide text-violet-600">
                    Cenário alternativo da IA
                  </p>
                  <h4 className="font-heading font-black">
                    {analysis.result.proposedScenario.title}
                  </h4>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {analysis.result.proposedScenario.rationale}
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={onApplyScenario}
                  disabled={validation?.status === "blocked"}
                  className="shrink-0 bg-violet-600 text-white hover:bg-violet-700"
                >
                  <Sparkles className="size-4" />
                  {validation?.status === "blocked" ? "Corrigir impedimentos antes" : "Testar esta sequência"}
                </Button>
              </div>
              <div className="mt-3 grid gap-2">
                {analysis.result.proposedScenario.machines.map((machine) => (
                  <div
                    key={machine.machineCode}
                    className="rounded-xl bg-slate-50 p-3"
                  >
                    <strong className="text-xs">
                      {machineLabel(machine.machineCode)}
                    </strong>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      {machine.orderedOrderIds.map((orderId, index) => (
                        <span
                          key={orderId}
                          className="rounded-full border bg-white px-2 py-1 font-mono text-[10px] font-bold text-slate-700"
                        >
                          {String(index + 1).padStart(2, "0")} ·{" "}
                          {orderLabels[orderId] || "Ordem"}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">
                  <strong>Ganhos esperados</strong>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {analysis.result.proposedScenario.expectedBenefits.map(
                      (item) => (
                        <li key={item}>{item}</li>
                      ),
                    )}
                  </ul>
                </div>
                <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">
                  <strong>Pontos para validar</strong>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {analysis.result.proposedScenario.risks.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="mt-3 text-[10px] font-semibold text-slate-500">
                A sugestão não inicia nem aprova produção. Ela apenas abre uma cópia na simulação, onde o motor recalcula o cenário para sua conferência humana.
              </p>
            </article>
            {analysis.result.recommendations.map((item, index) => (
              <details
                key={`${item.title}-${index}`}
                className={`rounded-xl border bg-white ${item.priority === "critical" ? "border-red-200" : item.priority === "high" ? "border-amber-200" : "border-slate-200"}`}
              >
                <summary className="flex cursor-pointer list-none items-start gap-2 p-3">
                  <span
                    className={`mt-0.5 rounded-full px-2 py-1 text-[9px] font-black uppercase ${item.priority === "critical" ? "bg-red-600 text-white" : item.priority === "high" ? "bg-amber-500 text-white" : item.priority === "opportunity" ? "bg-emerald-600 text-white" : "bg-slate-600 text-white"}`}
                  >
                    {priorityLabels[item.priority]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <strong className="text-sm">{item.title}</strong>
                    {item.affectedTools.length ? (
                      <p className="mt-1 font-mono text-[10px] text-orange-600">
                        {item.affectedTools.join(" · ")}
                      </p>
                    ) : null}
                  </div>
                  <ChevronDown className="size-4 text-slate-400" />
                </summary>
                <div className="space-y-3 border-t px-4 py-4 text-xs leading-5 text-slate-700">
                  <div>
                    <strong className="block text-slate-950">
                      O que está acontecendo?
                    </strong>
                    <p className="mt-1">{item.plainExplanation}</p>
                  </div>
                  <div className="rounded-xl bg-red-50 p-3 text-red-900">
                    <strong className="block">Por que isso importa?</strong>
                    <p className="mt-1">{item.impact}</p>
                  </div>
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950">
                    <strong className="block">Quem deve agir?</strong>
                    <p className="mt-1">{item.responsibleRole}</p>
                    <strong className="mt-3 block">O que fazer agora:</strong>
                    <ol className="mt-2 space-y-2">
                      {item.steps.map((step, stepIndex) => (
                        <li key={`${step}-${stepIndex}`} className="flex gap-2">
                          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-blue-700 font-black text-white">
                            {stepIndex + 1}
                          </span>
                          <span className="pt-0.5 font-semibold">{step}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div className="flex gap-2 rounded-xl bg-emerald-50 p-3 text-emerald-900">
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                    <p>
                      <strong>Como confirmar que resolveu:</strong>{" "}
                      {item.successCheck}
                    </p>
                  </div>
                  <details className="rounded-lg border px-3 py-2 text-[11px] text-slate-500">
                    <summary className="cursor-pointer font-semibold">
                      Ver dados usados nesta orientação
                    </summary>
                    <p className="mt-2">{item.evidence.join(" · ")}</p>
                  </details>
                </div>
              </details>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function WeightField({
  label,
  value,
  onChange,
  max = 100,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  max?: number;
}) {
  return (
    <label className="text-sm font-bold">
      {label}
      <div className="mt-1 flex h-11 items-center rounded-xl border bg-white px-3">
        <input
          type="number"
          min="0"
          max={max}
          step="1"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="w-full outline-none"
        />
        <span className="text-xs font-bold text-slate-400">
          {label === "Amostras para calibrar" ? "execuções" : "%"}
        </span>
      </div>
    </label>
  );
}

function NumberSetting({
  label,
  value,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-sm font-bold">
      {label}
      <div className="mt-1.5 flex h-11 items-center rounded-xl border bg-white px-3">
        <input
          type="number"
          min="1"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 outline-none"
        />
        <span className="text-xs font-semibold text-slate-400">{suffix}</span>
      </div>
    </label>
  );
}

function PlanningLearningPanel({
  data,
  expanded,
  onToggle,
}: {
  data: IntelligencePayload;
  expanded: boolean;
  onToggle: () => void;
}) {
  const confidence = data.summary.confidencePercent;
  const learningMessage =
    data.summary.predictionsCompared === 0
      ? "Ainda não há comparação entre previsão e resultado real. Não é possível medir a precisão neste momento."
      : data.summary.observations === 0
      ? "Ainda não há produções concluídas para comparar. Continue registrando o resultado real."
      : confidence < 40
        ? "O sistema ainda está aprendendo. Use os valores como apoio e confirme com o líder antes de mudar a produção."
        : confidence < 70
          ? "O sistema já reconhece tendências, mas algumas ferramentas ainda precisam de mais produções registradas."
          : "O sistema já possui uma base consistente para ajudar nas previsões de produção.";
  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-5 py-4 text-left"
      >
        <span className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-600">
          <Gauge className="size-5" />
        </span>
        <div className="flex-1">
          <p className="text-[10px] font-black uppercase tracking-wide text-violet-600">
            Aprendizado operacional
          </p>
          <h2 className="font-heading font-black">
            {data.summary.observations} produções registradas · {data.summary.predictionsCompared} previsões comparadas
          </h2>
          <p className="text-xs text-slate-500">{learningMessage}</p>
        </div>
        <span className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs font-bold text-slate-600">
          {expanded ? (
            <ChevronUp className="size-4" />
          ) : (
            <ChevronDown className="size-4" />
          )}
          {expanded ? "Recolher" : "Expandir"}
        </span>
      </button>
      {expanded ? (
        <div className="border-t">
          <div className="mx-5 mt-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
            <strong>Como ajudar o sistema a aprender melhor:</strong>
            <ol className="mt-3 grid gap-3 sm:grid-cols-3">
              {[
                "Registre o início e o fim real de cada produção.",
                "Informe a quantidade realmente produzida e qualquer parada.",
                "Depois de algumas execuções, compare a previsão com o realizado.",
              ].map((step, index) => (
                <li key={step} className="flex gap-2">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-blue-700 text-xs font-black text-white">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="grid gap-3 p-5 sm:grid-cols-3">
            <LearningMetric
              label="Produções registradas"
              value={`${data.summary.observations}`}
            />
            <LearningMetric
              label="Previsão conferida com o real"
              value={`${data.summary.predictionsCompared}`}
            />
            <LearningMetric
              label="Validação da previsão"
              value={data.summary.predictionsCompared === 0 ? "Ainda não medida" : "Confira o erro por ferramenta"}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">Ferramenta / setup</th>
                  <th>Prensa</th>
                  <th>Amostras</th>
                  <th>Produção real média</th>
                  <th>Diferença da previsão</th>
                  <th>Dados para calibrar</th>
                  <th>Pronto para usar?</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.slice(0, 12).map((group) => (
                  <tr
                    key={`${group.tool_code}-${group.machine_code}-${group.tool_sequence ?? "all"}`}
                    className="border-t"
                  >
                    <td className="px-5 py-3">
                      <strong className="font-mono text-orange-600">
                        {group.tool_code}
                      </strong>
                      <span className="block text-xs text-slate-400">
                        seq. {group.tool_sequence ?? "geral"}
                      </span>
                    </td>
                    <td>{machineLabel(group.machine_code)}</td>
                    <td>{group.sample_count}</td>
                    <td className="font-bold">
                      {normalizeProductivityKgH(group.average_actual_productivity_kg_h)
                        ? `${formatNumber(normalizeProductivityKgH(group.average_actual_productivity_kg_h)!, 0)} kg/h`
                        : "Sem medição válida"}
                    </td>
                    <td>
                      {group.mean_absolute_error_percent == null
                        ? "Aguardando previsão"
                        : `${formatNumber(group.mean_absolute_error_percent, 1)}%`}
                    </td>
                    <td>
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-violet-500"
                          style={{
                            width: `${Math.min(group.confidence_percent, 100)}%`,
                          }}
                        />
                      </div>
                      <span className="text-[10px] text-slate-500">
                        {group.mean_absolute_error_percent == null ? "Precisão ainda não medida" : "Veja a diferença da previsão"}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${group.calibrated ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                      >
                        {group.calibrated ? "Sim" : "Ainda aprendendo"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.groups.length ? (
              <div className="grid h-32 place-items-center text-sm text-slate-400">
                Conclua uma produção e registre o resultado real para iniciar o
                aprendizado.
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LearningMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="text-[9px] font-black uppercase text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-900">{value}</p>
    </div>
  );
}

function GanttChart({
  machines,
}: {
  machines: ReturnType<typeof simulateMachineLoad>["machines"];
}) {
  const [zoomPxPerHour, setZoomPxPerHour] = useState(220);
  const allItems = machines.flatMap((machine) => machine.items);
  const start = allItems.reduce<Date | null>(
    (earliest, item) =>
      !earliest || item.startAt < earliest ? item.startAt : earliest,
    null,
  );
  const end = allItems.reduce<Date | null>(
    (latest, item) => (!latest || item.endAt > latest ? item.endAt : latest),
    null,
  );
  if (!start || !end)
    return (
      <div className="grid h-52 place-items-center text-sm text-slate-400">
        Sem itens para exibir.
      </div>
    );
  const span = Math.max(end.getTime() - start.getTime(), 1);
  const spanHours = span / 3_600_000;
  const timelineWidth = Math.max(1200, Math.ceil(spanHours * zoomPxPerHour));
  const tickCount = Math.min(40, Math.max(7, Math.ceil(timelineWidth / 220)));
  const zoomPercent = Math.round((zoomPxPerHour / 220) * 100);
  const overviewActive = zoomPxPerHour === 70;
  const readableActive = zoomPxPerHour === 220;
  const ticks = Array.from({ length: tickCount }, (_, index) => ({
    date: new Date(start.getTime() + span * (index / (tickCount - 1))),
    left: (index / (tickCount - 1)) * timelineWidth,
  }));
  return (
    <div className="p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-black text-slate-900">
            Linha de produção por ferramenta
          </p>
          <p className="text-xs text-slate-500">
            Amplie para separar as operações curtas e ler os códigos diretamente
            nas barras.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setZoomPxPerHour(70)}
              className={`rounded-lg px-3 py-1.5 transition ${overviewActive ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
            >
              Visão geral
            </button>
            <button
              type="button"
              onClick={() => setZoomPxPerHour(220)}
              className={`rounded-lg px-3 py-1.5 transition ${readableActive ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
            >
              Códigos legíveis
            </button>
          </div>
          <div
            className="flex h-10 items-center gap-1 rounded-xl border bg-white p-1 shadow-sm"
            aria-label="Controles de zoom do Gantt"
          >
            <button
              type="button"
              onClick={() =>
                setZoomPxPerHour((current) => Math.max(70, current - 50))
              }
              disabled={zoomPxPerHour <= 70}
              className="grid size-8 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Diminuir zoom"
              title="Diminuir zoom"
            >
              <ZoomOut className="size-4" />
            </button>
            <input
              type="range"
              min="70"
              max="520"
              step="10"
              value={zoomPxPerHour}
              onChange={(event) => setZoomPxPerHour(Number(event.target.value))}
              className="w-24 accent-orange-500 sm:w-32"
              aria-label="Nível de zoom"
            />
            <span className="w-12 text-center text-[11px] font-black tabular-nums text-slate-700">
              {zoomPercent}%
            </span>
            <button
              type="button"
              onClick={() =>
                setZoomPxPerHour((current) => Math.min(520, current + 50))
              }
              disabled={zoomPxPerHour >= 520}
              className="grid size-8 place-items-center rounded-lg text-slate-600 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
              aria-label="Aumentar zoom"
              title="Aumentar zoom"
            >
              <ZoomIn className="size-4" />
            </button>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border bg-slate-50/50">
        <div style={{ width: `${timelineWidth + 144}px` }}>
          <div className="sticky top-0 z-20 grid h-10 grid-cols-[144px_1fr] border-b bg-white">
            <div className="sticky left-0 z-30 flex items-center border-r bg-white px-4 text-[10px] font-black uppercase text-slate-400">
              Prensa
            </div>
            <div className="relative">
              {ticks.map((tick, index) => (
                <span
                  key={tick.date.toISOString()}
                  className={`absolute top-2 whitespace-nowrap text-[10px] font-bold text-slate-400 ${index === 0 ? "" : index === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
                  style={{ left: `${tick.left}px` }}
                >
                  {tick.date.toLocaleString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              ))}
            </div>
          </div>
          {machines.map((machine) => (
            <div
              key={machine.machineCode}
              className="grid grid-cols-[144px_1fr] border-b last:border-b-0"
            >
              <div className="sticky left-0 z-20 border-r bg-white px-4 py-4">
                <strong className="font-heading text-sm text-slate-900">
                  {machineLabel(machine.machineCode)}
                </strong>
                <p className="text-[10px] text-slate-400">
                  {machine.items.length} ferramentas
                </p>
                <p className="mt-1 text-[10px] font-semibold text-slate-500">
                  {formatDuration(machine.simulatedMinutes)}
                </p>
              </div>
              <div
                className="relative h-[106px] overflow-hidden bg-white"
                style={{
                  backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${Math.max(39, timelineWidth / (tickCount - 1) - 1)}px, rgb(226 232 240) ${Math.max(40, timelineWidth / (tickCount - 1))}px)`,
                }}
              >
                <div className="absolute inset-x-0 top-0 flex h-8 items-center gap-1 overflow-hidden border-b bg-slate-50/80 px-2">
                  {machine.items.map((item, index) => (
                    <span
                      key={`sequence-${item.id}`}
                      title={`${index + 1}. ${item.toolCode}`}
                      className="shrink-0 rounded-md border bg-white px-2 py-1 font-mono text-[10px] font-black text-slate-700"
                    >
                      <i className="mr-1 text-slate-400">
                        {String(index + 1).padStart(2, "0")}
                      </i>
                      {item.toolCode}
                    </span>
                  ))}
                </div>
                {machine.items.map((item, index) => {
                  const left =
                    ((item.startAt.getTime() - start.getTime()) / span) *
                    timelineWidth;
                  const width = Math.max(
                    ((item.endAt.getTime() - item.startAt.getTime()) / span) *
                      timelineWidth,
                    2,
                  );
                  const blocked = item.resourceConflicts?.some(
                    (conflict) => conflict.severity === "blocking",
                  );
                  const delayed = item.resourceWaitMinutes > 0.5;
                  const readable = width >= 58;
                  return (
                    <div
                      key={item.id}
                      title={`${item.toolCode} · ${formatDateTime(item.startAt)} → ${formatDateTime(item.endAt)}${delayed ? ` · espera ${formatDuration(item.resourceWaitMinutes)}` : ""}`}
                      className={`absolute flex h-7 items-center rounded-md border px-1.5 text-[10px] font-black shadow-sm ${blocked ? "border-red-400 bg-red-100 text-red-800" : delayed ? "border-amber-400 bg-amber-100 text-amber-900" : index % 2 ? "border-blue-300 bg-blue-100 text-blue-800" : "border-orange-300 bg-orange-100 text-orange-800"}`}
                      style={{
                        left: `${left}px`,
                        width: `${width}px`,
                        top: `${40 + (index % 2) * 32}px`,
                        zIndex: index + 1,
                      }}
                    >
                      <span className="truncate">
                        {readable ? item.toolCode : index + 1}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-4 text-[10px] font-bold text-slate-500">
        <span className="rounded-md bg-slate-100 px-2 py-1 text-slate-600">
          Arraste a barra horizontal para percorrer o período ampliado
        </span>
        <span>
          <i className="mr-1 inline-block size-2 rounded-full bg-orange-300" />
          Produção programada
        </span>
        <span>
          <i className="mr-1 inline-block size-2 rounded-full bg-blue-300" />
          Sequência alternada
        </span>
        <span>
          <i className="mr-1 inline-block size-2 rounded-full bg-amber-300" />
          Atrasada por recurso
        </span>
        <span>
          <i className="mr-1 inline-block size-2 rounded-full bg-red-300" />
          Cadastro bloqueante
        </span>
      </div>
    </div>
  );
}

function ThermalCoveragePanel({
  machines,
}: {
  machines: ReturnType<typeof simulateMachineLoad>["machines"];
}) {
  const statusConfig = {
    protected: {
      label: "Cobertura protegida",
      detail:
        "A sequência mantém ferramentas prontas sem espera térmica prevista.",
      shell: "border-emerald-200 bg-emerald-50",
      badge: "bg-emerald-600 text-white",
      icon: "text-emerald-600",
    },
    attention: {
      label: "Mix curto exige atenção",
      detail:
        "Não há parada prevista, mas o mix curto ou a ocupação dos fornos reduz a margem.",
      shell: "border-amber-200 bg-amber-50",
      badge: "bg-amber-500 text-white",
      icon: "text-amber-600",
    },
    risk: {
      label: "Risco de falta de ferramenta",
      detail:
        "A prensa alcança a próxima ferramenta antes do fim do aquecimento.",
      shell: "border-red-200 bg-red-50",
      badge: "bg-red-600 text-white",
      icon: "text-red-600",
    },
  } as const;
  if (!machines.length) return null;
  return (
    <section className="grid gap-3 xl:grid-cols-2">
      {machines.map((machine) => {
        const coverage = machine.thermalCoverage;
        const visual = statusConfig[coverage.status];
        return (
          <article
            key={machine.machineCode}
            className={`rounded-2xl border px-4 py-3 shadow-sm ${visual.shell}`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <ShieldCheck className={`size-5 ${visual.icon}`} />
              <div className="min-w-0">
                <h3 className="text-sm font-black text-slate-900">
                  Cobertura térmica · {machineLabel(machine.machineCode)}
                </h3>
                <p className="text-[11px] text-slate-600">{visual.detail}</p>
              </div>
              <span
                className={`ml-auto rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wide ${visual.badge}`}
              >
                {visual.label}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Compact
                label={`Mix mínimo (${formatDuration(coverage.heatingHorizonMinutes)})`}
                value={`${formatNumber(coverage.minimumMixKg, 0)} kg`}
              />
              <Compact
                label="Carga protegida"
                value={`${formatNumber(coverage.protectedBufferKg, 0)} kg`}
              />
              <Compact
                label="Itens abaixo de 300 kg"
                value={`${coverage.shortRunCount} · máx. ${coverage.maxConsecutiveShortRuns} seguidos`}
              />
              <Compact
                label="Pico de vagas"
                value={`${coverage.peakOvenSlotsUsed}/${coverage.ovenSlots}`}
              />
            </div>
            {coverage.status === "risk" ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-red-200 bg-white/70 px-3 py-2 text-[11px] text-red-800">
                <TriangleAlert className="size-4 shrink-0" />
                <strong>
                  {formatDuration(coverage.predictedIdleMinutes)} de espera
                  térmica
                </strong>
                <span>
                  Primeiro risco: {coverage.firstRiskToolCode} ·{" "}
                  {formatDateTime(coverage.firstRiskAt)}
                </span>
              </div>
            ) : coverage.nextToolToHeat ? (
              <p className="mt-2 text-[11px] text-slate-600">
                <strong>Próxima preparação:</strong> {coverage.nextToolToHeat}{" "}
                deve entrar no forno até{" "}
                {formatDateTime(coverage.nextHeatingDeadlineAt)}.
              </p>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone = "slate",
  helpTopic,
  className,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  tone?: "slate" | "orange" | "blue" | "violet" | "green";
  helpTopic?: LoadHelpKey;
  className?: string;
}) {
  const colors = {
    slate: "bg-slate-100 text-slate-700",
    orange: "bg-orange-50 text-orange-600",
    blue: "bg-blue-50 text-blue-600",
    violet: "bg-violet-50 text-violet-600",
    green: "bg-emerald-50 text-emerald-600",
  };
  return (
    <div
      className={`flex min-w-0 items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm ${className ?? ""}`}
    >
      <span
        className={`grid size-10 place-items-center rounded-xl ${colors[tone]}`}
      >
        <Icon className="size-5" />
      </span>
      <div>
        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-500">
          {label}
          {helpTopic && <FieldHelp topic={helpTopic} />}
        </p>
        <p className="text-lg font-black text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function AlloyWarnings({
  machines,
}: {
  machines: ReturnType<typeof simulateMachineLoad>["machines"];
}) {
  const transitions = machines.flatMap((machine) =>
    machine.items.slice(1).flatMap((item, index) => {
      const previous = machine.items[index];
      if (
        previous.selectedAlloy === item.selectedAlloy ||
        previous.billetBalanceAfterKg < 0.1
      )
        return [];
      const accepted = item.alternativeAlloys
        .map((alloy) => alloy.trim().toUpperCase())
        .includes(previous.selectedAlloy.trim().toUpperCase());
      return [
        {
          machine: machine.machineCode,
          from: previous.selectedAlloy,
          to: item.selectedAlloy,
          balance: previous.billetBalanceAfterKg,
          accepted,
        },
      ];
    }),
  );
  if (!transitions.length)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
        <span className="grid size-6 place-items-center rounded-full bg-white font-black">
          ✓
        </span>
        <p>
          <strong>Sequência eficiente de ligas.</strong> Não há sobra relevante
          antes de uma virada incompatível.
        </p>
      </div>
    );
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div>
          <p className="font-bold">
            Atenção ao consumo de tarugo antes da troca de liga
          </p>
          <div className="mt-1 space-y-1">
            {transitions.map((transition) => (
              <p
                key={`${transition.machine}-${transition.from}-${transition.to}`}
              >
                Prensa {transition.machine}: sobram{" "}
                <strong>
                  {formatNumber(transition.balance)} kg de {transition.from}
                </strong>{" "}
                antes de {transition.to}.{" "}
                {transition.accepted
                  ? "A próxima ferramenta aceita essa liga como alternativa; confirme o uso."
                  : "As ligas são incompatíveis: reordene a sequência ou distribua o saldo antes da virada."}
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function BilletStockWarnings({
  billets,
  stock,
  available,
}: {
  billets: ReturnType<typeof simulateMachineLoad>["billets"];
  stock: BilletStockSummary[];
  available: boolean;
}) {
  if (!available)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
        <PackageOpen className="size-4 shrink-0" />
        <p className="flex-1">
          <strong>Estoque físico ainda não ativado.</strong> A simulação
          continua calculando a necessidade, mas não pode confirmar a
          disponibilidade.
        </p>
        <a
          href="/configuracoes/tarugos"
          className="rounded-lg bg-blue-700 px-3 py-2 font-bold text-white"
        >
          Cadastrar estoque
        </a>
      </div>
    );
  const shortages = billets.flatMap((row) => {
    const stocked = stock.find(
      (item) =>
        item.alloyCode.trim().toUpperCase() ===
        row.alloyCode.trim().toUpperCase(),
    );
    const availableBars = stocked?.availableBars ?? 0;
    return availableBars < row.bars
      ? [
          {
            alloyCode: row.alloyCode,
            required: row.bars,
            available: availableBars,
            shortage: row.bars - availableBars,
          },
        ]
      : [];
  });
  if (!shortages.length)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
        <PackageOpen className="size-4" />
        <p>
          <strong>Tarugos cobertos.</strong> Há estoque livre suficiente para
          todas as ligas desta simulação.
        </p>
      </div>
    );
  return (
    <section className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-600" />
        <div>
          <p className="font-black">Risco de parada por falta de tarugo</p>
          <div className="mt-1 space-y-1">
            {shortages.map((item) => (
              <p key={item.alloyCode}>
                Liga <strong>{item.alloyCode}</strong>: precisa de{" "}
                {item.required} barra(s), possui {item.available} livre(s) e
                faltam <strong>{item.shortage}</strong>.
              </p>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function PressResourceWarnings({
  machines,
  resources,
  available,
}: {
  machines: ReturnType<typeof simulateMachineLoad>["machines"];
  resources: CarcassResource[];
  available: boolean;
}) {
  const items = machines.flatMap((machine) => machine.items);
  const missingHoles = items.filter((item) => !item.holes).length;
  const missingBo = items.filter((item) => !item.boCode).length;
  const missingCarcass = items.filter((item) => !item.carcassCode).length;
  const hasIncompleteData =
    missingHoles > 0 || missingBo > 0 || missingCarcass > 0;
  const resourceByCode = resources.reduce<Map<string, number>>(
    (result, resource) => {
      const code = resource.carcassCode.trim().toUpperCase();
      result.set(code, (result.get(code) ?? 0) + resource.availableQuantity);
      return result;
    },
    new Map(),
  );
  const scheduledByCode = items.reduce<Map<string, typeof items>>(
    (result, item) => {
      const code = item.carcassCode?.trim().toUpperCase();
      if (code) result.set(code, [...(result.get(code) ?? []), item]);
      return result;
    },
    new Map(),
  );
  const conflicts = available
    ? [...scheduledByCode.entries()].flatMap(([code, scheduled]) => {
        const free = resourceByCode.get(code) ?? 0;
        const events = scheduled
          .flatMap((item) => [
            { time: item.startAt.getTime(), change: 1 },
            { time: item.endAt.getTime(), change: -1 },
          ])
          .sort(
            (left, right) =>
              left.time - right.time || left.change - right.change,
          );
        let concurrent = 0;
        let peak = 0;
        let firstConflictAt: number | null = null;
        for (const event of events) {
          concurrent += event.change;
          peak = Math.max(peak, concurrent);
          if (concurrent > free && firstConflictAt === null)
            firstConflictAt = event.time;
        }
        return peak > free ? [{ code, free, peak, firstConflictAt }] : [];
      })
    : [];

  if (!available)
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
        <Boxes className="size-4 shrink-0" />
        <p className="flex-1">
          <strong>Disponibilidade de carcaças ainda não ativada.</strong> Furos,
          BO e carcaça já são registrados no cenário, porém a capacidade física
          ainda não pode ser confirmada.
        </p>
      </div>
    );
  if (conflicts.length)
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">
        <div className="flex items-start gap-2">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-red-600" />
          <div>
            <p className="font-black">
              Risco no estoque compartilhado de carcaças
            </p>
            {conflicts.map((item) => (
              <p key={item.code} className="mt-1">
                Carcaça <strong>{item.code}</strong>: a simulação exige até{" "}
                {item.peak} unidade(s) ao mesmo tempo, mas há {item.free}{" "}
                livre(s)
                {item.firstConflictAt
                  ? ` a partir de ${formatDateTime(new Date(item.firstConflictAt))}`
                  : ""}
                .
              </p>
            ))}
            <p className="mt-2 text-red-700">
              Como o estoque atende às duas prensas, o mesmo saldo não pode ser
              usado simultaneamente.
            </p>
            {hasIncompleteData ? (
              <p className="mt-1 text-red-700">
                Dados incompletos: {missingHoles} item(ns) sem furos,{" "}
                {missingBo} sem BO e {missingCarcass} sem carcaça.
              </p>
            ) : null}
          </div>
        </div>
      </section>
    );
  return (
    <div
      className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-xs ${hasIncompleteData ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
    >
      <Boxes className="size-4 shrink-0" />
      <p>
        <strong>
          {hasIncompleteData
            ? "Estoque compartilhado coberto, com dados incompletos."
            : "Carcaças compartilhadas cobertas."}
        </strong>{" "}
        {hasIncompleteData
          ? `${missingHoles} item(ns) sem furos, ${missingBo} sem BO e ${missingCarcass} sem carcaça.`
          : "A quantidade livre atende aos picos simultâneos das duas prensas; Furos e BO também estão rastreados."}
      </p>
    </div>
  );
}

function BoResourceWarnings({
  machines,
  resources,
  available,
}: {
  machines: ReturnType<typeof simulateMachineLoad>["machines"];
  resources: BoResource[];
  available: boolean;
}) {
  const items = machines
    .flatMap((machine) => machine.items)
    .filter((item) => item.boCode);
  if (!available)
    return (
      <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
        <DiscResourceIcon />
        <p>
          <strong>Estoque de BOs ainda não ativado.</strong> Cadastre as
          quantidades físicas compartilhadas em Configurações.
        </p>
      </div>
    );
  const conflicts = [
    ...new Set(items.map((item) => item.boCode!.trim().toUpperCase())),
  ].flatMap((code) => {
    const free =
      resources.find((item) => item.boCode.trim().toUpperCase() === code)
        ?.availableQuantity ?? 0;
    const scheduled = items.filter(
      (item) => item.boCode?.trim().toUpperCase() === code,
    );
    const events = scheduled
      .flatMap((item) => [
        { time: item.startAt.getTime(), change: 1 },
        { time: item.endAt.getTime(), change: -1 },
      ])
      .sort((a, b) => a.time - b.time || a.change - b.change);
    let concurrent = 0;
    let peak = 0;
    for (const event of events) {
      concurrent += event.change;
      peak = Math.max(peak, concurrent);
    }
    return peak > free ? [{ code, free, peak }] : [];
  });
  if (conflicts.length)
    return (
      <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-900">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <div>
          <strong>Risco no estoque compartilhado de BOs</strong>
          {conflicts.map((item) => (
            <p key={item.code} className="mt-1">
              BO <b>{item.code}</b>: pico de {item.peak} uso(s) simultâneo(s),
              com {item.free} unidade(s) livre(s).
            </p>
          ))}
        </div>
      </div>
    );
  return (
    <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
      <DiscResourceIcon />
      <p>
        <strong>BOs compartilhados cobertos.</strong> O saldo físico atende aos
        picos simultâneos das duas prensas.
      </p>
    </div>
  );
}

function DiscResourceIcon() {
  return (
    <span className="grid size-5 shrink-0 place-items-center rounded-full border-2 border-current text-[8px] font-black">
      BO
    </span>
  );
}

function OperationalCalendarPanel({
  periods,
  machines,
}: {
  periods: ResourceUnavailabilityInput[];
  machines: string[];
}) {
  const relevant = periods.filter(
    (period) =>
      period.status === "active" &&
      period.resourceType === "press" &&
      machines.includes(period.resourceCode),
  );
  if (!relevant.length) return null;
  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-900">
      <div className="flex items-start gap-2">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-violet-600" />
        <div>
          <p className="font-black">
            Calendário de indisponibilidades aplicado
          </p>
          <div className="mt-1 space-y-1">
            {relevant.map((period) => (
              <p key={period.id}>
                <strong>{machineLabel(period.resourceCode)}</strong> ·{" "}
                {formatDateTime(new Date(period.startsAt))} até{" "}
                {formatDateTime(new Date(period.endsAt))} · {period.reason}
              </p>
            ))}
          </div>
          <p className="mt-1 text-violet-700">
            Esses intervalos foram retirados automaticamente das janelas
            produtivas.
          </p>
        </div>
      </div>
    </section>
  );
}

function projectedBilletBalances(
  simulation: ReturnType<typeof simulateMachineLoad>,
) {
  const totals = new Map(
    simulation.billets.map((row) => [row.alloyCode.trim().toUpperCase(), row]),
  );
  const running = new Map(
    [...totals.entries()].map(([code, row]) => [code, row.loadedKg]),
  );
  const orderedItems = simulation.machines
    .flatMap((machine) => machine.items)
    .sort(
      (left, right) =>
        left.extrusionStartAt.getTime() - right.extrusionStartAt.getTime() ||
        left.machineCode.localeCompare(right.machineCode),
    );
  const lastItemByAlloy = new Map<string, string>();
  for (const item of orderedItems)
    lastItemByAlloy.set(item.selectedAlloy.trim().toUpperCase(), item.id);
  return orderedItems.reduce<Record<string, ProjectedBilletBalance>>(
    (result, item) => {
      const code = item.selectedAlloy.trim().toUpperCase();
      const total = totals.get(code);
      const initialKg = total?.loadedKg ?? item.billetRequiredKg;
      const barWeightKg = total?.bars ? total.loadedKg / total.bars : 0;
      const beforeKg = running.get(code) ?? initialKg;
      const afterKg = Math.max(beforeKg - item.billetRequiredKg, 0);
      running.set(code, afterKg);
      result[item.id] = {
        beforeKg,
        consumedKg: item.billetRequiredKg,
        afterKg,
        initialKg,
        barWeightKg,
        remainingBarEquivalent: barWeightKg > 0 ? afterKg / barWeightKg : 0,
        isFinalForAlloy: lastItemByAlloy.get(code) === item.id,
      };
      return result;
    },
    {},
  );
}

function Timeline({
  machines,
  projectedBalances,
  manual,
  onMove,
}: {
  machines: ReturnType<typeof simulateMachineLoad>["machines"];
  projectedBalances: Record<string, ProjectedBilletBalance>;
  manual: boolean;
  onMove: (machineCode: string, draggedId: string, targetId: string) => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  return (
    <div className="divide-y">
      <div className="flex items-start gap-2 bg-blue-50 px-4 py-2.5 text-xs text-blue-800">
        <PackageOpen className="mt-0.5 size-4 shrink-0" />
        <p>
          <strong>Saldo projetado da liga:</strong> começa na carga total
          calculada em barras e desconta o bruto necessário de cada ferramenta
          pela ordem real de início, cruzando as duas prensas. O último consumo
          destaca o saldo final previsto.
        </p>
      </div>
      {manual && (
        <div className="flex items-center gap-2 bg-orange-50 px-4 py-2 text-xs font-semibold text-orange-800">
          <GripVertical className="size-4" />
          Arraste uma linha pela alça para testar outra sequência. Horários,
          barras e saldo de tarugo são recalculados automaticamente.
        </div>
      )}
      {machines.map((machine) => (
        <div key={machine.machineCode} className="p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div>
              <strong>{machineLabel(machine.machineCode)}</strong>
              <span className="ml-2 text-xs text-slate-500">
                {machine.items.length} item(ns) · inicia{" "}
                {formatDateTime(machine.startsAt)} · termina{" "}
                {formatDateTime(machine.endsAt)}
              </span>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
              calendário {formatDuration(machine.simulatedMinutes)} · extrusão {formatDuration(machine.theoreticalMinutes)}
            </span>
          </div>
          <div className="w-full min-w-0 overflow-x-auto overscroll-x-contain">
            <table className="w-full min-w-[780px] text-left text-xs min-[1367px]:min-w-[1640px]">
              <thead className="bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-2 py-2 min-[1367px]:px-3"># / Ferramenta</th>
                  <th className="hidden px-3 py-2 min-[1367px]:table-cell">Recursos</th>
                  <th className="hidden px-3 py-2 min-[1367px]:table-cell">Plano</th>
                  <th className="px-2 py-2 min-[1367px]:px-3">Pedido / ordem</th>
                  <th className="px-2 py-2 min-[1367px]:px-3">
                    Qtd. pedida
                    <br />
                    <span className="normal-case text-slate-400">líquido</span>
                  </th>
                  <th className="hidden px-3 py-2 min-[1367px]:table-cell">Saldo do pedido</th>
                  <th className="hidden px-3 py-2 min-[1367px]:table-cell">
                    Bruto necessário
                    <br />
                    <span className="normal-case text-slate-400">
                      com eficiência
                    </span>
                  </th>
                  <th className="px-2 py-2 min-[1367px]:px-3">Preparação</th>
                  <th className="px-2 py-2 min-[1367px]:px-3">Início</th>
                  <th className="px-2 py-2 min-[1367px]:px-3">Duração</th>
                  <th className="px-2 py-2 min-[1367px]:px-3">Fim</th>
                  <th className="hidden px-3 py-2 min-[1367px]:table-cell">Produtividade</th>
                  <th className="hidden px-3 py-2 min-[1367px]:table-cell">Liga / barras</th>
                  <th className="hidden px-3 py-2 min-[1367px]:table-cell">Saldo projetado da liga</th>
                </tr>
              </thead>
              <tbody>
                {machine.items.map((item, index) => (
                  <tr
                    key={item.id}
                    draggable={manual}
                    onDragStart={(event) => {
                      if (!manual) return;
                      setDraggedId(item.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.id);
                    }}
                    onDragOver={(event) => {
                      if (!manual || draggedId === item.id) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setOverId(item.id);
                    }}
                    onDragLeave={() =>
                      setOverId((current) =>
                        current === item.id ? null : current,
                      )
                    }
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceId =
                        draggedId ?? event.dataTransfer.getData("text/plain");
                      if (sourceId)
                        onMove(machine.machineCode, sourceId, item.id);
                      setDraggedId(null);
                      setOverId(null);
                    }}
                    onDragEnd={() => {
                      setDraggedId(null);
                      setOverId(null);
                    }}
                    className={`border-t transition ${manual ? "cursor-grab active:cursor-grabbing" : ""} ${draggedId === item.id ? "opacity-40" : ""} ${overId === item.id ? "bg-orange-100 ring-2 ring-inset ring-orange-400" : "hover:bg-orange-50/30"}`}
                  >
                    <td className="px-2 py-2 min-[1367px]:px-3 min-[1367px]:py-2.5">
                      <span className="inline-flex items-center">
                        <span className="mr-2 text-slate-400">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        {manual && (
                          <GripVertical
                            className="mr-2 size-4 text-orange-500"
                            aria-label={`Arrastar ${item.toolCode}`}
                          />
                        )}
                        <strong className="font-mono text-orange-600">
                          {item.toolCode}
                        </strong>
                      </span>
                      <details className="mt-2 min-[1367px]:hidden">
                        <summary className="cursor-pointer text-[10px] font-bold text-violet-700">
                          Ver recursos e cálculo
                        </summary>
                        <div className="mt-2 grid gap-2 rounded-lg bg-slate-50 p-2 text-[10px] text-slate-600">
                          <div className="flex flex-wrap gap-1">
                            <ResourceChip label="Furos" value={item.holes ? String(item.holes) : "—"} missing={!item.holes} />
                            <ResourceChip label="BO" value={item.boCode || "—"} missing={!item.boCode} />
                            <ResourceChip label="Carcaça" value={item.carcassCode || "—"} missing={!item.carcassCode} />
                          </div>
                          <p><strong>Plano:</strong> {item.planCode} · <strong>Saldo:</strong> {formatNumber(item.remainingKg)} kg · <strong>Bruto:</strong> {formatNumber(item.billetRequiredKg)} kg</p>
                          <p><strong>Produtividade:</strong> {formatNumber(item.productivityKgH, 0)} kg/h · {sourceLabel[item.productivitySource]} · <strong>Liga:</strong> {item.selectedAlloy} (+{item.billetBarsLoaded} barra(s))</p>
                          {projectedBalances[item.id] ? <p><strong>Saldo previsto da liga:</strong> {formatNumber(projectedBalances[item.id].afterKg)} kg</p> : null}
                        </div>
                      </details>
                    </td>
                    <td className="hidden px-3 py-2.5 min-[1367px]:table-cell">
                      <div className="flex min-w-44 flex-wrap gap-1">
                        <ResourceChip
                          label="Furos"
                          value={item.holes ? String(item.holes) : "—"}
                          missing={!item.holes}
                        />
                        <ResourceChip
                          label="BO"
                          value={item.boCode || "—"}
                          missing={!item.boCode}
                        />
                        <ResourceChip
                          label="Carcaça"
                          value={item.carcassCode || "—"}
                          missing={!item.carcassCode}
                        />
                      </div>
                    </td>
                    <td className="hidden px-3 py-2.5 font-bold min-[1367px]:table-cell">{item.planCode}</td>
                    <td className="px-2 py-2 font-mono font-bold text-slate-700 min-[1367px]:px-3 min-[1367px]:py-2.5">
                      {item.orderNumber}
                    </td>
                    <td className="px-2 py-2 font-bold tabular-nums min-[1367px]:px-3 min-[1367px]:py-2.5">
                      {formatNumber(item.targetKg)} kg
                    </td>
                    <td className="hidden px-3 py-2.5 font-bold tabular-nums text-blue-700 min-[1367px]:table-cell">
                      {formatNumber(item.remainingKg)} kg
                    </td>
                    <td className="hidden px-3 py-2.5 min-[1367px]:table-cell">
                      <strong className="tabular-nums text-slate-900">
                        {formatNumber(item.billetRequiredKg)} kg
                      </strong>
                      <span className="block text-[9px] text-slate-400">
                        {formatNumber(
                          item.billetRequiredKg > 0
                            ? (item.remainingKg / item.billetRequiredKg) * 100
                            : 0,
                          0,
                        )}
                        % eficiência
                      </span>
                    </td>
                    <td className="px-2 py-2 min-[1367px]:px-3 min-[1367px]:py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold ${item.furnaceState === "released" ? "bg-emerald-50 text-emerald-700" : item.furnaceState === "ready_waiting" ? "bg-violet-50 text-violet-700" : item.furnaceState === "heating" ? "bg-orange-50 text-orange-700" : "bg-amber-50 text-amber-700"}`}
                      >
                        <Flame className="size-3" />
                        {item.furnaceState === "released"
                            ? "Liberada"
                            : item.furnaceState === "ready_waiting"
                                ? `Pronta aguardando · ${formatDuration(item.readyWaitingMinutes)}`
                                : item.furnaceState === "heating"
                                  ? `Aquecendo · pronta ${formatDateTime(item.calculatedToolReadyAt)}`
                                  : "Aquecimento planejado"}
                      </span>
                      {item.ovenSlotNumber &&
                        item.toolHeatingState !== "released" && (
                          <span className="mt-1 block space-y-0.5 text-[9px] text-slate-400">
                            <span className="block">{item.ovenCode ?? "Forno"} · posição {item.ovenPosition ?? item.ovenSlotNumber}</span>
                            <span className="block">Entrada {formatDateTime(item.toolHeatingStartAt)} · pronta {formatDateTime(item.calculatedToolReadyAt)}</span>
                            <span className="block">Retirada no início da extrusão: {formatDateTime(item.toolOvenExitAt)}</span>
                          </span>
                        )}
                    </td>
                    <td className="px-2 py-2 tabular-nums min-[1367px]:px-3 min-[1367px]:py-2.5">
                      {formatDateTime(item.extrusionStartAt)}
                    </td>
                    <td className="px-2 py-2 font-bold tabular-nums min-[1367px]:px-3 min-[1367px]:py-2.5">
                      {formatDuration(item.theoreticalMinutes)}
                    </td>
                    <td className="px-2 py-2 tabular-nums min-[1367px]:px-3 min-[1367px]:py-2.5">
                      {formatDateTime(item.endAt)}
                    </td>
                    <td className="hidden px-3 py-2.5 min-[1367px]:table-cell">
                      <strong>
                        {formatNumber(item.productivityKgH, 0)} kg/h
                      </strong>
                      <span className="block text-[9px] text-slate-400">
                        {sourceLabel[item.productivitySource]}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2.5 min-[1367px]:table-cell">
                      <strong>{item.selectedAlloy}</strong>
                      <span className="block text-[10px] text-slate-400">
                        +{item.billetBarsLoaded} barra(s)
                      </span>
                    </td>
                    <td className="hidden px-3 py-2.5 min-[1367px]:table-cell">
                      <ProjectedBalanceCell
                        balance={projectedBalances[item.id]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
function ResourceChip({
  label,
  value,
  missing,
}: {
  label: string;
  value: string;
  missing: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-1 text-[9px] font-bold ${missing ? "border-amber-200 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-700"}`}
    >
      <span className="uppercase text-slate-400">{label}</span>
      {value}
    </span>
  );
}
function ProjectedBalanceCell({
  balance,
}: {
  balance?: ProjectedBilletBalance;
}) {
  if (!balance) return <span className="text-slate-400">—</span>;
  const remainingPercent =
    balance.initialKg > 0
      ? Math.min((balance.afterKg / balance.initialKg) * 100, 100)
      : 0;
  return (
    <div
      className={`min-w-44 rounded-lg border px-2 py-1.5 ${balance.isFinalForAlloy ? "border-violet-200 bg-violet-50" : "border-slate-200 bg-white"}`}
    >
      <div className="flex items-center justify-between gap-2 font-bold tabular-nums">
        <span className="text-slate-500">
          {formatNumber(balance.beforeKg, 0)}
        </span>
        <span className="text-slate-300">→</span>
        <span
          className={
            balance.isFinalForAlloy ? "text-violet-700" : "text-slate-900"
          }
        >
          {formatNumber(balance.afterKg, 0)} kg
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${balance.isFinalForAlloy ? "bg-violet-500" : "bg-blue-500"}`}
          style={{ width: `${remainingPercent}%` }}
        />
      </div>
      <span className="mt-1 block text-[9px] text-slate-500">
        consome {formatNumber(balance.consumedKg, 0)} kg ·{" "}
        {formatNumber(balance.remainingBarEquivalent, 1)} barra(s) eq.
        {balance.isFinalForAlloy ? " · saldo final" : ""}
      </span>
    </div>
  );
}
function BilletTable({
  billets,
  settings,
  stock,
  available,
}: {
  billets: ReturnType<typeof simulateMachineLoad>["billets"];
  settings: Record<string, MachineLoadSettings>;
  stock: BilletStockSummary[];
  available: boolean;
}) {
  const base = Object.values(settings)[0] ?? defaultSettings;
  return (
    <div>
      <div className="grid gap-3 border-b bg-slate-50/70 p-4 sm:grid-cols-3">
        <Compact
          label="Peso padrão da barra"
          value={`${formatNumber(base.billetBarWeightKg, 0)} kg`}
        />
        <Compact
          label="Eficiência"
          value={`${formatNumber(base.extrusionEfficiency * 100, 0)}%`}
        />
        <Compact
          label="Produto útil / barra"
          value={`${formatNumber(base.billetBarWeightKg * base.extrusionEfficiency, 2)} kg`}
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1040px] text-sm">
          <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">Liga</th>
              <th className="px-4 py-3 text-right">Demanda programada</th>
              <th className="px-4 py-3 text-right">Tarugo teórico</th>
              <th className="px-4 py-3 text-right">Barras necessárias</th>
              <th className="px-4 py-3 text-right">Carga calculada</th>
              <th className="px-4 py-3 text-right">Estoque físico livre</th>
              <th className="px-4 py-3 text-right">Cobertura</th>
              <th className="px-4 py-3 text-right">Saldo após carga</th>
              <th className="px-4 py-3 text-right">Sobra no processo</th>
            </tr>
          </thead>
          <tbody>
            {billets.map((row) => {
              const stockRow = stock.find(
                (item) =>
                  item.alloyCode.trim().toUpperCase() ===
                  row.alloyCode.trim().toUpperCase(),
              );
              const availableBars = stockRow?.availableBars ?? 0;
              const availableWeightKg = numberValue(
                stockRow?.availableWeightKg,
              );
              const balance = availableBars - row.bars;
              const coverage =
                row.bars > 0
                  ? Math.min((availableBars / row.bars) * 100, 100)
                  : 100;
              return (
                <tr key={row.alloyCode} className="border-t">
                  <td className="px-4 py-3 font-mono font-black text-orange-600">
                    {row.alloyCode}
                  </td>
                  <td className="px-4 py-3 text-right font-bold">
                    {formatNumber(row.demandKg)} kg
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatNumber(row.rawRequiredKg)} kg
                  </td>
                  <td className="px-4 py-3 text-right text-lg font-black">
                    {row.bars}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {formatNumber(row.loadedKg)} kg
                  </td>
                  <td className="px-4 py-3 text-right font-bold">
                    {available ? (
                      <>
                        <span>{availableBars} barra(s)</span>
                        <span className="block text-[10px] font-semibold text-slate-500">
                          {formatNumber(availableWeightKg, 0)} kg livres
                        </span>
                      </>
                    ) : (
                      "Não informado"
                    )}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-black ${available && coverage < 100 ? "text-red-600" : "text-emerald-600"}`}
                  >
                    {available ? `${formatNumber(coverage, 0)}%` : "—"}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-black ${balance < 0 ? "text-red-600" : "text-emerald-600"}`}
                  >
                    {available
                      ? `${balance >= 0 ? "+" : ""}${balance} barra(s)`
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-violet-700">
                    {formatNumber(row.endingBalanceKg)} kg
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Compact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[9px] font-bold uppercase text-slate-400">{label}</p>
      <p className="font-black text-slate-900">{value}</p>
    </div>
  );
}
