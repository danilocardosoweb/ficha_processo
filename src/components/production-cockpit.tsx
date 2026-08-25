"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CircleStop,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  Factory,
  FileClock,
  Flame,
  Gauge,
  History,
  Loader2,
  LockKeyhole,
  Minus,
  PencilLine,
  Play,
  Plus,
  RotateCcw,
  RefreshCw,
  Save,
  Search,
  SquareCheckBig,
  Target,
  Thermometer,
  Timer,
  Wrench,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoolingModeSelect } from "@/components/cooling-mode-select";
import { Input } from "@/components/ui/input";
import { createClient, withSupabaseTimeout } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/current-user-provider";
import {
  getOfflineSnapshot,
  normalizeCode,
  requestOfflineSync,
} from "@/lib/offline-store";

type Parameters = {
  notes?: string;
  extrusion?: {
    profile_linear_weight_kg_m?: number;
    total_linear_weight_kg_m?: number;
    holes?: number;
    cuts_per_pull?: number;
    cut_length_mm?: number;
    cut_length_m?: number;
    discard_mm?: number;
    discard_m?: number;
    ram_speed_mm_s?: number;
    initial_pressure?: number;
    target_productivity_kg_h?: number;
  };
  temperatures?: {
    zone_1_c?: number;
    zone_2_c?: number;
    zone_3_c?: number;
    zone_4_c?: number;
    billet_c?: number;
    container_c?: number;
    die_c?: number;
    exit_min_c?: number;
    exit_max_c?: number;
  };
  billet?: {
    casing?: string;
    linear_weight_kg_m?: number;
    nominal_weight_kg_m?: number;
    loss_factor?: number;
    operational_margin?: number;
    calculated_length_mm?: number;
    calculated_pull_mm?: number;
    calculated_pull_m?: number;
    butt_mm?: number;
  };
  pulling?: {
    puller_left_s?: number;
    puller_right_s?: number;
    calculated_pull_m?: number;
  };
  cooling?: { mode?: string };
  saw?: { mode?: string; raw_value?: string; piece_length_mm?: number };
};
type ProcessSheet = {
  id: string;
  machine_code: string | null;
  tool_code: string;
  product_code: string | null;
  alloy_code: string;
  temper: string | null;
  revision: number;
  tool_sequence: number | null;
  parameters: Parameters;
  is_active: boolean;
  updated_at?: string;
  last_changed_by_name?: string | null;
  last_change_reason?: string | null;
};
type SheetHistory = {
  id: number;
  changed_by_name: string;
  change_reason: string;
  changed_at: string;
  previous_parameters: Parameters;
  new_parameters: Parameters;
};
type CatalogOption = {
  id: string;
  parent_id?: string | null;
  catalog_type: string;
  code: string;
  label: string;
  group_code: string | null;
  responsible_department: string | null;
  routes_to_maintenance: boolean;
  sort_order: number;
  metadata: { internal_category?: string };
  is_active: boolean;
};
type Unit = "kg" | "pieces" | "bars";
type Order = {
  id: string;
  import_batch_id: string | null;
  order_number: string;
  plan_code: string | null;
  machine_code: string;
  tool_code: string;
  product_code: string | null;
  customer_name: string | null;
  alloy_code: string;
  temper: string | null;
  target_kg: number | null;
  target_quantity: number | null;
  demand_unit: Unit;
  is_active: boolean;
  produced_kg: number;
  produced_quantity: number;
  status: string;
  sequence: number;
  actual_start: string | null;
  actual_end: string | null;
  started_by_name: string | null;
  completed_by_name: string | null;
  reopened_at: string | null;
  reopened_by_name: string | null;
  reprogram_count: number;
  due_date: string | null;
};
type PlanHeatingLocation = {
  id: string;
  machine_code: string;
  tool_code: string;
  oven_code: string | null;
  oven_position: number | null;
  status: "heating" | "released";
  expected_ready_at: string;
  tool_heating_cycle_orders: { production_order_id: string }[];
};
const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;

const numeric = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;
const format = (value: number, decimals = 0) =>
  value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
const unitLabel = (unit: Unit) =>
  unit === "kg" ? "kg" : unit === "bars" ? "barras" : "peças";
const cutLengthMm = (sheet?: ProcessSheet) =>
  numeric(sheet?.parameters.extrusion?.cut_length_mm) ||
  numeric(sheet?.parameters.saw?.piece_length_mm) ||
  numeric(sheet?.parameters.extrusion?.cut_length_m) * 1000;
const discardMm = (sheet?: ProcessSheet) =>
  numeric(sheet?.parameters.extrusion?.discard_mm) ||
  numeric(sheet?.parameters.extrusion?.discard_m) * 1000;
const orderFields =
  "id,import_batch_id,order_number,plan_code,machine_code,tool_code,product_code,customer_name,alloy_code,temper,target_kg,target_quantity,demand_unit,is_active,produced_kg,produced_quantity,status,sequence,actual_start,actual_end,started_by_name,completed_by_name,reopened_at,reopened_by_name,reprogram_count,due_date";

const displayDueDate = (value: string | null) => {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
};
const displayClock = (value: string) =>
  new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
function ordersForSheet(source: Order[], sheet: ProcessSheet) {
  const sheetCodes = [sheet.product_code, sheet.tool_code]
    .filter(Boolean)
    .map((value) => normalizeCode(String(value)));
  return source.filter(
    (order) =>
      order.machine_code === sheet.machine_code &&
      [order.tool_code, order.product_code]
        .filter(Boolean)
        .some((value) => sheetCodes.includes(normalizeCode(String(value)))),
  );
}

function engineering(sheet?: ProcessSheet) {
  const extrusion = sheet?.parameters.extrusion;
  const billet = sheet?.parameters.billet;
  const profileLinear = numeric(extrusion?.profile_linear_weight_kg_m);
  const holes = Math.max(1, Math.trunc(numeric(extrusion?.holes, 1)));
  const cuts = Math.max(1, Math.trunc(numeric(extrusion?.cuts_per_pull, 1)));
  const cutMm = cutLengthMm(sheet);
  const totalLinear =
    numeric(extrusion?.total_linear_weight_kg_m) || profileLinear * holes;
  const weightPerPiece = (profileLinear * cutMm) / 1000;
  const piecesPerBillet = holes * cuts;
  const kgPerBillet = weightPerPiece * piecesPerBillet;
  const billetLinear = numeric(billet?.linear_weight_kg_m, 67.2);
  const billetNominal = numeric(billet?.nominal_weight_kg_m, 69.92);
  const loss = numeric(billet?.loss_factor, 0.063);
  const margin = numeric(billet?.operational_margin, 0.07);
  const requiredWeight =
    totalLinear * ((cuts * cutMm + discardMm(sheet)) / 1000);
  const calculatedBilletMm =
    billetLinear > 0
      ? (requiredWeight / billetLinear) * (1 + margin) * 1000
      : 0;
  const billetMm = numeric(billet?.calculated_length_mm) || calculatedBilletMm;
  const calculatedPullMm =
    totalLinear > 0
      ? (billetMm * billetLinear - billetMm * billetNominal * loss) /
        totalLinear
      : 0;
  const pullMm =
    numeric(billet?.calculated_pull_mm) ||
    numeric(billet?.calculated_pull_m) * 1000 ||
    numeric(sheet?.parameters.pulling?.calculated_pull_m) * 1000 ||
    calculatedPullMm;
  return {
    profileLinear,
    holes,
    cuts,
    cutMm,
    totalLinear,
    weightPerPiece,
    piecesPerBillet,
    kgPerBillet,
    billetMm,
    pullMm,
    discardMm: discardMm(sheet),
  };
}

function calculate(
  sheet: ProcessSheet | undefined,
  unit: Unit,
  target: number,
  manualBillets?: number,
) {
  const e = engineering(sheet);
  const step = unit === "kg" ? e.kgPerBillet : e.piecesPerBillet;
  const minimum = unit === "kg" ? target * 0.9 : target;
  const maximum = unit === "kg" ? target * 1.1 : target;
  const lower = step > 0 ? Math.max(0, Math.floor(target / step)) : 0;
  const upper = step > 0 ? Math.max(1, Math.ceil(target / step)) : 0;
  const ideal =
    unit === "kg"
      ? ([lower, upper]
          .filter((value) => value * step <= maximum)
          .sort(
            (a, b) => Math.abs(a * step - target) - Math.abs(b * step - target),
          )[0] ?? lower)
      : Math.abs(lower * step - target) <= Math.abs(upper * step - target) * 0.6
        ? lower
        : upper;
  const minBillets = step > 0 ? Math.ceil(minimum / step) : 0;
  const maxBillets =
    unit === "kg" && step > 0 ? Math.floor(maximum / step) : upper;
  const billets = manualBillets ?? ideal;
  const pieces = billets * e.piecesPerBillet;
  const kg = billets * e.kgPerBillet;
  const output = unit === "kg" ? kg : pieces;
  const difference = output - target;
  const status =
    target <= 0 || step <= 0
      ? "empty"
      : output < minimum
        ? "below"
        : output > maximum
          ? "excess"
          : Math.abs(difference) < 0.001
            ? "target"
            : "acceptable";
  return {
    e,
    minimum,
    maximum,
    minBillets,
    ideal,
    maxBillets,
    billets,
    pieces,
    kg,
    output,
    difference,
    status,
    lower,
    upper,
    lowerOutput: lower * step,
    upperOutput: upper * step,
  };
}

