"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  simulateMachineLoad,
  type LoadOrderInput,
  type MachineLoadSettings,
  type ProductivitySource,
  type ResourceUnavailabilityInput,
  type WorkShiftInput,
} from "@/modules/planning/machine-load-simulator";
import { SIMULATION_MODEL_VERSION } from "@/modules/planning/simulation";
import {
  analyzePlanning,
  defaultIntelligenceWeights,
  type IntelligenceWeights,
  type PlanningAnalysis,
} from "@/modules/planning/planning-intelligence";
import { useCurrentUser } from "@/components/current-user-provider";

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
interface ProductionSettingsPayload {
  settings: RawSetting[];
  shifts: RawShift[];
}
interface RawCycleOrder {
  production_order_id: string;
  tool_heating_cycles: {
    status: string;
    expected_ready_at: string | null;
    released_at: string | null;
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
interface LoadedScenario {
  scenarioId: string;
  name: string;
  description: string | null;
  status: string;
  versionNumber: number;
  mode: "fifo" | "optimized" | "manual";
  requestedStartAt: string;
  inputs?: { selectedMachine?: string };
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
}
interface AiAnalysisEnvelope {
  result: AiPlanningAnalysis;
  modelUsed: string;
  usage: Record<string, unknown>;
  durationMs: number;
  createdAt: string;
  cached: boolean;
}
interface OpenRouterModelOption {
  id: string;
  name: string;
  contextLength: number | null;
  pricing: { prompt?: string; completion?: string } | null;
}

const defaultSettings: MachineLoadSettings = {
  billetBarWeightKg: 415,
  extrusionEfficiency: 0.85,
  defaultProductivityKgH: 1000,
  setupMinutes: 20,
  alloyChangeMinutes: 15,
  toolHeatingMinutes: 240,
  ovenCount: 3,
  ovenSlotsPerOven: 7,
  ovenSlots: 21,
};
const numberValue = (value: unknown) =>
  typeof value === "number"
    ? value
    : Number(
        String(value ?? "")
          .replace(/\./g, "")
          .replace(",", "."),
      ) || 0;
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
  return numberValue(
    parameters.target_productivity_kg_h ??
      parameters.productivity_kg_h ??
      parameters.produtividade_kg_h ??
      parameters.produtividade,
  );
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
) {
  return {
    generatedAt: generatedAt.toISOString(),
    mode,
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
      ovenDesign: "3 fornos × 7 vagas por prensa",
      conflicts: simulation.conflicts.map((item) => ({
        type: item.type,
        resource: item.resourceCode,
        machine: item.machineCode,
        tool: item.toolCode,
        delayMinutes: Math.round(item.delayMinutes),
        severity: item.severity,
      })),
    },
    deterministicRecommendations: analysis.recommendations.map((item) => ({
      priority: item.priority,
      category: item.category,
      title: item.title,
      reason: item.reason,
      action: item.action,
      toolCode: item.toolCode ?? null,
      machineCode: item.machineCode ?? null,
    })),
  };
}