export function ProductionCockpit() {
  const { display_name: operatorName } = useCurrentUser();
  const [toolInput, setToolInput] = useState("");
  const [sheets, setSheets] = useState<ProcessSheet[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [completedOrders, setCompletedOrders] = useState<Order[]>([]);
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [planSearchOpen, setPlanSearchOpen] = useState(false);
  const [planSearchQuery, setPlanSearchQuery] = useState("");
  const [planSearchResults, setPlanSearchResults] = useState<Order[]>([]);
  const [planHeatingLocations, setPlanHeatingLocations] = useState<PlanHeatingLocation[]>([]);
  const [planSearchSelection, setPlanSearchSelection] = useState<string[]>([]);
  const [planSearchLoading, setPlanSearchLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sheetEditorOpen, setSheetEditorOpen] = useState(false);
  const [sheetHistoryOpen, setSheetHistoryOpen] = useState(false);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [stoppageOpen, setStoppageOpen] = useState(false);
  const [unit, setUnit] = useState<Unit>("kg");
  const [requested, setRequested] = useState(0);
  const [manualBillets, setManualBillets] = useState<number | undefined>();
  const [loading, setLoading] = useState(false);
  const [savingStatus, setSavingStatus] = useState(false);
  const [message, setMessage] = useState("");
  const selected = useMemo(
    () => sheets.find((sheet) => sheet.id === selectedId),
    [sheets, selectedId],
  );
  const chosen = useMemo(
    () => orders.filter((order) => selectedOrders.includes(order.id)),
    [orders, selectedOrders],
  );
  const result = useMemo(
    () => calculate(selected, unit, requested, manualBillets),
    [selected, unit, requested, manualBillets],
  );
  const visiblePlanSearchResults = useMemo(() => {
    const search = normalizeCode(planSearchQuery.trim());
    if (!search) return planSearchResults;
    return planSearchResults.filter((order) =>
      normalizeCode(
        `${order.tool_code} ${order.product_code ?? ""} ${order.plan_code ?? ""} ${order.customer_name ?? ""} ${order.order_number} ${order.machine_code}`,
      ).includes(search),
    );
  }, [planSearchQuery, planSearchResults]);

  const applyOrders = useCallback(
    (ids: string[], source = orders) => {
      const picked = source.filter((order) => ids.includes(order.id));
      setSelectedOrders(ids);
      if (!picked.length) return;
      const nextUnit = picked.every(
        (order) => order.demand_unit === picked[0].demand_unit,
      )
        ? picked[0].demand_unit
        : "kg";
      setUnit(nextUnit);
      setRequested(
        picked.reduce(
          (sum, order) =>
            sum +
            (nextUnit === "kg"
              ? numeric(order.target_kg)
              : numeric(order.target_quantity)),
          0,
        ),
      );
      setManualBillets(undefined);
    },
    [orders],
  );

  const findSheets = useCallback(
    async (
      tool?: string,
      cut?: string,
      machine?: string,
      preselectedOrderIds?: string[],
    ) => {
      const raw = (tool ?? toolInput).trim();
      const search = normalizeCode(raw);
      if (!organizationId || !search) {
        setMessage("Informe a ferramenta para localizar a ficha.");
        return;
      }
      setLoading(true);
      setMessage("");
      try {
        const supabase = createClient();
        const [
          { data, error: sheetError },
          { data: orderData, error: orderError },
          { data: completedData, error: completedError },
        ] = await Promise.all([
          withSupabaseTimeout(
            supabase
              .from("process_sheets")
              .select(
                "id,machine_code,tool_code,product_code,alloy_code,temper,revision,tool_sequence,parameters,is_active,updated_at,last_changed_by_name,last_change_reason",
              )
              .eq("organization_id", organizationId)
              .eq("is_active", true)
              .neq("tool_search", "")
              .ilike("tool_search", `%${search}%`)
              .order("product_code")
              .order("machine_code")
              .limit(250),
          ),
          withSupabaseTimeout(
            supabase
              .from("production_orders")
              .select(orderFields)
              .eq("organization_id", organizationId)
              .eq("is_active", true)
              .in("status", ["planned", "released", "in_progress", "paused"])
              .order("sequence")
              .limit(500),
          ),
          withSupabaseTimeout(
            supabase
              .from("production_orders")
              .select(orderFields)
              .eq("organization_id", organizationId)
              .eq("status", "completed")
              .order("actual_end", { ascending: false })
              .limit(100),
          ),
        ]);
        if (sheetError) throw sheetError;
        if (orderError) throw orderError;
        if (completedError) throw completedError;
        const found = (data ?? []) as ProcessSheet[];
        const activeOrders = ((orderData ?? []) as Order[]).filter((order) =>
          normalizeCode(
            `${order.tool_code} ${order.product_code ?? ""}`,
          ).includes(search),
        );
        setSheets(found);
        setOrders(activeOrders);
        setCompletedOrders(
          ((completedData ?? []) as Order[]).filter((order) =>
            normalizeCode(
              `${order.tool_code} ${order.product_code ?? ""}`,
            ).includes(search),
          ),
        );
        if (!found.length) {
          setSelectedId("");
          setMessage("Nenhuma ficha ativa encontrada para esta ferramenta.");
          return;
        }
        const desiredCut = Number(cut);
        const match =
          found.find(
            (sheet) =>
              (!desiredCut || cutLengthMm(sheet) === desiredCut) &&
              (!machine || sheet.machine_code === machine),
          ) ?? found[0];
        setSelectedId(match.id);
        setToolInput(match.product_code || match.tool_code);
        const matchingOrders = ordersForSheet(activeOrders, match);
        const compatibleSelection = (preselectedOrderIds ?? []).filter((id) =>
          matchingOrders.some((order) => order.id === id),
        );
        if (compatibleSelection.length)
          applyOrders(compatibleSelection, activeOrders);
        else if (matchingOrders.length)
          applyOrders([matchingOrders[0].id], activeOrders);
        else {
          setSelectedOrders([]);
          setRequested(0);
          setMessage(
            "Ficha localizada, mas não há item disponível desta Ferramenta + Corte na Simplificada ativa.",
          );
        }
      } catch {
        const [sheetCache, orderCache] = await Promise.all([
          getOfflineSnapshot<ProcessSheet>("process_sheets"),
          getOfflineSnapshot<Order>("production_orders"),
        ]);
        const found = (sheetCache?.rows ?? []).filter(
          (sheet) =>
            sheet.is_active &&
            normalizeCode(sheet.product_code || sheet.tool_code).includes(
              search,
            ),
        );
        const activeOrders = (orderCache?.rows ?? []).filter(
          (order) =>
            order.is_active !== false &&
            normalizeCode(
              `${order.tool_code} ${order.product_code ?? ""}`,
            ).includes(search),
        );
        setSheets(found);
        setOrders(activeOrders);
        if (found.length) {
          setSelectedId(found[0].id);
          setToolInput(found[0].product_code || found[0].tool_code);
          setMessage(
            "Modo offline: receita e programação carregadas da cópia local.",
          );
        } else
          setMessage(
            "Nenhuma ficha local encontrada. Conecte este computador para sincronizar os dados.",
          );
      } finally {
        setLoading(false);
      }
    },
    [applyOrders, toolInput],
  );

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const tool = query.get("tool");
    if (tool) {
      const cut = query.get("cut") ?? undefined;
      const machine = query.get("machine") ?? undefined;
      const preselectedOrderIds = (query.get("orders") ?? "").split(",").filter(Boolean);
      queueMicrotask(() => {
        setToolInput(tool);
        void findSheets(tool, cut, machine, preselectedOrderIds);
      });
    }
    // Initial URL routing only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleOrder(id: string) {
    applyOrders(
      selectedOrders.includes(id)
        ? selectedOrders.filter((value) => value !== id)
        : [...selectedOrders, id],
    );
  }

  async function loadActivePlans() {
    if (!organizationId) return;
    setPlanSearchLoading(true);
    setMessage("");
    try {
      const supabase = createClient();
      const [orderResponse, heatingResponse] = await Promise.all([
        withSupabaseTimeout(
          supabase
            .from("production_orders")
            .select(`${orderFields},simplified_imports!inner(id,is_active,status,deleted_at)`)
            .eq("organization_id", organizationId)
            .eq("is_active", true)
            .in("status", ["planned", "released", "in_progress", "paused"])
            .eq("simplified_imports.is_active", true)
            .eq("simplified_imports.status", "processed")
            .is("simplified_imports.deleted_at", null)
            .order("due_date", { ascending: true, nullsFirst: false })
            .order("sequence")
            .limit(1000),
        ),
        withSupabaseTimeout(
          supabase
            .from("tool_heating_cycles")
            .select("id,machine_code,tool_code,oven_code,oven_position,status,expected_ready_at,tool_heating_cycle_orders(production_order_id)")
            .eq("organization_id", organizationId)
            .in("status", ["heating", "released"])
            .order("entered_at", { ascending: false })
            .limit(300),
        ),
      ]);
      if (orderResponse.error) throw orderResponse.error;
      if (heatingResponse.error) throw heatingResponse.error;
      setPlanSearchResults((orderResponse.data ?? []) as unknown as Order[]);
      setPlanHeatingLocations((heatingResponse.data ?? []) as unknown as PlanHeatingLocation[]);
    } catch {
      const [orderCache, heatingCache] = await Promise.all([
        getOfflineSnapshot<Order>("production_orders"),
        getOfflineSnapshot<PlanHeatingLocation>("tool_heating_cycles"),
      ]);
      const matches = (orderCache?.rows ?? []).filter(
        (order) =>
          order.is_active !== false &&
          ["planned", "released", "in_progress", "paused"].includes(order.status),
      );
      setPlanSearchResults(matches);
      setPlanHeatingLocations((heatingCache?.rows ?? []).filter((cycle) => ["heating", "released"].includes(cycle.status)));
      setMessage(
        "Modo offline: Planos e posições de forno carregados da última cópia local sincronizada.",
      );
    } finally {
      setPlanSearchLoading(false);
    }
  }

  function openPlanExplorer() {
    setPlanSearchOpen(true);
    setPlanSearchQuery("");
    setPlanSearchSelection([]);
    void loadActivePlans();
  }

  function togglePlanSearchOrder(id: string) {
    const order = planSearchResults.find((item) => item.id === id);
    if (!order) return;
    if (order.status === "in_progress") {
      setMessage(
        `A ordem ${order.order_number} já está em produção e não pode entrar em uma nova campanha.`,
      );
      return;
    }
    if (planSearchSelection.includes(id)) {
      setPlanSearchSelection((current) =>
        current.filter((value) => value !== id),
      );
      return;
    }
    const selectedItems = planSearchResults.filter((item) =>
      planSearchSelection.includes(item.id),
    );
    const incompatible = selectedItems.some(
      (item) =>
        item.machine_code !== order.machine_code ||
        normalizeCode(item.tool_code) !== normalizeCode(order.tool_code),
    );
    if (incompatible) {
      setMessage(
        "Uma campanha deve usar a mesma ferramenta e a mesma prensa. Finalize a seleção atual ou escolha itens compatíveis.",
      );
      return;
    }
    setPlanSearchSelection((current) => [...current, id]);
  }

  function selectPlanSearchOrders(ids: string[]) {
    const candidates = planSearchResults.filter(
      (order) => ids.includes(order.id) && order.status !== "in_progress",
    );
    const current = planSearchResults.filter((order) =>
      planSearchSelection.includes(order.id),
    );
    const reference = current[0] ?? candidates[0];
    if (!reference) return;
    const compatible = candidates.filter(
      (order) =>
        order.machine_code === reference.machine_code &&
        normalizeCode(order.tool_code) === normalizeCode(reference.tool_code),
    );
    setPlanSearchSelection((selectedIds) => [
      ...new Set([...selectedIds, ...compatible.map((order) => order.id)]),
    ]);
    if (compatible.length !== candidates.length)
      setMessage(
        "Somente os itens da mesma ferramenta e prensa foram selecionados para a campanha.",
      );
  }

  async function loadPlanCampaign() {
    const picked = planSearchResults.filter((order) =>
      planSearchSelection.includes(order.id),
    );
    if (!picked.length) return;
    const reference = picked[0];
    setPlanSearchOpen(false);
    setToolInput(reference.tool_code);
    await findSheets(
      reference.tool_code,
      undefined,
      reference.machine_code,
      picked.map((order) => order.id),
    );
    setMessage(
      `${picked.length} item(ns) de ${new Set(picked.map((order) => order.plan_code)).size} Plano(s) carregado(s) na campanha.`,
    );
  }
  function chooseSheet(id: string) {
    setSelectedId(id);
    setManualBillets(undefined);
    const sheet = sheets.find((item) => item.id === id);
    if (!sheet) return;
    const matching = ordersForSheet(orders, sheet);
    if (matching.length) {
      applyOrders([matching[0].id]);
      setMessage(
        matching.length > 1
          ? `${matching.length} itens disponíveis para esta Ferramenta + Corte. O primeiro foi selecionado automaticamente.`
          : "Programação localizada automaticamente na Simplificada ativa.",
      );
    } else {
      setSelectedOrders([]);
      setRequested(0);
      setMessage(
        "Não existe item disponível desta Ferramenta + Corte na Simplificada ativa.",
      );
    }
  }

  async function startProduction() {
    if (!chosen.length) {
      setMessage("Selecione ao menos um item para iniciar a produção.");
      return;
    }
    setSavingStatus(true);
    setMessage("");
    try {
      const supabase = createClient();
      const ids = chosen.map((order) => order.id);
      const { data, error } = await supabase
        .from("production_orders")
        .update({
          status: "in_progress",
          started_by_name: operatorName,
          last_status_reason: `Produção iniciada por ${operatorName}`,
        })
        .in("id", ids)
        .eq("is_active", true)
        .in("status", ["planned", "released", "paused"])
        .select(orderFields);
      if (error) throw error;
      if (!data || data.length !== ids.length)
        throw new Error(
          "Um dos itens já foi iniciado, concluído ou retirado da programação. Atualize a busca antes de continuar.",
        );
      const updated = data as Order[];
      setOrders((current) =>
        current.map(
          (order) => updated.find((item) => item.id === order.id) ?? order,
        ),
      );
      setMessage(
        `${updated.length === 1 ? `Produção ${updated[0].order_number}` : `Campanha com ${updated.length} itens`} iniciada por ${operatorName}.`,
      );
      requestOfflineSync();
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setSavingStatus(false);
    }
  }

  async function completeProduction(
    producedKg: number,
    producedQuantity: number,
    notes: string,
  ) {
    if (!chosen.length) {
      setMessage("Selecione ao menos um item para concluir.");
      return;
    }
    setSavingStatus(true);
    setMessage("");
    try {
      const supabase = createClient();
      const totalTargetKg = chosen.reduce(
        (sum, order) => sum + numeric(order.target_kg),
        0,
      );
      const totalTargetPieces = chosen.reduce(
        (sum, order) => sum + numeric(order.target_quantity),
        0,
      );
      let allocatedKg = 0;
      let allocatedPieces = 0;
      const completed: Order[] = [];
      for (const [index, order] of chosen.entries()) {
        const last = index === chosen.length - 1;
        const orderKg = last
          ? producedKg - allocatedKg
          : totalTargetKg > 0
            ? Number(
                (
                  (producedKg * numeric(order.target_kg)) /
                  totalTargetKg
                ).toFixed(3),
              )
            : 0;
        const orderPieces = last
          ? producedQuantity - allocatedPieces
          : totalTargetPieces > 0
            ? Math.round(
                (producedQuantity * numeric(order.target_quantity)) /
                  totalTargetPieces,
              )
            : 0;
        allocatedKg += orderKg;
        allocatedPieces += orderPieces;
        const { data, error } = await supabase
          .from("production_orders")
          .update({
            status: "completed",
            produced_kg: Math.max(0, Number(orderKg.toFixed(3))),
            produced_quantity: Math.max(0, Math.round(orderPieces)),
            completed_by_name: operatorName,
            actual_end: new Date().toISOString(),
            last_status_reason: [
              `Produção concluída por ${operatorName}`,
              chosen.length > 1
                ? `Campanha conjunta com ${chosen.length} itens; resultado distribuído proporcionalmente à demanda`
                : "",
              notes.trim(),
            ]
              .filter(Boolean)
              .join(" · "),
          })
          .eq("id", order.id)
          .eq("status", "in_progress")
          .select(orderFields)
          .maybeSingle();
        if (error) throw error;
        if (!data)
          throw new Error(
            `A ordem ${order.order_number} não está em produção ou já foi concluída.`,
          );
        completed.push(data as Order);
      }
      const completedIds = new Set(completed.map((order) => order.id));
      setOrders((current) =>
        current.filter((order) => !completedIds.has(order.id)),
      );
      setCompletedOrders((current) => [
        ...completed,
        ...current.filter((order) => !completedIds.has(order.id)),
      ]);
      setSelectedOrders([]);
      setRequested(0);
      setManualBillets(undefined);
      setCompletionOpen(false);
      setMessage(
        `${completed.length === 1 ? `Item ${completed[0].order_number}` : `Campanha com ${completed.length} itens`} concluído(a) e removido(a) da fila. O histórico de cada Plano foi preservado.`,
      );
      requestOfflineSync();
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setSavingStatus(false);
    }
  }

  async function recordStoppage(input: {
    category: string;
    reason: string;
    reasonCode: string;
    reasonCatalogId: string;
    typeCatalogId: string;
    responsibleDepartment: string;
    notes: string;
    shift: string;
    maintenanceRequired: boolean;
    problemArea: string;
    responsibleArea: string;
    serviceOrderNumber: string;
    occurrenceDate: string;
    startedAt: string;
    endedAt: string;
    durationMinutes: number | null;
    toolSequence: number | null;
    billetCasing: string;
    equipmentType: string;
    equipmentNumber: string;
    symptoms: string;
    interventionPerformed: string;
    dummyBlockEntered: string;
    dummyBlockExited: string;
    pressCount: number | null;
    dummyBlockSide: string;
  }) {
    if (
      !chosen.length ||
      !chosen.every((item) => item.status === "in_progress")
    ) {
      setMessage("Inicie a campanha antes de apontar uma parada.");
      return;
    }
    const order = chosen[0];
    setSavingStatus(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase.from("machine_stoppages").insert({
        organization_id: organizationId,
        production_order_id: order.id,
        import_batch_id: order.import_batch_id,
        machine_code: order.machine_code,
        plan_code: order.plan_code,
        order_number: order.order_number,
        tool_code: order.tool_code,
        product_code: order.product_code,
        customer_name: order.customer_name,
        alloy_code: order.alloy_code,
        temper: order.temper,
        category: input.category,
        reason_code: input.reasonCode,
        reason_catalog_id: input.reasonCatalogId,
        stoppage_type_catalog_id: input.typeCatalogId,
        responsible_department: input.responsibleDepartment,
        reason: input.reason.trim(),
        notes:
          [
            chosen.length > 1
              ? `Campanha: ${chosen.map((item) => item.order_number).join(", ")}`
              : "",
            input.notes.trim(),
          ]
            .filter(Boolean)
            .join(" · ") || null,
        shift: input.shift || null,
        maintenance_required: input.maintenanceRequired,
        reported_by_name: operatorName,
        problem_area: input.problemArea,
        responsible_area: input.responsibleArea,
        service_order_number: input.serviceOrderNumber || null,
        occurrence_date: input.occurrenceDate,
        started_at: input.startedAt,
        ended_at: input.endedAt || null,
        duration_minutes: input.durationMinutes,
        status: input.endedAt ? "closed" : "open",
        closed_by_name: input.endedAt ? operatorName : null,
        tool_sequence: input.toolSequence,
        billet_casing: input.billetCasing || null,
        equipment_type: input.equipmentType || null,
        equipment_number: input.equipmentNumber || null,
        symptoms: input.symptoms.trim(),
        intervention_performed: input.interventionPerformed.trim() || null,
        dummy_block_entered: input.dummyBlockEntered || null,
        dummy_block_exited: input.dummyBlockExited || null,
        press_count: input.pressCount,
        dummy_block_side: input.dummyBlockSide || null,
      });
      if (error) throw error;
      if (!input.endedAt && chosen.length > 1) {
        const { error: pauseError } = await supabase
          .from("production_orders")
          .update({
            status: "paused",
            last_status_reason: `Campanha pausada por ${operatorName}: ${input.reason.trim()}`,
          })
          .in(
            "id",
            chosen.slice(1).map((item) => item.id),
          )
          .eq("status", "in_progress");
        if (pauseError) throw pauseError;
      }
      if (!input.endedAt) {
        const selectedIds = new Set(chosen.map((item) => item.id));
        setOrders((current) =>
          current.map((item) =>
            selectedIds.has(item.id) ? { ...item, status: "paused" } : item,
          ),
        );
      }
      setStoppageOpen(false);
      setMessage(
        input.endedAt
          ? `Parada encerrada registrada com ${formatElapsed(input.durationMinutes)}. A produção permanece ativa.`
          : input.maintenanceRequired
            ? `Parada aberta. O item foi pausado e a ocorrência foi enviada para Manutenção.`
            : `Parada aberta. O item foi pausado e permanece no histórico operacional.`,
      );
      requestOfflineSync();
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setSavingStatus(false);
    }
  }

  async function reopenProduction(order: Order) {
    setSavingStatus(true);
    setMessage("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("production_orders")
        .update({
          status: "planned",
          is_active: true,
          reopened_at: new Date().toISOString(),
          reopened_by_name: operatorName,
          reprogram_count: order.reprogram_count + 1,
          last_status_reason: `Item reprogramado por ${operatorName}`,
        })
        .eq("id", order.id)
        .eq("status", "completed")
        .select(orderFields)
        .maybeSingle();
      if (error) throw error;
      if (!data)
        throw new Error("O item já foi reprogramado por outro operador.");
      setCompletedOrders((current) =>
        current.filter((item) => item.id !== order.id),
      );
      setOrders((current) =>
        [...current, data as Order].sort((a, b) => a.sequence - b.sequence),
      );
      applyOrders([data.id], [data as Order]);
      setHistoryOpen(false);
      setMessage(`Item ${data.order_number} reprogramado com segurança.`);
      requestOfflineSync();
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setSavingStatus(false);
    }
  }
  function changeUnit(next: Unit) {
    setUnit(next);
    setRequested(0);
    setSelectedOrders([]);
    setManualBillets(undefined);
  }

  return (
    <div className="flex h-[calc(100dvh-64px)] min-h-0 flex-col overflow-hidden bg-[#f6f5f2] p-2 lg:p-3">
      <header className="relative mb-2 flex shrink-0 items-center gap-2 rounded-xl border bg-white p-2 shadow-sm">
        <div className="hidden min-w-40 items-center gap-2 xl:flex">
          <span className="grid size-9 place-items-center rounded-lg bg-orange-500 text-white">
            <Factory className="size-5" />
          </span>
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[.18em] text-orange-600">
              Produção
            </p>
            <h1 className="font-heading text-base font-bold">
              Assistente de extrusão
            </h1>
          </div>
        </div>
        <label className="relative min-w-36 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={toolInput}
            onChange={(event) => setToolInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") openPlanExplorer();
            }}
            className="h-10 pl-9 text-base font-semibold"
            placeholder="Ferramenta, ex.: 19-0065"
          />
        </label>
        <Button
          variant="outline"
          onClick={openPlanExplorer}
          disabled={planSearchLoading}
          className="h-10 border-orange-200 px-3 text-sm font-bold text-orange-700 hover:bg-orange-50"
        >
          {planSearchLoading ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Factory className="size-4" />
          )}
          Buscar nos Planos
        </Button>
        <select
          aria-label="Comprimento de corte"
          value={selectedId}
          onChange={(event) => chooseSheet(event.target.value)}
          disabled={!sheets.length}
          className="h-10 min-w-44 rounded-md border bg-white px-2 text-sm font-medium"
        >
          <option value="">Comprimento de corte</option>
          {sheets.map((sheet) => (
            <option key={sheet.id} value={sheet.id}>
              {format(cutLengthMm(sheet))} mm · P{sheet.machine_code || "—"} ·
              seq. {sheet.tool_sequence ?? sheet.revision}
            </option>
          ))}
        </select>
        <div className="relative">
          <Button
            variant="outline"
            className="h-10 min-w-48 justify-between text-sm"
            onClick={() => setPickerOpen((value) => !value)}
            disabled={!orders.length}
          >
            <span className="truncate">
              {chosen.length
                ? `${chosen.length} item(ns) da Simplificada`
                : "Itens planejados ativos"}
            </span>
            <ChevronDown className="size-4" />
          </Button>
          {pickerOpen && (
            <OrderPicker
              orders={orders}
              selected={selectedOrders}
              onToggle={toggleOrder}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
        <div className="relative">
          <Button
            variant="ghost"
            className="h-10 px-2 text-sm"
            onClick={() => setHistoryOpen((value) => !value)}
          >
            <History className="size-4" />
            Histórico
          </Button>
          {historyOpen && (
            <HistoryPicker
              orders={completedOrders}
              loading={savingStatus}
              onReopen={(order) => void reopenProduction(order)}
              onClose={() => setHistoryOpen(false)}
            />
          )}
        </div>
        <Button
          onClick={() => void findSheets()}
          disabled={loading}
          className="h-10 bg-orange-500 text-sm font-bold hover:bg-orange-600"
        >
          {loading ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Search className="size-4" />
          )}
          Abrir
        </Button>
      </header>
      {message && (
        <div className="mb-2 shrink-0 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          {message}
        </div>
      )}
      {!selected ? (
        <div className="grid min-h-0 flex-1 place-items-center rounded-xl border border-dashed bg-white">
          <div className="text-center">
            <Wrench className="mx-auto size-9 text-orange-400" />
            <h2 className="mt-3 font-heading text-lg font-bold">
              Abra uma Ficha de Processo
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Escolha ferramenta e corte para unir receita e programação ativa.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-2 overflow-hidden md:grid-cols-[1.08fr_.92fr]">
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-white shadow-sm">
            <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xl font-black text-orange-600">
                  {selected.product_code || selected.tool_code}
                </span>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700">
                  RECEITA ATIVA · SEQ.{" "}
                  {selected.tool_sequence ?? selected.revision}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="mr-1 text-right text-sm">
                  <strong>P{selected.machine_code || "—"}</strong>
                  <span className="ml-2 text-slate-500">
                    {selected.alloy_code} {selected.temper} · corte{" "}
                    {format(cutLengthMm(selected))} mm
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSheetEditorOpen(true)}
                  className="h-8 px-2 text-[10px] font-bold"
                >
                  <LockKeyhole className="size-3.5" /> Editar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSheetHistoryOpen(true)}
                  className="h-8 px-2 text-[10px] font-bold"
                >
                  <FileClock className="size-3.5" /> Auditoria
                </Button>
              </div>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1.5 p-2">
              <Recipe title="Extrusão" icon={<Gauge />}>
                <Metric
                  label="Peso linear"
                  value={`${format(result.e.profileLinear, 3)} kg/m`}
                />
                <Metric
                  label="Teórico × furos"
                  value={`${format(result.e.totalLinear, 3)} kg/m`}
                />
                <Metric label="Furos" value={result.e.holes} />
                <Metric label="Cortes / tarugo" value={result.e.cuts} />
                <Metric
                  label="Corte"
                  value={`${format(result.e.cutMm)} mm`}
                  accent
                />
                <Metric
                  label="Descarte"
                  value={`${format(result.e.discardMm)} mm`}
                />
                <Metric
                  label="Velocidade"
                  value={`${format(numeric(selected.parameters.extrusion?.ram_speed_mm_s), 1)} mm/s`}
                />
                <Metric
                  label="Produtividade"
                  value={`${format(numeric(selected.parameters.extrusion?.target_productivity_kg_h))} kg/h`}
                />
              </Recipe>
              <Recipe title="Temperaturas" icon={<Thermometer />}>
                <Metric
                  label="Zona 1"
                  value={temperature(selected, "zone_1_c")}
                />
                <Metric
                  label="Zona 2"
                  value={temperature(selected, "zone_2_c")}
                />
                <Metric
                  label="Zona 3"
                  value={temperature(selected, "zone_3_c")}
                />
                <Metric
                  label="Zona 4"
                  value={temperature(selected, "zone_4_c")}
                />
                <Metric
                  label="Tarugo"
                  value={temperature(selected, "billet_c")}
                  accent
                />
                <Metric
                  label="Container"
                  value={temperature(selected, "container_c")}
                />
                <Metric
                  label="Ferramenta"
                  value={temperature(selected, "die_c")}
                />
                <Metric
                  label="Emergente"
                  value={`${format(numeric(selected.parameters.temperatures?.exit_min_c))}–${format(numeric(selected.parameters.temperatures?.exit_max_c))} °C`}
                />
              </Recipe>
              <Recipe title="Tarugo e puxada" icon={<Target />}>
                <Metric
                  label="Carcaça"
                  value={selected.parameters.billet?.casing || "—"}
                />
                <Metric
                  label="Comp. tarugo"
                  value={`${format(result.e.billetMm)} mm`}
                  accent
                />
                <Metric
                  label="Comp. puxada"
                  value={`${format(result.e.pullMm)} mm`}
                />
                <Metric
                  label="Talão"
                  value={`${format(numeric(selected.parameters.billet?.butt_mm))} mm`}
                />
                <Metric
                  label="Peso / peça"
                  value={`${format(result.e.weightPerPiece, 3)} kg`}
                />
                <Metric
                  label="Peças / tarugo"
                  value={result.e.piecesPerBillet}
                />
                <Metric
                  label="Kg / tarugo"
                  value={`${format(result.e.kgPerBillet, 2)} kg`}
                />
                <Metric
                  label="Puller esq."
                  value={`${format(numeric(selected.parameters.pulling?.puller_left_s), 1)} s`}
                />
                <Metric
                  label="Puller dir."
                  value={`${format(numeric(selected.parameters.pulling?.puller_right_s), 1)} s`}
                />
              </Recipe>
              <Recipe title="Planejamento selecionado" icon={<Factory />}>
                <Metric
                  label="Itens"
                  value={chosen.length || "Manual"}
                  accent
                />
                <Metric
                  label="Plano"
                  value={
                    [
                      ...new Set(
                        chosen.map((order) => order.plan_code).filter(Boolean),
                      ),
                    ].join(", ") || "—"
                  }
                />
                <Metric
                  label="Ordens"
                  value={
                    chosen.map((order) => order.order_number).join(", ") || "—"
                  }
                  wide
                />
                <Metric
                  label="Clientes"
                  value={
                    [
                      ...new Set(
                        chosen
                          .map((order) => order.customer_name)
                          .filter(Boolean),
                      ),
                    ].join(", ") || "—"
                  }
                  wide
                />
                <Metric
                  label="Kg planejado"
                  value={
                    chosen.some((order) => numeric(order.target_kg) > 0)
                      ? `${format(
                          chosen.reduce(
                            (sum, order) => sum + numeric(order.target_kg),
                            0,
                          ),
                          1,
                        )} kg`
                      : "—"
                  }
                  accent
                />
                <Metric
                  label="Pcs planejadas"
                  value={
                    chosen.some((order) => numeric(order.target_quantity) > 0)
                      ? format(
                          chosen.reduce(
                            (sum, order) =>
                              sum + numeric(order.target_quantity),
                            0,
                          ),
                        )
                      : "—"
                  }
                />
                <Metric
                  label="Prazo de entrega"
                  value={displayDueDate(
                    chosen
                      .map((order) => order.due_date)
                      .filter((date): date is string => Boolean(date))
                      .sort()[0] ?? null,
                  )}
                />
                <Metric
                  label="Resfriamento"
                  value={selected.parameters.cooling?.mode || "—"}
                />
                <Metric
                  label="Serra"
                  value={
                    selected.parameters.saw?.mode ||
                    selected.parameters.saw?.raw_value ||
                    "—"
                  }
                />
              </Recipe>
            </div>
          </section>
          <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border bg-white shadow-sm">
            <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
              <div className="flex items-center gap-2">
                <Calculator className="size-4 text-orange-500" />
                <div>
                  <h2 className="font-heading text-base font-bold">
                    Quanto produzir
                  </h2>
                  <p className="text-[10px] text-slate-500">
                    Recomendação atualizada em tempo real.
                  </p>
                </div>
              </div>
              <div className="flex rounded-lg bg-slate-100 p-0.5 text-[10px] font-bold">
                {(["kg", "pieces", "bars"] as Unit[]).map((value) => (
                  <button
                    key={value}
                    className={
                      unit === value
                        ? "rounded-md bg-white px-2.5 py-1 shadow-sm"
                        : "px-2.5 py-1 text-slate-500"
                    }
                    onClick={() => changeUnit(value)}
                  >
                    {unitLabel(value)}
                  </button>
                ))}
              </div>
            </div>
            {chosen.length > 0 && (
              <div className="flex shrink-0 items-center justify-between border-b bg-slate-50 px-3 py-1.5">
                <div className="text-[10px]">
                  <b>
                    {chosen.length === 1
                      ? chosen[0].order_number
                      : `${chosen.length} itens · ${new Set(chosen.map((order) => order.plan_code)).size} Planos`}
                  </b>
                  <span className="ml-2 text-slate-500">
                    {chosen.every((order) => order.status === "in_progress")
                      ? `Em produção · ${chosen[0].started_by_name || operatorName}`
                      : "Disponível para iniciar"}
                  </span>
                </div>
                {chosen.every((order) => order.status === "in_progress") ? (
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setStoppageOpen(true)}
                      disabled={savingStatus}
                      className="h-7 border-amber-300 bg-amber-50 text-[10px] font-bold text-amber-800 hover:bg-amber-100"
                    >
                      <CircleStop className="size-3.5" />
                      Apontar parada
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setCompletionOpen(true)}
                      disabled={savingStatus}
                      className="h-7 bg-emerald-600 text-[10px] font-bold hover:bg-emerald-700"
                    >
                      <SquareCheckBig className="size-3.5" />
                      Informar produzido e encerrar
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => void startProduction()}
                    disabled={savingStatus}
                    className="h-7 bg-orange-500 text-[10px] hover:bg-orange-600"
                  >
                    <Play className="size-3.5" />
                    {chosen[0].status === "paused"
                      ? chosen.length > 1
                        ? "Retomar campanha"
                        : "Retomar produção"
                      : chosen.length > 1
                        ? "Iniciar campanha"
                        : "Iniciar produção"}
                  </Button>
                )}
              </div>
            )}
            <div className="grid min-h-0 flex-1 grid-rows-[auto_auto_auto_auto_1fr] gap-2 p-2.5">
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <label>
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Quantidade planejada
                  </span>
                  <Input
                    type="number"
                    min="0"
                    step={unit === "kg" ? ".1" : "1"}
                    value={requested || ""}
                    onChange={(event) => {
                      setRequested(Number(event.target.value) || 0);
                      setManualBillets(undefined);
                    }}
                    className="h-11 text-xl font-black"
                    placeholder={`Ex.: 1.000 ${unitLabel(unit)}`}
                  />
                </label>
                <div>
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                    Tarugos
                  </span>
                  <div className="flex h-11 items-center rounded-md border">
                    <button
                      aria-label="Diminuir tarugos"
                      className="grid h-full w-9 place-items-center"
                      onClick={() =>
                        setManualBillets(Math.max(0, result.billets - 1))
                      }
                    >
                      <Minus className="size-4" />
                    </button>
                    <strong className="min-w-12 text-center text-2xl text-orange-600">
                      {result.billets}
                    </strong>
                    <button
                      aria-label="Aumentar tarugos"
                      className="grid h-full w-9 place-items-center"
                      onClick={() => setManualBillets(result.billets + 1)}
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                </div>
              </div>
              {unit === "kg" ? (
                <ProductionBand result={result} target={requested} />
              ) : (
                <PieceOptions
                  result={result}
                  unit={unit}
                  onChoose={setManualBillets}
                />
              )}
              <div className={statusClass(result.status)}>
                <div className="flex items-center gap-2">
                  {result.status === "acceptable" ||
                  result.status === "target" ? (
                    <CheckCircle2 className="size-5 text-emerald-600" />
                  ) : (
                    <AlertTriangle
                      className={
                        result.status === "excess"
                          ? "size-5 text-red-600"
                          : "size-5 text-amber-600"
                      }
                    />
                  )}
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">
                      Resultado esperado
                    </p>
                    <p className="text-2xl font-black">
                      {format(result.output, unit === "kg" ? 1 : 0)}{" "}
                      <span className="text-xs">{unitLabel(unit)}</span>
                    </p>
                  </div>
                </div>
                <span className="rounded-full bg-white/80 px-2.5 py-1.5 text-[10px] font-black">
                  {statusLabel(result.status)}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                <Result
                  label="Mín. tarugos"
                  value={format(result.minBillets)}
                />
                <Result label="Ideal" value={format(result.ideal)} accent />
                <Result
                  label="Máx. tarugos"
                  value={format(result.maxBillets)}
                />
                <Result label="Peças / barras" value={format(result.pieces)} />
                <Result
                  label="Peso estimado"
                  value={`${format(result.kg, 1)} kg`}
                />
              </div>
              <div className="grid min-h-0 grid-cols-2 gap-2">
                <div className="rounded-lg border bg-slate-50 p-2">
                  <p className="text-[10px] font-bold uppercase text-slate-400">
                    Diferença para o pedido
                  </p>
                  <p
                    className={
                      result.difference > 0
                        ? "mt-1 text-xl font-black text-red-600"
                        : result.difference < 0
                          ? "mt-1 text-xl font-black text-amber-600"
                          : "mt-1 text-xl font-black text-emerald-600"
                    }
                  >
                    {result.difference > 0 ? "+" : ""}
                    {format(result.difference, unit === "kg" ? 1 : 0)}{" "}
                    {unitLabel(unit)}
                  </p>
                  <p className="text-[10px] text-slate-500">
                    {result.difference > 0
                      ? "Sobra / excedente estimado"
                      : result.difference < 0
                        ? "Risco de produção abaixo"
                        : "Quantidade exata"}
                  </p>
                  {requested > 0 && (
                    <p
                      className={`mt-1.5 inline-flex rounded-full px-2 py-1 text-xs font-black ${
                        result.difference > 0
                          ? "bg-red-100 text-red-700"
                          : result.difference < 0
                            ? "bg-amber-100 text-amber-700"
                            : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {result.difference > 0 ? "+" : ""}
                      {format((result.difference / requested) * 100, 1)}% ·{" "}
                      {result.difference > 0
                        ? "acima"
                        : result.difference < 0
                          ? "abaixo"
                          : "na meta"}
                    </p>
                  )}
                </div>
                <div className="rounded-lg border bg-slate-50 p-2">
                  <p className="text-[10px] font-bold uppercase text-slate-400">
                    Decisão recomendada
                  </p>
                  <p className="mt-1 text-sm font-bold">
                    {result.status === "excess"
                      ? "Reduza a quantidade de tarugos"
                      : result.status === "below"
                        ? "Avalie o próximo tarugo"
                        : "Configuração segura para produzir"}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    A tolerância de ±10% só é aplicada a pedidos em kg.
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}
      {selected && sheetEditorOpen && (
        <ProcessSheetEditor
          sheet={selected}
          onClose={() => setSheetEditorOpen(false)}
          onSaved={(saved) => {
            setSheets((current) =>
              current.map((sheet) => (sheet.id === saved.id ? saved : sheet)),
            );
            setSheetEditorOpen(false);
            setMessage(
              `Ficha ${saved.product_code || saved.tool_code} atualizada por ${operatorName}. O valor anterior foi preservado para auditoria.`,
            );
            requestOfflineSync();
          }}
        />
      )}
      {selected && sheetHistoryOpen && (
        <ProcessSheetHistory
          sheet={selected}
          onClose={() => setSheetHistoryOpen(false)}
        />
      )}
      {planSearchOpen && (
        <PlanCampaignSearch
          query={planSearchQuery}
          orders={visiblePlanSearchResults}
          allOrders={planSearchResults}
          heatingLocations={planHeatingLocations}
          selected={planSearchSelection}
          loading={planSearchLoading}
          onQueryChange={setPlanSearchQuery}
          onRefresh={() => void loadActivePlans()}
          onToggle={togglePlanSearchOrder}
          onSelectMany={selectPlanSearchOrders}
          onClose={() => setPlanSearchOpen(false)}
          onConfirm={() => void loadPlanCampaign()}
        />
      )}
      {chosen.length > 0 && completionOpen && (
        <ProductionCompletionDialog
          orders={chosen}
          estimatedKg={result.kg}
          estimatedPieces={result.pieces}
          saving={savingStatus}
          onClose={() => setCompletionOpen(false)}
          onConfirm={(kg, pieces, notes) =>
            void completeProduction(kg, pieces, notes)
          }
        />
      )}
      {chosen.length > 0 && stoppageOpen && (
        <MachineStoppageDialog
          order={chosen[0]}
          sheet={selected}
          saving={savingStatus}
          onClose={() => setStoppageOpen(false)}
          onConfirm={(input) => void recordStoppage(input)}
        />
      )}
    </div>
  );
}

type EditableSection =
  "extrusion" | "temperatures" | "billet" | "pulling" | "cooling" | "saw";

function ProcessSheetEditor({
  sheet,
  onClose,
  onSaved,
}: {
  sheet: ProcessSheet;
  onClose: () => void;
  onSaved: (sheet: ProcessSheet) => void;
}) {
  const { display_name: operatorName } = useCurrentUser();
  const [draft, setDraft] = useState<Parameters>(() =>
    structuredClone(sheet.parameters),
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const changed = JSON.stringify(draft) !== JSON.stringify(sheet.parameters);
  const draftEngineering = engineering({ ...sheet, parameters: draft });

  function setValue(section: EditableSection, key: string, value: unknown) {
    setDraft((current) => ({
      ...current,
      [section]: {
        ...((current[section] ?? {}) as Record<string, unknown>),
        [key]: value,
      },
    }));
  }

  async function save() {
    if (!organizationId || !reason.trim() || !changed) return;
    setSaving(true);
    setProblem("");
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("process_sheets")
        .update({
          parameters: draft,
          last_changed_by_name: operatorName,
          last_change_reason: reason.trim(),
        })
        .eq("organization_id", organizationId)
        .eq("id", sheet.id)
        .select(
          "id,machine_code,tool_code,product_code,alloy_code,temper,revision,tool_sequence,parameters,is_active,updated_at,last_changed_by_name,last_change_reason",
        )
        .single();
      if (error) throw error;
      onSaved(data as ProcessSheet);
    } catch (cause) {
      setProblem(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-3 backdrop-blur-sm">
      <div className="flex max-h-[calc(100dvh-24px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-orange-500 text-white">
              <PencilLine className="size-5" />
            </span>
            <div>
              <h2 className="font-heading text-lg font-bold">
                Edição controlada da receita
              </h2>
              <p className="text-xs text-slate-500">
                {sheet.product_code || sheet.tool_code} · P{sheet.machine_code}{" "}
                · sequência {sheet.tool_sequence ?? sheet.revision}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-600">
              ALTERANDO COMO {operatorName.toUpperCase()}
            </span>
            <button
              aria-label="Fechar edição"
              onClick={onClose}
              className="grid size-8 place-items-center rounded-lg hover:bg-slate-100"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-3 overflow-auto p-4 lg:grid-cols-3">
          <EditGroup title="Extrusão" icon={<Gauge />}>
            <EditNumber
              label="Peso linear (kg/m)"
              value={draft.extrusion?.profile_linear_weight_kg_m}
              onChange={(value) =>
                setValue("extrusion", "profile_linear_weight_kg_m", value)
              }
            />
            <EditNumber
              label="Número de furos"
              value={draft.extrusion?.holes}
              onChange={(value) => setValue("extrusion", "holes", value)}
            />
            <EditNumber
              label="Cortes por tarugo"
              value={draft.extrusion?.cuts_per_pull}
              onChange={(value) =>
                setValue("extrusion", "cuts_per_pull", value)
              }
            />
            <EditNumber
              label="Corte (mm)"
              value={cutLengthMm({ ...sheet, parameters: draft })}
              onChange={(value) =>
                setValue("extrusion", "cut_length_mm", value)
              }
              accent
            />
            <EditNumber
              label="Descarte (mm)"
              value={discardMm({ ...sheet, parameters: draft })}
              onChange={(value) => setValue("extrusion", "discard_mm", value)}
            />
            <EditNumber
              label="Velocidade (mm/s)"
              value={draft.extrusion?.ram_speed_mm_s}
              onChange={(value) =>
                setValue("extrusion", "ram_speed_mm_s", value)
              }
            />
            <EditNumber
              label="Produtividade (kg/h)"
              value={draft.extrusion?.target_productivity_kg_h}
              onChange={(value) =>
                setValue("extrusion", "target_productivity_kg_h", value)
              }
            />
          </EditGroup>

          <EditGroup title="Temperaturas" icon={<Thermometer />}>
            <EditNumber
              label="Zona 1 (°C)"
              value={draft.temperatures?.zone_1_c}
              onChange={(value) => setValue("temperatures", "zone_1_c", value)}
            />
            <EditNumber
              label="Zona 2 (°C)"
              value={draft.temperatures?.zone_2_c}
              onChange={(value) => setValue("temperatures", "zone_2_c", value)}
            />
            <EditNumber
              label="Zona 3 (°C)"
              value={draft.temperatures?.zone_3_c}
              onChange={(value) => setValue("temperatures", "zone_3_c", value)}
            />
            <EditNumber
              label="Zona 4 (°C)"
              value={draft.temperatures?.zone_4_c}
              onChange={(value) => setValue("temperatures", "zone_4_c", value)}
            />
            <EditNumber
              label="Tarugo (°C)"
              value={draft.temperatures?.billet_c}
              onChange={(value) => setValue("temperatures", "billet_c", value)}
              accent
            />
            <EditNumber
              label="Container (°C)"
              value={draft.temperatures?.container_c}
              onChange={(value) =>
                setValue("temperatures", "container_c", value)
              }
            />
            <EditNumber
              label="Ferramenta (°C)"
              value={draft.temperatures?.die_c}
              onChange={(value) => setValue("temperatures", "die_c", value)}
            />
            <EditNumber
              label="Emergente mín. (°C)"
              value={draft.temperatures?.exit_min_c}
              onChange={(value) =>
                setValue("temperatures", "exit_min_c", value)
              }
            />
            <EditNumber
              label="Emergente máx. (°C)"
              value={draft.temperatures?.exit_max_c}
              onChange={(value) =>
                setValue("temperatures", "exit_max_c", value)
              }
            />
          </EditGroup>

          <EditGroup title="Tarugo, puxada e acabamento" icon={<Target />}>
            <EditText
              label="Carcaça"
              value={draft.billet?.casing || ""}
              onChange={(value) => setValue("billet", "casing", value)}
            />
            <EditNumber
              label="Comprimento tarugo (mm)"
              value={
                numeric(draft.billet?.calculated_length_mm) ||
                Math.round(draftEngineering.billetMm)
              }
              onChange={(value) =>
                setValue("billet", "calculated_length_mm", value)
              }
              accent
            />
            <EditNumber
              label="Comprimento puxada (mm)"
              value={
                numeric(draft.billet?.calculated_pull_mm) ||
                Math.round(draftEngineering.pullMm)
              }
              onChange={(value) =>
                setValue("billet", "calculated_pull_mm", value)
              }
            />
            <EditNumber
              label="Talão (mm)"
              value={draft.billet?.butt_mm}
              onChange={(value) => setValue("billet", "butt_mm", value)}
            />
            <EditNumber
              label="Puller esquerdo (s)"
              value={draft.pulling?.puller_left_s}
              onChange={(value) => setValue("pulling", "puller_left_s", value)}
            />
            <EditNumber
              label="Puller direito (s)"
              value={draft.pulling?.puller_right_s}
              onChange={(value) => setValue("pulling", "puller_right_s", value)}
            />
            <CoolingModeSelect
              label="Resfriamento"
              value={draft.cooling?.mode || ""}
              onValueChange={(value) => setValue("cooling", "mode", value)}
            />
            <EditText
              label="Modo da serra"
              value={draft.saw?.mode || draft.saw?.raw_value || ""}
              onChange={(value) => setValue("saw", "mode", value)}
            />
          </EditGroup>
        </div>

        <div className="grid shrink-0 gap-3 border-t bg-slate-50 px-5 py-3 md:grid-cols-[1fr_auto] md:items-end">
          <label>
            <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
              Motivo da correção · obrigatório para auditoria
            </span>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Ex.: correção do setpoint validada pela Engenharia"
              className="bg-white"
            />
          </label>
          <div className="flex items-center justify-end gap-2">
            {problem && (
              <span className="max-w-72 text-xs font-medium text-red-600">
                {problem}
              </span>
            )}
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              onClick={() => void save()}
              disabled={saving || !changed || !reason.trim()}
              className="min-w-44 bg-orange-500 font-bold hover:bg-orange-600"
            >
              {saving ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Save className="size-4" />
              )}
              Salvar com histórico
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProcessSheetHistory({
  sheet,
  onClose,
}: {
  sheet: ProcessSheet;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<SheetHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState("");

  useEffect(() => {
    async function loadHistory() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from("process_sheet_change_history")
          .select(
            "id,changed_by_name,change_reason,changed_at,previous_parameters,new_parameters",
          )
          .eq("process_sheet_id", sheet.id)
          .order("changed_at", { ascending: false })
          .limit(50);
        if (error) throw error;
        setEntries((data ?? []) as SheetHistory[]);
      } catch (cause) {
        setProblem(errorMessage(cause));
      } finally {
        setLoading(false);
      }
    }
    void loadHistory();
  }, [sheet.id]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-3 backdrop-blur-sm">
      <div className="flex max-h-[calc(100dvh-24px)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-slate-950 text-orange-400">
              <FileClock className="size-5" />
            </span>
            <div>
              <h2 className="font-heading text-lg font-bold">
                Histórico auditável da receita
              </h2>
              <p className="text-xs text-slate-500">
                {sheet.product_code || sheet.tool_code} · valores anteriores e
                novos
              </p>
            </div>
          </div>
          <button
            aria-label="Fechar auditoria"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg hover:bg-slate-100"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-auto bg-slate-50 p-4">
          {loading && (
            <p className="p-8 text-center text-sm text-slate-500">
              Carregando alterações...
            </p>
          )}
          {problem && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {problem}
            </p>
          )}
          {!loading && !problem && entries.length === 0 && (
            <div className="rounded-xl border bg-white p-10 text-center">
              <FileClock className="mx-auto size-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold">
                Nenhuma correção registrada
              </p>
              <p className="mt-1 text-xs text-slate-500">
                A ficha ainda mantém os valores originais importados.
              </p>
            </div>
          )}
          {entries.map((entry) => {
            const changes = parameterChanges(
              entry.previous_parameters,
              entry.new_parameters,
            );
            return (
              <article
                key={entry.id}
                className="overflow-hidden rounded-xl border bg-white shadow-sm"
              >
                <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
                  <div>
                    <p className="text-sm font-bold">{entry.changed_by_name}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {entry.change_reason}
                    </p>
                  </div>
                  <time className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-[10px] font-bold text-slate-600">
                    {new Date(entry.changed_at).toLocaleString("pt-BR")}
                  </time>
                </div>
                <div className="grid gap-px bg-slate-200 sm:grid-cols-2">
                  {changes.map((change) => (
                    <div key={change.key} className="bg-white px-4 py-2.5">
                      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
                        {change.label}
                      </p>
                      <p className="mt-1 text-xs">
                        <span className="line-through decoration-red-400 text-slate-400">
                          {formatAuditValue(change.before)}
                        </span>
                        <span className="mx-2 text-slate-300">→</span>
                        <strong className="text-emerald-700">
                          {formatAuditValue(change.after)}
                        </strong>
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EditGroup({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="grid content-start grid-cols-2 gap-2 rounded-xl border bg-slate-50/60 p-3">
      <legend className="px-1 text-xs font-black text-slate-800">
        <span className="flex items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:text-orange-500">
          {icon}
          {title}
        </span>
      </legend>
      {children}
    </fieldset>
  );
}

function EditNumber({
  label,
  value,
  onChange,
  accent,
}: {
  label: string;
  value?: number;
  onChange: (value: number) => void;
  accent?: boolean;
}) {
  return (
    <label>
      <span className="mb-1 block truncate text-[9px] font-bold uppercase text-slate-500">
        {label}
      </span>
      <Input
        type="number"
        step="any"
        value={numeric(value)}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className={
          accent
            ? "h-8 border-orange-300 bg-orange-50 text-xs font-bold"
            : "h-8 bg-white text-xs font-bold"
        }
      />
    </label>
  );
}

function EditText({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      <span className="mb-1 block truncate text-[9px] font-bold uppercase text-slate-500">
        {label}
      </span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 bg-white text-xs font-bold"
      />
    </label>
  );
}

function PlanCampaignSearch({
  query,
  orders,
  allOrders,
  heatingLocations,
  selected,
  loading,
  onQueryChange,
  onRefresh,
  onToggle,
  onSelectMany,
  onClose,
  onConfirm,
}: {
  query: string;
  orders: Order[];
  allOrders: Order[];
  heatingLocations: PlanHeatingLocation[];
  selected: string[];
  loading: boolean;
  onQueryChange: (value: string) => void;
  onRefresh: () => void;
  onToggle: (id: string) => void;
  onSelectMany: (ids: string[]) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const selectedOrders = allOrders.filter((order) => selected.includes(order.id));
  const plans = [
    ...new Set(orders.map((order) => order.plan_code || "Sem Plano")),
  ];
  const selectedPlans = new Set(
    selectedOrders.map((order) => order.plan_code || "Sem Plano"),
  ).size;
  const selectedKg = selectedOrders.reduce(
    (sum, order) => sum + numeric(order.target_kg),
    0,
  );
  const selectedPieces = selectedOrders.reduce(
    (sum, order) => sum + numeric(order.target_quantity),
    0,
  );
  const heatingByOrder = new Map<string, PlanHeatingLocation>();
  const heatingByToolMachine = new Map<string, PlanHeatingLocation>();
  for (const cycle of heatingLocations) {
    const toolMachineKey = `${normalizeCode(cycle.tool_code)}|${cycle.machine_code}`;
    if (!heatingByToolMachine.has(toolMachineKey)) heatingByToolMachine.set(toolMachineKey, cycle);
    for (const link of cycle.tool_heating_cycle_orders ?? []) {
      if (!heatingByOrder.has(link.production_order_id)) heatingByOrder.set(link.production_order_id, cycle);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-3 backdrop-blur-sm">
      <div className="flex max-h-[calc(100dvh-24px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-orange-500 text-white">
              <Factory className="size-5" />
            </span>
            <div>
              <h2 className="font-heading text-lg font-bold">
                Explorar ferramentas nos Planos ativos
              </h2>
              <p className="text-xs text-slate-500">
                Consulte toda a fila, encontre por parte do código e veja onde a ferramenta está.
              </p>
            </div>
          </div>
          <button
            aria-label="Fechar busca nos Planos"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-lg hover:bg-slate-100"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="grid shrink-0 gap-2 border-b bg-slate-50 p-4 md:grid-cols-[1fr_auto]">
          <label className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              autoFocus
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              className="h-11 bg-white pl-10 text-base font-bold"
              placeholder="Ferramenta, Plano, cliente ou ordem — ex.: T25"
            />
          </label>
          <Button
            onClick={query ? () => onQueryChange("") : onRefresh}
            disabled={loading}
            variant="outline"
            className="h-11 min-w-32 font-bold"
          >
            {loading ? <Loader2 className="animate-spin" /> : query ? <X /> : <RefreshCw />}
            {query ? "Limpar" : "Atualizar"}
          </Button>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-px border-b bg-slate-200 sm:grid-cols-4">
          <CampaignSummary label="Itens encontrados" value={orders.length} />
          <CampaignSummary label="Planos encontrados" value={plans.length} />
          <CampaignSummary
            label="Itens selecionados"
            value={selected.length}
            accent
          />
          <CampaignSummary
            label="Demanda selecionada"
            value={`${selectedKg ? `${format(selectedKg, 1)} kg` : "—"}${selectedPieces ? ` · ${format(selectedPieces)} pcs` : ""}`}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-slate-50 p-3">
          {!loading && orders.length === 0 && (
            <div className="grid min-h-72 place-items-center rounded-xl border border-dashed bg-white text-center">
              <div>
                <Search className="mx-auto size-9 text-slate-300" />
                <p className="mt-3 text-sm font-bold">Nenhum item disponível encontrado</p>
                <p className="mt-1 text-xs text-slate-500">
                  {query ? "Tente apenas uma parte do código, o Plano, o cliente ou a ordem." : "Não há itens pendentes nas Simplificadas ativas."}
                </p>
              </div>
            </div>
          )}
          {plans.map((plan) => {
            const rows = orders.filter(
              (order) => (order.plan_code || "Sem Plano") === plan,
            );
            return (
              <section
                key={plan}
                className="mb-3 overflow-hidden rounded-xl border bg-white shadow-sm last:mb-0"
              >
                <div className="flex items-center justify-between border-b bg-slate-950 px-4 py-2 text-white">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-black">Plano {plan}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold">
                      {rows.length} item(ns)
                    </span>
                    <span className="text-[10px] text-slate-300">
                      FIFO · prazo mais próximo primeiro
                    </span>
                  </div>
                  <button
                    onClick={() => onSelectMany(rows.map((order) => order.id))}
                    className="text-[10px] font-bold text-orange-300 hover:text-orange-200"
                  >
                    Selecionar Plano
                  </button>
                </div>
                <div className="grid grid-cols-[42px_1fr_.7fr_.45fr_.72fr_.72fr_.68fr_.55fr_.55fr_1fr] border-b bg-slate-100 px-3 py-2 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                  <span />
                  <span>Ordem</span>
                  <span>Ferramenta</span>
                  <span>Seq.</span>
                  <span>Quantidade</span>
                  <span>Saldo</span>
                  <span>Prazo</span>
                  <span>Liga</span>
                  <span>Prensa</span>
                  <span>Preparação</span>
                </div>
                {rows.map((order) => {
                  const checked = selected.includes(order.id);
                  const inProgress = order.status === "in_progress";
                  const target =
                    order.demand_unit === "kg"
                      ? numeric(order.target_kg)
                      : numeric(order.target_quantity);
                  const produced =
                    order.demand_unit === "kg"
                      ? numeric(order.produced_kg)
                      : numeric(order.produced_quantity);
                  const heating = heatingByOrder.get(order.id) ?? heatingByToolMachine.get(`${normalizeCode(order.tool_code)}|${order.machine_code}`);
                  return (
                    <button
                      key={order.id}
                      onClick={() => onToggle(order.id)}
                      className={`grid w-full grid-cols-[42px_1fr_.7fr_.45fr_.72fr_.72fr_.68fr_.55fr_.55fr_1fr] items-center border-b px-3 py-2.5 text-left text-xs last:border-b-0 ${
                        checked
                          ? "bg-orange-50"
                          : inProgress
                            ? "cursor-not-allowed bg-amber-50/50"
                            : "hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`grid size-5 place-items-center rounded ${
                          checked
                            ? "bg-orange-500 text-white"
                            : "border bg-white"
                        }`}
                      >
                        {checked && <Check className="size-3.5" />}
                      </span>
                      <span className="min-w-0">
                        <b className="block truncate">{order.order_number}</b>
                        <span className="text-[9px] text-slate-400">
                          {order.customer_name || "Sem cliente"}
                        </span>
                      </span>
                      <b className="font-mono text-orange-600">
                        {order.tool_code}
                      </b>
                      <span>{format(order.sequence)}</span>
                      <b>
                        {format(target, order.demand_unit === "kg" ? 1 : 0)}{" "}
                        {unitLabel(order.demand_unit)}
                      </b>
                      <span>
                        {format(
                          Math.max(0, target - produced),
                          order.demand_unit === "kg" ? 1 : 0,
                        )}{" "}
                        {unitLabel(order.demand_unit)}
                      </span>
                      <span>{displayDueDate(order.due_date)}</span>
                      <span>
                        {order.alloy_code} {order.temper}
                      </span>
                      <span className="flex items-center gap-1 font-bold">
                        P{order.machine_code}
                        {inProgress && (
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-[8px] text-amber-800">
                            EM PRODUÇÃO
                          </span>
                        )}
                      </span>
                      <HeatingLocationBadge cycle={heating} />
                    </button>
                  );
                })}
              </section>
            );
          })}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t bg-white px-5 py-3">
          <div className="text-xs text-slate-500">
            {selected.length ? (
              <>
                <b className="text-slate-900">{selected.length} item(ns)</b> de{" "}
                <b className="text-slate-900">{selectedPlans} Plano(s)</b> serão
                tratados como uma campanha, mantendo seus históricos separados.
              </>
            ) : (
              "Selecione os itens que serão atendidos nesta produção."
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              disabled={!selected.length}
              onClick={onConfirm}
              className="min-w-48 bg-orange-500 font-bold hover:bg-orange-600"
            >
              <Check className="size-4" /> Carregar campanha
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HeatingLocationBadge({ cycle }: { cycle?: PlanHeatingLocation }) {
  if (!cycle) return <span className="text-[10px] font-medium text-slate-400">Aguardando forno</span>;
  if (cycle.status === "released") {
    return <span className="inline-flex w-fit items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-black uppercase text-emerald-700"><CheckCircle2 className="size-3" />Liberada</span>;
  }
  return <span className="inline-flex w-fit items-center gap-1 rounded-full bg-orange-50 px-2 py-1 text-[9px] font-bold text-orange-700" title={`Liberação mínima às ${displayClock(cycle.expected_ready_at)}`}><Flame className="size-3" />{cycle.oven_code || "Forno"} · posição {cycle.oven_position ?? "—"}</span>;
}

function CampaignSummary({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="bg-white px-4 py-2.5">
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p
        className={`mt-0.5 text-base font-black ${accent ? "text-orange-600" : "text-slate-950"}`}
      >
        {value}
      </p>
    </div>
  );
}

function ProductionCompletionDialog({
  orders,
  estimatedKg,
  estimatedPieces,
  saving,
  onClose,
  onConfirm,
}: {
  orders: Order[];
  estimatedKg: number;
  estimatedPieces: number;
  saving: boolean;
  onClose: () => void;
  onConfirm: (kg: number, pieces: number, notes: string) => void;
}) {
  const order = orders[0];
  const totalTargetKg = orders.reduce(
    (sum, item) => sum + numeric(item.target_kg),
    0,
  );
  const totalTargetPieces = orders.reduce(
    (sum, item) => sum + numeric(item.target_quantity),
    0,
  );
  const [kg, setKg] = useState(
    Number((estimatedKg || totalTargetKg).toFixed(3)),
  );
  const [pieces, setPieces] = useState(
    Math.round(estimatedPieces || totalTargetPieces),
  );
  const [notes, setNotes] = useState("");
  const valid = kg > 0 || pieces > 0;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-3 backdrop-blur-sm">
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-emerald-600 text-white">
              <SquareCheckBig className="size-5" />
            </span>
            <div>
              <h2 className="font-heading text-lg font-bold">
                {orders.length > 1
                  ? "Informar produzido e encerrar campanha"
                  : "Informar produzido e encerrar"}
              </h2>
              <p className="text-xs text-slate-500">
                {orders.length > 1
                  ? `${orders.length} itens · ${new Set(orders.map((item) => item.plan_code)).size} Planos`
                  : `Plano ${order.plan_code || "—"} · ${order.order_number}`}
              </p>
            </div>
          </div>
          <button aria-label="Fechar encerramento" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-950 p-3 text-white">
            <MiniSummary label="Ferramenta" value={order.tool_code} />
            <MiniSummary label="Prensa" value={`P${order.machine_code}`} />
            <MiniSummary label="Prazo" value={displayDueDate(order.due_date)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-slate-500">
                Peso produzido (kg)
              </span>
              <Input
                aria-label="Peso produzido em kg"
                type="number"
                min="0"
                step="0.001"
                value={kg || ""}
                onChange={(event) => setKg(Number(event.target.value) || 0)}
                className="h-12 text-xl font-black"
              />
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-bold uppercase text-slate-500">
                Quantidade produzida (pcs)
              </span>
              <Input
                aria-label="Quantidade produzida em peças"
                type="number"
                min="0"
                step="1"
                value={pieces || ""}
                onChange={(event) =>
                  setPieces(Math.max(0, Math.round(Number(event.target.value))))
                }
                className="h-12 text-xl font-black"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] font-bold uppercase text-slate-500">
              Observação do encerramento
            </span>
            <textarea
              aria-label="Observação do encerramento"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Ocorrências, sobras, perdas ou observações do operador"
              className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
            />
          </label>
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {orders.length > 1
              ? "O total informado será distribuído proporcionalmente à demanda de cada item. Cada Ordem manterá seu próprio apontamento e cada Plano será encerrado somente quando não houver mais itens ativos."
              : "Ao confirmar, o item sai da fila. Quando o último item for encerrado, o Plano será concluído automaticamente."}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!valid || saving}
            onClick={() => onConfirm(kg, pieces, notes)}
            className="bg-emerald-600 font-bold hover:bg-emerald-700"
          >
            {saving ? <Loader2 className="animate-spin" /> : <Check />}
            {orders.length > 1
              ? `Encerrar ${orders.length} itens`
              : "Encerrar item produzido"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function MachineStoppageDialog({
  order,
  sheet,
  saving,
  onClose,
  onConfirm,
}: {
  order: Order;
  sheet?: ProcessSheet;
  saving: boolean;
  onClose: () => void;
  onConfirm: (input: {
    category: string;
    reason: string;
    reasonCode: string;
    reasonCatalogId: string;
    typeCatalogId: string;
    responsibleDepartment: string;
    notes: string;
    shift: string;
    maintenanceRequired: boolean;
    problemArea: string;
    responsibleArea: string;
    serviceOrderNumber: string;
    occurrenceDate: string;
    startedAt: string;
    endedAt: string;
    durationMinutes: number | null;
    toolSequence: number | null;
    billetCasing: string;
    equipmentType: string;
    equipmentNumber: string;
    symptoms: string;
    interventionPerformed: string;
    dummyBlockEntered: string;
    dummyBlockExited: string;
    pressCount: number | null;
    dummyBlockSide: string;
  }) => void;
}) {
  const { display_name: operatorName } = useCurrentUser();
  const now = useMemo(() => new Date(), []);
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [categoryCode, setCategoryCode] = useState("E");
  const [reasonId, setReasonId] = useState("");
  const [notes, setNotes] = useState("");
  const [shift, setShift] = useState("");
  const [problemArea, setProblemArea] = useState("Produção");
  const [responsibleArea, setResponsibleArea] = useState("Processo");
  const [serviceOrderNumber, setServiceOrderNumber] = useState("");
  const [occurrenceDate, setOccurrenceDate] = useState(localDateInput(now));
  const [startTime, setStartTime] = useState(localTimeInput(now));
  const [endTime, setEndTime] = useState("");
  const [equipmentType, setEquipmentType] = useState("");
  const [equipmentNumber, setEquipmentNumber] = useState("");
  const [symptoms, setSymptoms] = useState("");
  const [interventionPerformed, setInterventionPerformed] = useState("");
  const [dummyBlockEntered, setDummyBlockEntered] = useState("");
  const [dummyBlockExited, setDummyBlockExited] = useState("");
  const [pressCount, setPressCount] = useState("");
  const [dummyBlockSide, setDummyBlockSide] = useState("");
  const types = catalog.filter(
    (option) => option.catalog_type === "stoppage_type",
  );
  const selectedType = types.find((option) => option.code === categoryCode);
  const reasons = catalog.filter(
    (option) =>
      option.catalog_type === "stoppage_reason" &&
      (option.parent_id
        ? option.parent_id === selectedType?.id
        : option.group_code === categoryCode),
  );
  const selectedReason = catalog.find((option) => option.id === reasonId);
  const stopWindow = stopTimeWindow(occurrenceDate, startTime, endTime);
  const startedAt = stopWindow.startedAt;
  const billetCasing = sheet?.parameters.billet?.casing || "";
  const toolSequence = sheet?.tool_sequence ?? sheet?.revision ?? null;

  useEffect(() => {
    let active = true;
    async function loadCatalog() {
      try {
        const { data, error } = await withSupabaseTimeout(
          createClient()
            .from("operational_catalogs")
            .select(
              "id,parent_id,catalog_type,code,label,group_code,responsible_department,routes_to_maintenance,sort_order,metadata,is_active",
            )
            .eq("organization_id", organizationId)
            .in("catalog_type", ["stoppage_type", "stoppage_reason"])
            .eq("is_active", true)
            .order("sort_order"),
        );
        if (error) throw error;
        if (active) setCatalog((data ?? []) as CatalogOption[]);
      } catch {
        const cached = await getOfflineSnapshot<CatalogOption>(
          "operational_catalogs",
        );
        if (active) setCatalog(cached?.rows ?? []);
      } finally {
        if (active) setCatalogLoading(false);
      }
    }
    void loadCatalog();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-2 backdrop-blur-sm">
      <div className="flex max-h-[96dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border bg-white shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-amber-500 text-white">
              <CircleStop className="size-5" />
            </span>
            <div>
              <h2 className="font-heading text-lg font-bold">
                Apontar parada de máquina
              </h2>
              <p className="text-xs text-slate-500">
                Registro completo · operador {operatorName}
              </p>
            </div>
          </div>
          <button aria-label="Fechar apontamento" onClick={onClose}>
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-950 p-3 text-white sm:grid-cols-4 lg:grid-cols-6">
            <MiniSummary label="Prensa" value={`P${order.machine_code}`} />
            <MiniSummary label="Plano" value={order.plan_code || "—"} />
            <MiniSummary label="Ordem" value={order.order_number} />
            <MiniSummary label="Ferramenta" value={order.tool_code} />
            <MiniSummary
              label="Sequência"
              value={String(toolSequence ?? "—")}
            />
            <MiniSummary
              label="Liga / têmpera"
              value={`${order.alloy_code} ${order.temper || ""}`.trim()}
            />
          </div>

          <section className="rounded-xl border bg-slate-50/70 p-3">
            <div className="mb-2 flex items-center gap-2">
              <CalendarDays className="size-4 text-orange-600" />
              <h3 className="text-sm font-black">
                Identificação da ocorrência
              </h3>
            </div>
            <div className="grid gap-2 md:grid-cols-4 lg:grid-cols-7">
              <CompactSelect
                label="Problema na área"
                value={problemArea}
                onChange={setProblemArea}
                options={[
                  "Produção",
                  "Manutenção",
                  "Qualidade",
                  "Ferramentaria",
                  "Utilidades",
                ]}
              />
              <CompactSelect
                label="Responsável"
                value={responsibleArea}
                onChange={setResponsibleArea}
                options={[
                  "Processo",
                  "Produção",
                  "Mecânica",
                  "Elétrica",
                  "Ferramentaria",
                  "Qualidade",
                ]}
              />
              <CompactInput
                label="Data"
                type="date"
                value={occurrenceDate}
                onChange={setOccurrenceDate}
              />
              <CompactSelect
                label="Turno"
                value={shift}
                onChange={setShift}
                options={["A", "B", "C", "D"]}
                placeholder="Selecione"
              />
              <CompactInput
                label="Hora inicial"
                type="time"
                value={startTime}
                onChange={setStartTime}
              />
              <CompactInput
                label="Hora final"
                type="time"
                value={endTime}
                onChange={setEndTime}
              />
              <ReadOnlyField
                label="Tempo total parado"
                value={
                  endTime
                    ? formatElapsed(stopWindow.durationMinutes)
                    : "Em andamento"
                }
              />
            </div>
            {stopWindow.error && (
              <p className="mt-2 text-xs font-semibold text-red-600">
                {stopWindow.error}
              </p>
            )}
          </section>

          <section className="rounded-xl border p-3">
            <div className="mb-2 flex items-center gap-2">
              <CircleStop className="size-4 text-orange-600" />
              <h3 className="text-sm font-black">Classificação da parada</h3>
            </div>
            <FieldLabel>Tipos disponíveis</FieldLabel>
            <div
              className="mb-3 flex flex-wrap gap-2"
              aria-label="Tipos de parada disponíveis"
            >
              {types.map((type) => (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => {
                    setCategoryCode(type.code);
                    setReasonId("");
                    setSymptoms("");
                  }}
                  className={`rounded-lg border px-3 py-2 text-left transition ${
                    categoryCode === type.code
                      ? "border-orange-500 bg-orange-500 text-white shadow-sm"
                      : "bg-white text-slate-700 hover:border-orange-300 hover:bg-orange-50"
                  }`}
                >
                  <b className="block text-xs">{type.label}</b>
                  <span
                    className={`text-[9px] font-black ${categoryCode === type.code ? "text-orange-100" : "text-slate-400"}`}
                  >
                    Código {type.code}
                  </span>
                </button>
              ))}
            </div>
            <div className="grid gap-3 lg:grid-cols-[1fr_220px]">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <FieldLabel>
                    Motivos relacionados a {selectedType?.label || categoryCode}
                  </FieldLabel>
                  <span className="text-[10px] text-slate-500">
                    {reasons.length} disponível(is) · percorra ou selecione
                  </span>
                </div>
                <div className="grid max-h-36 gap-1.5 overflow-y-auto rounded-lg border bg-slate-50 p-2 sm:grid-cols-2 lg:grid-cols-3">
                  {catalogLoading ? (
                    <span className="col-span-full p-3 text-center text-xs text-slate-500">
                      Carregando motivos...
                    </span>
                  ) : reasons.length ? (
                    reasons.map((reason) => (
                      <button
                        key={reason.id}
                        type="button"
                        onClick={() => {
                          setReasonId(reason.id);
                          setSymptoms(reason.label);
                        }}
                        className={`flex min-h-10 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition ${
                          reasonId === reason.id
                            ? "border-orange-500 bg-orange-50 font-bold text-orange-800"
                            : "border-transparent bg-white hover:border-orange-200"
                        }`}
                      >
                        <span className="grid size-6 shrink-0 place-items-center rounded bg-slate-100 text-[9px] font-black text-slate-600">
                          {reason.code}
                        </span>
                        <span>{reason.label}</span>
                      </button>
                    ))
                  ) : (
                    <span className="col-span-full p-3 text-center text-xs text-slate-500">
                      Nenhum motivo relacionado a este tipo.
                    </span>
                  )}
                </div>
              </div>
              <CompactInput
                label="Nº ordem de serviço"
                value={serviceOrderNumber}
                onChange={setServiceOrderNumber}
                placeholder="Automática ou externa"
              />
            </div>
          </section>

          <section className="rounded-xl border bg-slate-50/70 p-3">
            <div className="mb-2 flex items-center gap-2">
              <Wrench className="size-4 text-orange-600" />
              <h3 className="text-sm font-black">Contexto técnico</h3>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              <ReadOnlyField
                label="Ferramenta / sequência"
                value={`${order.tool_code} / ${toolSequence ?? "—"}`}
              />
              <ReadOnlyField
                label="Carcaça"
                value={billetCasing || "Não cadastrada"}
              />
              <CompactSelect
                label="Tipo do equipamento"
                value={equipmentType}
                onChange={setEquipmentType}
                options={[
                  "Hidráulico",
                  "Mecânico",
                  "Elétrico",
                  "Dummy Block",
                  "Produção",
                ]}
                placeholder="Selecione"
              />
              <CompactInput
                label="Número / identificação"
                value={equipmentNumber}
                onChange={setEquipmentNumber}
                placeholder="Ex.: motor 02"
              />
              <ReadOnlyField label="Prensa" value={`P${order.machine_code}`} />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <CompactInput
                label="Dummy Block entrou"
                value={dummyBlockEntered}
                onChange={setDummyBlockEntered}
                placeholder="Nº / posição"
              />
              <CompactInput
                label="Dummy Block saiu"
                value={dummyBlockExited}
                onChange={setDummyBlockExited}
                placeholder="Nº / posição"
              />
              <CompactInput
                label="Qtd. de prensagens"
                type="number"
                value={pressCount}
                onChange={setPressCount}
                placeholder="0"
              />
              <CompactInput
                label="Lado do Dummy Block"
                value={dummyBlockSide}
                onChange={setDummyBlockSide}
                placeholder="Direito / esquerdo"
              />
            </div>
          </section>

          <div className="grid gap-3 lg:grid-cols-2">
            <label className="block">
              <FieldLabel>Sintomas apresentados · obrigatório</FieldLabel>
              <textarea
                aria-label="Sintomas apresentados"
                value={symptoms}
                onChange={(event) => setSymptoms(event.target.value)}
                rows={3}
                placeholder="Descreva o que foi observado antes ou durante a parada"
                className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </label>
            <label className="block">
              <FieldLabel>Intervenção efetuada</FieldLabel>
              <textarea
                aria-label="Intervenção efetuada"
                value={interventionPerformed}
                onChange={(event) =>
                  setInterventionPerformed(event.target.value)
                }
                rows={3}
                placeholder="Preencha se alguma ação já foi executada"
                className="w-full resize-none rounded-lg border px-3 py-2 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
              />
            </label>
          </div>
          <label className="block">
            <FieldLabel>Observação complementar</FieldLabel>
            <Input
              aria-label="Observação da parada"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Lote, condição especial, material ou informação adicional"
            />
          </label>
          <div
            className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${
              selectedReason?.routes_to_maintenance
                ? "border-orange-200 bg-orange-50"
                : "border-sky-200 bg-sky-50"
            }`}
          >
            <span
              className={`grid size-7 place-items-center rounded-full text-white ${
                selectedReason?.routes_to_maintenance
                  ? "bg-orange-500"
                  : "bg-sky-600"
              }`}
            >
              {selectedReason?.routes_to_maintenance ? (
                <Wrench className="size-4" />
              ) : (
                <Factory className="size-4" />
              )}
            </span>
            <span>
              <b className="block text-sm">
                {selectedReason
                  ? `Responsável: ${selectedReason.responsible_department || "Produção"}`
                  : "Selecione um motivo para definir o destino"}
              </b>
              <span className="text-xs text-slate-600">
                {selectedReason?.routes_to_maintenance
                  ? "Uma ocorrência será criada automaticamente na fila da Manutenção."
                  : "A parada ficará registrada no histórico operacional, sem abrir chamado de manutenção."}
              </span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-slate-50 px-5 py-3">
          <span className="hidden items-center gap-1 text-xs text-slate-500 sm:flex">
            <Timer className="size-4" />
            {endTime
              ? `Ocorrência encerrada · total ${formatElapsed(stopWindow.durationMinutes)}`
              : "Sem hora final, a ordem será pausada até o encerramento."}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              disabled={
                !selectedReason ||
                !symptoms.trim() ||
                !startedAt ||
                Boolean(stopWindow.error) ||
                saving
              }
              onClick={() =>
                onConfirm({
                  category:
                    selectedReason?.metadata.internal_category || "other",
                  reason: selectedReason?.label || "",
                  reasonCode: selectedReason?.code || "",
                  reasonCatalogId: selectedReason?.id || "",
                  typeCatalogId: selectedType?.id || "",
                  responsibleDepartment:
                    selectedReason?.responsible_department || "Produção",
                  notes,
                  shift,
                  maintenanceRequired:
                    selectedReason?.routes_to_maintenance ?? false,
                  problemArea,
                  responsibleArea,
                  serviceOrderNumber,
                  occurrenceDate,
                  startedAt,
                  endedAt: stopWindow.endedAt,
                  durationMinutes: stopWindow.durationMinutes,
                  toolSequence,
                  billetCasing,
                  equipmentType,
                  equipmentNumber,
                  symptoms,
                  interventionPerformed,
                  dummyBlockEntered,
                  dummyBlockExited,
                  pressCount: pressCount === "" ? null : Number(pressCount),
                  dummyBlockSide,
                })
              }
              className="bg-amber-500 font-bold text-slate-950 hover:bg-amber-400"
            >
              {saving ? <Loader2 className="animate-spin" /> : <CircleStop />}
              {endTime
                ? "Registrar parada encerrada"
                : "Registrar e pausar produção"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-[9px] font-black uppercase tracking-wide text-slate-500">
      {children}
    </span>
  );
}

function CompactInput({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label>
      <FieldLabel>{label}</FieldLabel>
      <input
        aria-label={label}
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border bg-white px-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
      />
    </label>
  );
}

function CompactSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
}) {
  return (
    <label>
      <FieldLabel>{label}</FieldLabel>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border bg-white px-3 text-sm"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex h-10 items-center rounded-lg border bg-slate-100 px-3 text-sm font-semibold text-slate-700">
        <span className="truncate" title={value}>
          {value}
        </span>
      </div>
    </div>
  );
}

function localDateInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function localTimeInput(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function stopTimeWindow(date: string, startTime: string, endTime: string) {
  if (!date || !startTime) {
    return {
      startedAt: "",
      endedAt: "",
      durationMinutes: null,
      error: "Informe a data e a hora inicial.",
    };
  }
  const start = new Date(`${date}T${startTime}:00`);
  if (Number.isNaN(start.getTime())) {
    return {
      startedAt: "",
      endedAt: "",
      durationMinutes: null,
      error: "A hora inicial é inválida.",
    };
  }
  if (!endTime) {
    return {
      startedAt: start.toISOString(),
      endedAt: "",
      durationMinutes: null,
      error: "",
    };
  }
  const end = new Date(`${date}T${endTime}:00`);
  if (Number.isNaN(end.getTime())) {
    return {
      startedAt: start.toISOString(),
      endedAt: "",
      durationMinutes: null,
      error: "A hora final é inválida.",
    };
  }
  if (end.getTime() < start.getTime()) end.setDate(end.getDate() + 1);
  const durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  if (durationMinutes > 24 * 60) {
    return {
      startedAt: start.toISOString(),
      endedAt: "",
      durationMinutes: null,
      error: "O tempo total não pode ultrapassar 24 horas.",
    };
  }
  return {
    startedAt: start.toISOString(),
    endedAt: end.toISOString(),
    durationMinutes,
    error: "",
  };
}

function formatElapsed(value: number | null) {
  if (value === null) return "Em andamento";
  const minutes = Math.max(0, Math.round(value));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours
    ? `${hours}h ${String(rest).padStart(2, "0")}min`
    : `${rest} min`;
}

function MiniSummary({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-bold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p className="truncate text-xs font-bold" title={value}>
        {value}
      </p>
    </div>
  );
}

const parameterLabels: Record<string, string> = {
  "extrusion.profile_linear_weight_kg_m": "Peso linear",
  "extrusion.holes": "Número de furos",
  "extrusion.cuts_per_pull": "Cortes por tarugo",
  "extrusion.cut_length_mm": "Comprimento de corte",
  "extrusion.discard_mm": "Descarte",
  "extrusion.ram_speed_mm_s": "Velocidade",
  "extrusion.target_productivity_kg_h": "Produtividade",
  "temperatures.zone_1_c": "Temperatura zona 1",
  "temperatures.zone_2_c": "Temperatura zona 2",
  "temperatures.zone_3_c": "Temperatura zona 3",
  "temperatures.zone_4_c": "Temperatura zona 4",
  "temperatures.billet_c": "Temperatura do tarugo",
  "temperatures.container_c": "Temperatura do container",
  "temperatures.die_c": "Temperatura da ferramenta",
  "temperatures.exit_min_c": "Emergente mínima",
  "temperatures.exit_max_c": "Emergente máxima",
  "billet.calculated_length_mm": "Comprimento do tarugo",
  "billet.casing": "Carcaça",
  "billet.calculated_pull_mm": "Comprimento da puxada",
  "billet.butt_mm": "Talão",
  "pulling.puller_left_s": "Puller esquerdo",
  "pulling.puller_right_s": "Puller direito",
  "cooling.mode": "Resfriamento",
  "saw.mode": "Modo da serra",
};

function flattenParameters(parameters: Parameters) {
  const result: Record<string, unknown> = {};
  Object.entries(parameters).forEach(([section, values]) => {
    if (values && typeof values === "object")
      Object.entries(values).forEach(([key, value]) => {
        result[`${section}.${key}`] = value;
      });
  });
  return result;
}

function parameterChanges(before: Parameters, after: Parameters) {
  const previous = flattenParameters(before);
  const next = flattenParameters(after);
  return [...new Set([...Object.keys(previous), ...Object.keys(next)])]
    .filter(
      (key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key]),
    )
    .map((key) => ({
      key,
      label: parameterLabels[key] || key,
      before: previous[key],
      after: next[key],
    }));
}

function formatAuditValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "number") return value.toLocaleString("pt-BR");
  return String(value);
}

function OrderPicker({
  orders,
  selected,
  onToggle,
  onClose,
}: {
  orders: Order[];
  selected: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-11 z-30 w-[420px] rounded-xl border bg-white p-2 shadow-2xl">
      <div className="flex items-center justify-between px-2 py-1">
        <div>
          <p className="text-xs font-bold">Itens da Simplificada ativa</p>
          <p className="text-[10px] text-slate-500">
            Selecione um ou mais itens desta produção.
          </p>
        </div>
        <button onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-1 max-h-72 overflow-auto">
        {orders.map((order) => (
          <button
            key={order.id}
            onClick={() => onToggle(order.id)}
            className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-slate-50"
          >
            <span
              className={
                selected.includes(order.id)
                  ? "grid size-5 shrink-0 place-items-center rounded bg-orange-500 text-white"
                  : "size-5 shrink-0 rounded border"
              }
            >
              {selected.includes(order.id) && <Check className="size-3" />}
            </span>
            <span className="min-w-0 flex-1">
              <b className="block truncate text-xs">
                {order.order_number} · P{order.machine_code}
              </b>
              <span className="block truncate text-[10px] text-slate-500">
                {order.customer_name || "Sem cliente"} ·{" "}
                {format(
                  numeric(
                    order.demand_unit === "kg"
                      ? order.target_kg
                      : order.target_quantity,
                  ),
                  order.demand_unit === "kg" ? 1 : 0,
                )}{" "}
                {unitLabel(order.demand_unit)}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function HistoryPicker({
  orders,
  loading,
  onReopen,
  onClose,
}: {
  orders: Order[];
  loading: boolean;
  onReopen: (order: Order) => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-11 z-30 w-[440px] max-w-[calc(100vw-2rem)] rounded-xl border bg-white p-2 shadow-2xl">
      <div className="flex items-center justify-between px-2 py-1">
        <div>
          <p className="text-xs font-bold">Histórico da Simplificada</p>
          <p className="text-[10px] text-slate-500">
            Itens concluídos só retornam à fila por reprogramação explícita.
          </p>
        </div>
        <button aria-label="Fechar histórico" onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-1 max-h-72 space-y-1 overflow-auto">
        {orders.length === 0 ? (
          <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">
            Nenhum item concluído para esta ferramenta.
          </p>
        ) : (
          orders.map((order) => (
            <div
              key={order.id}
              className="flex items-center gap-3 rounded-lg border px-3 py-2"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-emerald-50 text-emerald-700">
                <SquareCheckBig className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-xs">
                  {order.order_number} · P{order.machine_code}
                </b>
                <span className="block truncate text-[10px] text-slate-500">
                  {format(numeric(order.produced_kg), 1)} kg ·{" "}
                  {format(numeric(order.produced_quantity))} peças
                  {order.completed_by_name
                    ? ` · ${order.completed_by_name}`
                    : ""}
                </span>
              </span>
              <button
                disabled={loading}
                onClick={() => onReopen(order)}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] font-bold text-orange-600 hover:bg-orange-50 disabled:opacity-50"
              >
                <RotateCcw className="size-3" /> Reprogramar
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function errorMessage(cause: unknown) {
  if (cause && typeof cause === "object") {
    const problem = cause as {
      message?: string;
      details?: string;
      hint?: string;
      code?: string;
    };
    return [problem.message, problem.details, problem.hint, problem.code]
      .filter(Boolean)
      .join(" · ");
  }
  return cause instanceof Error
    ? cause.message
    : "Não foi possível concluir a operação.";
}

function temperature(
  sheet: ProcessSheet,
  key: keyof NonNullable<Parameters["temperatures"]>,
) {
  return `${format(numeric(sheet.parameters.temperatures?.[key]))} °C`;
}
function Recipe({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-0 overflow-hidden rounded-lg border bg-slate-50/60 p-2">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-bold [&_svg]:size-3.5 [&_svg]:text-orange-500">
        {icon}
        {title}
      </div>
      <div className="grid grid-cols-4 gap-x-2 gap-y-1">{children}</div>
    </div>
  );
}
function Metric({
  label,
  value,
  accent,
  wide,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-4 min-w-0" : "min-w-0"}>
      <p className="truncate text-[9px] font-medium uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p
        className={
          accent
            ? "truncate text-xs font-extrabold leading-4 text-orange-600"
            : "truncate text-xs font-bold leading-4 text-slate-900"
        }
        title={typeof value === "string" ? value : undefined}
      >
        {value}
      </p>
    </div>
  );
}
function Result({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-slate-50 p-1.5">
      <p className="truncate text-[9px] font-bold uppercase text-slate-400">
        {label}
      </p>
      <p
        className={
          accent
            ? "mt-1 text-lg font-black text-orange-600"
            : "mt-1 text-lg font-black"
        }
      >
        {value}
      </p>
    </div>
  );
}
function statusClass(status: string) {
  const tone =
    status === "acceptable" || status === "target"
      ? "border-emerald-200 bg-emerald-50"
      : status === "excess"
        ? "border-red-200 bg-red-50"
        : "border-amber-200 bg-amber-50";
  return `flex items-center justify-between rounded-lg border p-2 ${tone}`;
}
function statusLabel(status: string) {
  return (
    {
      target: "NA META",
      acceptable: "DENTRO DA TOLERÂNCIA",
      below: "ABAIXO DO MÍNIMO",
      excess: "EXCEDENTE",
      empty: "INFORME O PEDIDO",
    } as Record<string, string>
  )[status];
}
function ProductionBand({
  result,
  target,
}: {
  result: ReturnType<typeof calculate>;
  target: number;
}) {
  const denominator = Math.max(result.maximum - result.minimum, 1);
  const marker = Math.max(
    0,
    Math.min(100, ((result.output - result.minimum) / denominator) * 100),
  );
  return (
    <div className="rounded-lg border p-2">
      <div className="flex justify-between text-[10px] font-bold">
        <span>{format(result.minimum, 1)} kg mínimo</span>
        <span className="text-orange-600">
          {format(target, 1)} kg planejado
        </span>
        <span>{format(result.maximum, 1)} kg máximo</span>
      </div>
      <div className="relative mt-2 h-2 rounded-full bg-gradient-to-r from-amber-400 via-emerald-400 to-red-400">
        <span
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-slate-900 shadow"
          style={{ left: `${marker}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-slate-400">
        <span>Abaixo</span>
        <span>Faixa aceitável</span>
        <span>Excedente</span>
      </div>
    </div>
  );
}
function PieceOptions({
  result,
  unit,
  onChoose,
}: {
  result: ReturnType<typeof calculate>;
  unit: Unit;
  onChoose: (value: number) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <button
        onClick={() => onChoose(result.lower)}
        className={
          result.billets === result.lower
            ? "rounded-lg border-2 border-orange-400 bg-orange-50 p-2 text-left"
            : "rounded-lg border p-2 text-left"
        }
      >
        <p className="text-[9px] font-bold uppercase text-slate-400">
          Sem excedente
        </p>
        <p className="mt-1 text-sm font-black">
          {result.lower} tarugos → {format(result.lowerOutput)}{" "}
          {unitLabel(unit)}
        </p>
        <p className="text-[9px] text-amber-700">
          Faltam {format(Math.max(0, result.maximum - result.lowerOutput))}
        </p>
      </button>
      <button
        onClick={() => onChoose(result.upper)}
        className={
          result.billets === result.upper
            ? "rounded-lg border-2 border-orange-400 bg-orange-50 p-2 text-left"
            : "rounded-lg border p-2 text-left"
        }
      >
        <p className="text-[9px] font-bold uppercase text-slate-400">
          Próxima possibilidade
        </p>
        <p className="mt-1 text-sm font-black">
          {result.upper} tarugos → {format(result.upperOutput)}{" "}
          {unitLabel(unit)}
        </p>
        <p className="text-[9px] text-red-700">
          Excedente {format(Math.max(0, result.upperOutput - result.maximum))}
        </p>
      </button>
    </div>
  );
}