export function MachineLoadSimulator() {
  const { role, machine_codes: userMachineCodes } = useCurrentUser();
  const canPlan = role === "admin" || role === "pcp";
  const allowedMachines = useMemo(
    () =>
      canPlan || !userMachineCodes?.length ? null : new Set(userMachineCodes),
    [canPlan, userMachineCodes],
  );
  const [orders, setOrders] = useState<LoadOrderInput[]>([]);
  const [settings, setSettings] = useState<Record<string, MachineLoadSettings>>(
    {},
  );
  const [shifts, setShifts] = useState<WorkShiftInput[]>([]);
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
  const [machine, setMachine] = useState("all");
  const [tab, setTab] = useState<"timeline" | "gantt" | "billets">("gantt");
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
        supabase
          .from("tools")
          .select(
            "code,matrix_code,productivity_kg_h,holes,bo,sequence_number,source_available,package_measure_mm,carcass_diameter_mm,carcass_code",
          )
          .eq("organization_id", organizationId)
          .order("matrix_code")
          .order("source_available", { ascending: false })
          .order("sequence_number"),
        supabase
          .from("tool_heating_cycle_orders")
          .select(
            "production_order_id,tool_heating_cycles!inner(status,expected_ready_at,released_at,organization_id)",
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
              defaultProductivityKgH: numberValue(
                row.default_productivity_kg_h,
              ),
              setupMinutes: row.setup_minutes,
              alloyChangeMinutes: row.alloy_change_minutes,
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
        const sheet = rawSheets.find(
          (item) =>
            item.tool_code.toUpperCase() === order.tool_code.toUpperCase() &&
            (!item.machine_code || item.machine_code === order.machine_code),
        );
        const tool = rawTools.find((item) =>
          [item.code, item.matrix_code]
            .filter(Boolean)
            .some(
              (code) => code!.toUpperCase() === order.tool_code.toUpperCase(),
            ),
        );
        const sheetExtrusion = nestedRecord(
          sheet?.parameters ?? null,
          "extrusion",
        );
        const sheetBillet = nestedRecord(sheet?.parameters ?? null, "billet");
        const sourceData = order.source_data ?? {};
        const learned = learningGroups
          .filter(
            (item) =>
              item.calibrated &&
              item.tool_code.toUpperCase() === order.tool_code.toUpperCase() &&
              item.machine_code === order.machine_code &&
              (!item.tool_sequence || item.tool_sequence === order.sequence),
          )
          .sort(
            (left, right) =>
              Number(right.tool_sequence === order.sequence) -
              Number(left.tool_sequence === order.sequence),
          )[0];
        const sources: Array<[number, ProductivitySource]> = [
          [
            numberValue(learned?.average_actual_productivity_kg_h),
            "aprendizado",
          ],
          [numberValue(order.last_productivity_kg_h), "simplificada"],
          [readSheetProductivity(sheet?.parameters ?? null), "ficha"],
          [numberValue(tool?.productivity_kg_h), "ferramenta"],
          [
            settingMap[order.machine_code]?.defaultProductivityKgH ?? 1000,
            "padrao",
          ],
        ];
        const productivity = sources.find(([value]) => value > 0) ?? [
          1000,
          "padrao" as const,
        ];
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
            (!item.sequenceNumber || item.sequenceNumber === order.sequence),
        );
        const mapping = matchingMappings.sort(
          (left, right) =>
            Number(right.sequenceNumber === order.sequence) -
              Number(left.sequenceNumber === order.sequence) ||
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
          productivityKgH: productivity[0] as number,
          productivitySource: productivity[1] as ProductivitySource,
          toolReadyAt,
          toolHeatingState,
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
          {
            carcasses: carcassResources.map((item) => ({
              code: item.carcassCode,
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
          },
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
    unavailability,
    carcassResources,
    boResources,
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
            orders: orderedVisibleOrders,
          },
          rulesSnapshot: {
            modelVersion: SIMULATION_MODEL_VERSION,
            settingsByMachine: settings,
            shifts,
            unavailability,
            billetStock: {
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
          analysisSnapshot: currentAnalysis ?? {},
        }),
      });
      const payload = (await response.json().catch(() => null)) as {
        id?: string;
        versionNumber?: number;
        error?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.error || "Não foi possível salvar o cenário.");
      setScenarioId(payload?.id ?? null);
      setScenarioNotice(
        `Cenário salvo com segurança como versão ${payload?.versionNumber ?? 1}.`,
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
        "Cenário aprovado e aplicado. A sequência e as reservas foram registradas na auditoria.",
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
      {historicalScenario ? (
        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-950">
          <FolderOpen className="size-5 text-blue-600" />
          <div className="min-w-0 flex-1">
            <strong className="block truncate">
              Histórico: {historicalScenario.name} · versão{" "}
              {historicalScenario.versionNumber}
            </strong>
            <span className="text-xs text-blue-700">
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
              Aprovar e aplicar
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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Metric
          icon={Boxes}
          label="Carga ativa"
          value={`${formatNumber(simulation.totalDemandKg, 0)} kg`}
        />
        <Metric
          icon={Gauge}
          label="Tempo teórico"
          value={formatDuration(simulation.totalTheoreticalMinutes)}
          tone="orange"
        />
        <Metric
          icon={CalendarClock}
          label="Término simulado"
          value={formatDateTime(estimatedEnd)}
          tone="blue"
        />
        <Metric
          icon={PackageOpen}
          label="Barras a preparar"
          value={`${simulation.totalBars}`}
          tone="violet"
        />
        <Metric
          icon={Route}
          label="Itens na sequência"
          value={`${simulation.machines.reduce((sum, item) => sum + item.items.length, 0)}`}
          tone="green"
        />
      </section>
      {planningAnalysis ? (
        <PlanningIntelligencePanel
          analysis={planningAnalysis}
          weights={intelligence.settings}
          canEdit={canPlan && !historicalScenario}
          aiConfigured={Boolean(intelligence.aiConfigured)}
          aiAnalysis={aiAnalysis}
          aiBusy={aiBusy}
          aiError={aiError}
          onAnalyze={() => void requestAiAnalysis()}
          onApplyAiScenario={applyAiScenario}
          orderLabels={Object.fromEntries(
            simulation.machines.flatMap((machine) =>
              machine.items.map((item) => [item.id, item.toolCode]),
            ),
          )}
          onSave={saveIntelligenceWeights}
        />
      ) : null}
      <PlanningLearningPanel data={intelligence} />
      <ThermalCoveragePanel machines={simulation.machines} />
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
          quantidade de vagas seguem a configuração de cada prensa. Ferramentas,
          carcaças e BOs compartilhados são protegidos contra uso simultâneo; a
          aprovação só ocorre com estoque físico suficiente.
        </p>
      </div>
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
  aiAnalysis,
  aiBusy,
  aiError,
  onAnalyze,
  onApplyAiScenario,
  orderLabels,
  onSave,
}: {
  analysis: PlanningAnalysis;
  weights: IntelligenceWeights;
  canEdit: boolean;
  aiConfigured: boolean;
  aiAnalysis: AiAnalysisEnvelope | null;
  aiBusy: boolean;
  aiError: string;
  onAnalyze: () => void;
  onApplyAiScenario: () => void;
  orderLabels: Record<string, string>;
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
              setSavedSignature(null);
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
                        <b>Por quê:</b>{" "}
                        {group.items.length > 1
                          ? `${group.items.length} situações do mesmo tipo foram reunidas para facilitar a leitura.`
                          : item.reason}
                      </p>
                      <p className="mt-1">
                        <b>Impacto:</b> {item.impact}
                      </p>
                      <p className="mt-1 font-semibold text-slate-800">
                        <b>Ação:</b> {item.action}
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
      <AiDecisionPanel
        configured={aiConfigured}
        enabled={weights.aiEnabled}
        analysis={aiAnalysis}
        busy={aiBusy}
        error={aiError}
        onAnalyze={onAnalyze}
        onApplyScenario={onApplyAiScenario}
        orderLabels={orderLabels}
      />
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
              <button type="button" onClick={() => setEditing(false)}>
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
              <Button variant="outline" onClick={() => setEditing(false)}>
                {savedAt ? "Fechar" : "Cancelar"}
              </Button>
              <Button
                disabled={
                  busy ||
                  total !== 100 ||
                  (draft.aiModelMode === "manual" &&
                    (!draft.aiModel || draft.aiModel === "openrouter/auto"))
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
  onAnalyze,
  onApplyScenario,
  orderLabels,
}: {
  configured: boolean;
  enabled: boolean;
  analysis: AiAnalysisEnvelope | null;
  busy: boolean;
  error: string;
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
  return (
    <div className="border-t bg-gradient-to-r from-violet-50/80 via-white to-blue-50/70 p-5">
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
            Interpreta somente o pacote compacto da simulação; regras físicas e
            bloqueios continuam soberanos.
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
          Integração preparada, mas sem chave segura no servidor. Gere uma nova
          chave e configure <code>OPENROUTER_API_KEY</code>.
        </p>
      ) : !enabled ? (
        <p className="mt-3 rounded-xl border bg-white p-3 text-xs text-slate-600">
          Ative a IA em “Ajustar critérios” para liberar esta análise.
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">
          {error}
        </p>
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
                Confiança calculada: {Math.round(analysis.result.confidence)}% ·{" "}
                modelo {analysis.modelUsed} ·{" "}
                {(analysis.durationMs / 1000).toLocaleString("pt-BR", {
                  maximumFractionDigits: 1,
                })}
                s{analysis.cached ? " · resultado reaproveitado" : ""}
              </p>
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
                  className="shrink-0 bg-violet-600 text-white hover:bg-violet-700"
                >
                  <Sparkles className="size-4" />
                  Testar esta sequência
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
                Este botão não inicia nem aprova a produção. Ele apenas coloca a
                sequência na simulação para você conferir e ajustar.
              </p>
            </article>
            {analysis.result.recommendations.map((item, index) => (
              <details
                key={`${item.title}-${index}`}
                open={index < 2}
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

function PlanningLearningPanel({ data }: { data: IntelligencePayload }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
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
            {data.summary.observations} execução(ões) aprendidas · confiança{" "}
            {formatNumber(data.summary.confidencePercent, 0)}%
          </h2>
          <p className="text-xs text-slate-500">
            {data.summary.predictionsCompared} comparação(ões) previsão ×
            realizado · erro médio{" "}
            {formatNumber(data.summary.meanAbsoluteErrorPercent, 1)}%
          </p>
        </div>
        <span className="text-xs font-bold text-slate-500">
          {expanded ? "Recolher" : "Ver calibração"}
        </span>
      </button>
      {expanded ? (
        <div className="border-t">
          <div className="grid gap-3 p-5 sm:grid-cols-3">
            <LearningMetric
              label="Base de aprendizado"
              value={`${data.summary.observations} execuções`}
            />
            <LearningMetric
              label="Previsões comparadas"
              value={`${data.summary.predictionsCompared}`}
            />
            <LearningMetric
              label="Erro absoluto médio"
              value={`${formatNumber(data.summary.meanAbsoluteErrorPercent, 1)}%`}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[800px] text-sm">
              <thead className="bg-slate-50 text-left text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">Ferramenta / setup</th>
                  <th>Prensa</th>
                  <th>Amostras</th>
                  <th>Prod. realizada média</th>
                  <th>Erro médio</th>
                  <th>Confiança</th>
                  <th>Status</th>
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
                      {group.average_actual_productivity_kg_h
                        ? `${formatNumber(group.average_actual_productivity_kg_h, 0)} kg/h`
                        : "—"}
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
                        {formatNumber(group.confidence_percent, 0)}%
                      </span>
                    </td>
                    <td>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${group.calibrated ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                      >
                        {group.calibrated ? "Calibrado" : "Coletando"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!data.groups.length ? (
              <div className="grid h-32 place-items-center text-sm text-slate-400">
                Conclua produções para iniciar o aprendizado.
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
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  tone?: "slate" | "orange" | "blue" | "violet" | "green";
}) {
  const colors = {
    slate: "bg-slate-100 text-slate-700",
    orange: "bg-orange-50 text-orange-600",
    blue: "bg-blue-50 text-blue-600",
    violet: "bg-violet-50 text-violet-600",
    green: "bg-emerald-50 text-emerald-600",
  };
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm">
      <span
        className={`grid size-10 place-items-center rounded-xl ${colors[tone]}`}
      >
        <Icon className="size-5" />
      </span>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
          {label}
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
          <div className="mb-3 flex items-center justify-between">
            <div>
              <strong>{machineLabel(machine.machineCode)}</strong>
              <span className="ml-2 text-xs text-slate-500">
                {machine.items.length} item(ns) · inicia{" "}
                {formatDateTime(machine.startsAt)} · termina{" "}
                {formatDateTime(machine.endsAt)}
              </span>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
              realista {formatDuration(machine.simulatedMinutes)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1640px] text-left text-xs">
              <thead className="bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2"># / Ferramenta</th>
                  <th className="px-3 py-2">Recursos</th>
                  <th className="px-3 py-2">Plano</th>
                  <th className="px-3 py-2">Pedido / ordem</th>
                  <th className="px-3 py-2">
                    Qtd. pedida
                    <br />
                    <span className="normal-case text-slate-400">líquido</span>
                  </th>
                  <th className="px-3 py-2">Saldo do pedido</th>
                  <th className="px-3 py-2">
                    Bruto necessário
                    <br />
                    <span className="normal-case text-slate-400">
                      com eficiência
                    </span>
                  </th>
                  <th className="px-3 py-2">Preparação</th>
                  <th className="px-3 py-2">Início</th>
                  <th className="px-3 py-2">Duração</th>
                  <th className="px-3 py-2">Fim</th>
                  <th className="px-3 py-2">Produtividade</th>
                  <th className="px-3 py-2">Liga / barras</th>
                  <th className="px-3 py-2">Saldo projetado da liga</th>
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
                    <td className="px-3 py-2.5">
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
                    </td>
                    <td className="px-3 py-2.5">
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
                        <ResourceChip
                          label="Ø"
                          value={
                            item.carcassDiameterMm
                              ? `${item.carcassDiameterMm} mm`
                              : "—"
                          }
                          missing={!item.carcassDiameterMm}
                        />
                        <ResourceChip
                          label="Pacote"
                          value={
                            item.packageMeasureMm
                              ? `${item.packageMeasureMm} mm`
                              : "—"
                          }
                          missing={!item.packageMeasureMm}
                        />
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-bold">{item.planCode}</td>
                    <td className="px-3 py-2.5 font-mono font-bold text-slate-700">
                      {item.orderNumber}
                    </td>
                    <td className="px-3 py-2.5 font-bold tabular-nums">
                      {formatNumber(item.targetKg)} kg
                    </td>
                    <td className="px-3 py-2.5 font-bold tabular-nums text-blue-700">
                      {formatNumber(item.remainingKg)} kg
                    </td>
                    <td className="px-3 py-2.5">
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
                    <td className="px-3 py-2.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold ${item.thermalWaitMinutes > 0.5 ? "bg-red-100 text-red-700" : item.toolHeatingState === "released" ? "bg-emerald-50 text-emerald-700" : item.toolHeatingState === "heating" ? "bg-orange-50 text-orange-700" : "bg-amber-50 text-amber-700"}`}
                      >
                        <Flame className="size-3" />
                        {item.thermalWaitMinutes > 0.5
                          ? `Espera ${formatDuration(item.thermalWaitMinutes)}`
                          : item.toolHeatingState === "released"
                            ? "Liberada"
                            : item.toolHeatingState === "heating"
                              ? "Aquecendo"
                              : "Simulada 4h"}
                      </span>
                      {item.ovenSlotNumber &&
                        item.toolHeatingState !== "released" && (
                          <span className="mt-1 block text-[9px] text-slate-400">
                            Vaga {item.ovenSlotNumber} · entrar até{" "}
                            {formatDateTime(item.latestHeatingStartAt)}
                          </span>
                        )}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {formatDateTime(item.extrusionStartAt)}
                    </td>
                    <td className="px-3 py-2.5 font-bold tabular-nums">
                      {formatDuration(item.theoreticalMinutes)}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">
                      {formatDateTime(item.endAt)}
                    </td>
                    <td className="px-3 py-2.5">
                      <strong>
                        {formatNumber(item.productivityKgH, 0)} kg/h
                      </strong>
                      <span className="block text-[9px] text-slate-400">
                        {sourceLabel[item.productivitySource]}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <strong>{item.selectedAlloy}</strong>
                      <span className="block text-[10px] text-slate-400">
                        +{item.billetBarsLoaded} barra(s)
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
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
