"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRightLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Clock3,
  Flame,
  Loader2,
  LayoutGrid,
  List,
  PackageSearch,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  TimerReset,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";
import { requestOfflineSync } from "@/lib/offline-store";
import { cn } from "@/lib/utils";
import { useCurrentUser } from "@/components/current-user-provider";

type SourceData = { entradaForno?: string; saidaForno?: string; item?: string; sequencia?: string; departamento?: string };
type HeatingOrder = {
  id: string; order_number: string; plan_code: string | null; machine_code: string;
  tool_code: string; customer_name: string | null; target_kg: number | null;
  target_quantity: number | null; demand_unit: "kg" | "pieces" | "bars";
  status: string; is_active: boolean; due_date: string | null; source_data: SourceData;
  import_batch_id: string | null;
};
type CycleOrderLink = { production_order_id: string; production_orders: HeatingOrder | null };
type HeatingCycle = {
  id: string; import_batch_id: string | null; machine_code: string; tool_code: string;
  oven_code: string | null; oven_id: string | null; oven_position: number | null;
  tool_type: "solid" | "tubular" | null; target_temperature_c: number | null;
  maximum_due_at: string; status: "heating" | "released" | "cancelled";
  required_minutes: number; entered_at: string; expected_ready_at: string;
  released_at: string | null; entered_by_name: string; released_by_name: string | null;
  released_early: boolean; actual_heating_minutes: number | null;
  notes: string | null; release_notes: string | null; tool_heating_cycle_orders: CycleOrderLink[];
};
type ToolGroup = { key: string; tool: string; machine: string; importId: string | null; orders: HeatingOrder[] };
type ToolOven = {
  id: string; machine_code: string; code: string; name: string; position_count: number;
  solid_minimum_minutes: number; tubular_minimum_minutes: number;
  maximum_minutes: number; solid_target_temperature_c: number;
  tubular_target_temperature_c: number; is_active: boolean;
};

const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
const orderFields = "id,import_batch_id,order_number,plan_code,machine_code,tool_code,customer_name,target_kg,target_quantity,demand_unit,status,is_active,due_date,source_data";
const WAITING_PAGE_SIZE = 5;
const HEATING_PAGE_SIZE = 2;
const RELEASED_PAGE_SIZE = 5;

function errorMessage(value: unknown) {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.message || record.details || record.hint || "Não foi possível concluir a operação.");
  }
  return "Não foi possível concluir a operação.";
}
function machineLabel(value: string) { return value === "18" ? "1.8" : value === "19" ? "1.9" : value; }
function clock(value?: string | null) {
  return value ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—";
}
function duration(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours ? `${hours}h ` : ""}${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}
function orderDemand(order: HeatingOrder) {
  if (order.demand_unit === "kg") return `${Number(order.target_kg || 0).toLocaleString("pt-BR")} kg`;
  return `${Number(order.target_quantity || 0).toLocaleString("pt-BR")} ${order.demand_unit === "bars" ? "barras" : "peças"}`;
}
function inferredToolType(orders: HeatingOrder[]): "solid" | "tubular" {
  return orders.some((order) => /tub/i.test(order.source_data?.departamento || ""))
    ? "tubular"
    : "solid";
}

export function ToolOvenBoard() {
  const { display_name: operatorName, role, machine_codes: userMachineCodes } = useCurrentUser();
  const canPlan = role === "admin" || role === "pcp";
  const allowedMachines = useMemo(() => canPlan || !userMachineCodes?.length ? null : new Set(userMachineCodes), [canPlan, userMachineCodes]);
  const [orders, setOrders] = useState<HeatingOrder[]>([]);
  const [cycles, setCycles] = useState<HeatingCycle[]>([]);
  const [ovens, setOvens] = useState<ToolOven[]>([]);
  const [query, setQuery] = useState("");
  const [machineFilter, setMachineFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [now, setNow] = useState(0);
  const [selected, setSelected] = useState<ToolGroup | null>(null);
  const [ovenId, setOvenId] = useState("");
  const [ovenPosition, setOvenPosition] = useState("");
  const [targetMachine, setTargetMachine] = useState("");
  const [toolType, setToolType] = useState<"solid" | "tubular">("solid");
  const [notes, setNotes] = useState("");
  const [dialogProblem, setDialogProblem] = useState("");
  const [releaseCycle, setReleaseCycle] = useState<HeatingCycle | null>(null);
  const [releaseReason, setReleaseReason] = useState("");
  const [cancelCycle, setCancelCycle] = useState<HeatingCycle | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [relocateCycle, setRelocateCycle] = useState<HeatingCycle | null>(null);
  const [relocateMachine, setRelocateMachine] = useState("");
  const [relocateOvenId, setRelocateOvenId] = useState("");
  const [relocatePosition, setRelocatePosition] = useState("");
  const [relocateReason, setRelocateReason] = useState("");
  const [waitingPage, setWaitingPage] = useState(1);
  const [heatingPage, setHeatingPage] = useState(1);
  const [releasedPage, setReleasedPage] = useState(1);
  const [visibleStages, setVisibleStages] = useState({ waiting: true, heating: true, released: true });
  const [collapsedStages, setCollapsedStages] = useState({ waiting: false, heating: false, released: false });
  const [boardView, setBoardView] = useState<"cards" | "map">("cards");

  const load = useCallback(async (silent = false) => {
    if (!organizationId) return;
    if (!silent) setLoading(true);
    try {
      const supabase = createClient();
      const [{ data: orderData, error: orderError }, { data: cycleData, error: cycleError }, { data: ovenData, error: ovenError }] = await Promise.all([
        supabase.from("production_orders").select(`${orderFields},simplified_imports!inner(id,is_active,status,deleted_at)`).eq("organization_id", organizationId).eq("is_active", true).in("status", ["planned", "released", "paused"]).eq("simplified_imports.is_active", true).eq("simplified_imports.status", "processed").is("simplified_imports.deleted_at", null).order("sequence").limit(1000),
        supabase.from("tool_heating_cycles").select(`id,import_batch_id,machine_code,tool_code,oven_code,oven_id,oven_position,tool_type,target_temperature_c,maximum_due_at,status,required_minutes,entered_at,expected_ready_at,released_at,entered_by_name,released_by_name,released_early,actual_heating_minutes,notes,release_notes,tool_heating_cycle_orders(production_order_id,production_orders(${orderFields}))`).eq("organization_id", organizationId).in("status", ["heating", "released"]).order("entered_at", { ascending: false }).limit(200),
        supabase.from("tool_ovens").select("id,machine_code,code,name,position_count,solid_minimum_minutes,tubular_minimum_minutes,maximum_minutes,solid_target_temperature_c,tubular_target_temperature_c,is_active").eq("organization_id", organizationId).eq("is_active", true).order("machine_code").order("code"),
      ]);
      if (orderError) throw orderError;
      if (cycleError) throw cycleError;
      if (ovenError) throw ovenError;
      setOrders((orderData ?? []) as unknown as HeatingOrder[]);
      setCycles((cycleData ?? []) as unknown as HeatingCycle[]);
      setOvens((ovenData ?? []) as ToolOven[]);
      setMessage("");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { if (!silent) setLoading(false); }
  }, [setMessage]);

  useEffect(() => { const initialLoad = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initialLoad); }, [load]);
  useEffect(() => { const tick = () => setNow(Date.now()); const initialTick = window.setTimeout(tick, 0); const timer = window.setInterval(tick, 1000); return () => { window.clearTimeout(initialTick); window.clearInterval(timer); }; }, []);
  useEffect(() => { const timer = window.setInterval(() => void load(true), 15000); return () => window.clearInterval(timer); }, [load]);

  const linkedOrderIds = useMemo(() => new Set(cycles.flatMap((cycle) => cycle.tool_heating_cycle_orders.map((link) => link.production_order_id))), [cycles]);
  const effectiveMachineFilter = machineFilter && (!allowedMachines || allowedMachines.has(machineFilter)) ? machineFilter : "";
  const available = useMemo(() => {
    const grouped = new Map<string, ToolGroup>();
    for (const order of orders) {
      if (linkedOrderIds.has(order.id)) continue;
      // A mesma ferramenta pode atender mais de uma Simplificada ativa na mesma campanha.
      const key = `${order.machine_code}|${order.tool_code.toUpperCase()}`;
      const current = grouped.get(key) ?? { key, tool: order.tool_code, machine: order.machine_code, importId: order.import_batch_id, orders: [] };
      current.orders.push(order); grouped.set(key, current);
    }
    const normalized = query.trim().toUpperCase();
    return [...grouped.values()].filter((group) =>
      (!effectiveMachineFilter || group.machine === effectiveMachineFilter) && (!allowedMachines || allowedMachines.has(group.machine)) &&
      (!normalized || `${group.tool} ${group.machine} ${group.orders.map((order) => `${order.plan_code} ${order.customer_name}`).join(" ")}`.toUpperCase().includes(normalized))
    );
  }, [orders, linkedOrderIds, query, effectiveMachineFilter, allowedMachines]);
  const heatingAll = cycles.filter((cycle) => cycle.status === "heating");
  const heating = heatingAll.filter((cycle) => (!effectiveMachineFilter || cycle.machine_code === effectiveMachineFilter) && (!allowedMachines || allowedMachines.has(cycle.machine_code)));
  const released = cycles.filter((cycle) => (!effectiveMachineFilter || cycle.machine_code === effectiveMachineFilter) && (!allowedMachines || allowedMachines.has(cycle.machine_code)) && cycle.status === "released" && cycle.tool_heating_cycle_orders.some((link) => link.production_orders?.is_active && ["planned", "released", "paused"].includes(link.production_orders.status)));
  const visibleOvens = ovens.filter((oven) => (!effectiveMachineFilter || oven.machine_code === effectiveMachineFilter) && (!allowedMachines || allowedMachines.has(oven.machine_code)));
  const visibleCapacity = visibleOvens.reduce((total, oven) => total + oven.position_count, 0);
  const entryOvens = ovens.filter((oven) => oven.machine_code === targetMachine && (!allowedMachines || allowedMachines.has(oven.machine_code)));
  const selectedOven = ovens.find((oven) => oven.id === ovenId);
  const occupiedPositionMap = new Map(heatingAll.filter((cycle) => cycle.oven_id === ovenId).map((cycle) => [cycle.oven_position, cycle]));
  const allPositions = selectedOven ? Array.from({ length: selectedOven.position_count }, (_, index) => index + 1) : [];
  const relocateOven = ovens.find((oven) => oven.id === relocateOvenId);
  const relocateOvens = ovens.filter((oven) => oven.machine_code === relocateMachine && (!allowedMachines || allowedMachines.has(oven.machine_code)));
  const relocateOccupiedMap = new Map(heatingAll.filter((cycle) => cycle.oven_id === relocateOvenId && cycle.id !== relocateCycle?.id).map((cycle) => [cycle.oven_position, cycle]));
  const relocatePositions = relocateOven ? Array.from({ length: relocateOven.position_count }, (_, index) => index + 1) : [];
  const waitingPages = Math.max(1, Math.ceil(available.length / WAITING_PAGE_SIZE));
  const heatingPages = Math.max(1, Math.ceil(heating.length / HEATING_PAGE_SIZE));
  const releasedPages = Math.max(1, Math.ceil(released.length / RELEASED_PAGE_SIZE));
  const visibleAvailable = available.slice((Math.min(waitingPage, waitingPages) - 1) * WAITING_PAGE_SIZE, Math.min(waitingPage, waitingPages) * WAITING_PAGE_SIZE);
  const visibleHeating = heating.slice((Math.min(heatingPage, heatingPages) - 1) * HEATING_PAGE_SIZE, Math.min(heatingPage, heatingPages) * HEATING_PAGE_SIZE);
  const visibleReleased = released.slice((Math.min(releasedPage, releasedPages) - 1) * RELEASED_PAGE_SIZE, Math.min(releasedPage, releasedPages) * RELEASED_PAGE_SIZE);
  const visibleStageCount = boardView === "map"
    ? Number(visibleStages.waiting) + Number(visibleStages.heating || visibleStages.released)
    : Object.values(visibleStages).filter(Boolean).length;
  const boardGridClass = visibleStageCount === 1 ? "xl:grid-cols-1" : visibleStageCount === 2 ? "xl:grid-cols-2" : "xl:grid-cols-3";
  function toggleStage(stage: keyof typeof visibleStages) {
    setVisibleStages((current) => {
      const next = { ...current, [stage]: !current[stage] };
      return Object.values(next).some(Boolean) ? next : current;
    });
  }

  async function startHeating() {
    const position = Number(ovenPosition);
    if (!selected || !ovenId || !Number.isInteger(position) || !targetMachine) { setDialogProblem("Selecione prensa, forno e uma posição livre."); return; }
    if (occupiedPositionMap.has(position)) { setDialogProblem("Esta vaga está ocupada. A ferramenta atual precisa sair ou ser realocada primeiro."); return; }
    setSaving(true);
    try {
      const { error } = await createClient().rpc("start_tool_heating", { p_order_ids: selected.orders.map((order) => order.id), p_actor: operatorName, p_oven_id: ovenId, p_oven_position: position, p_tool_type: toolType, p_target_machine: targetMachine, p_notes: notes.trim() || null });
      if (error) throw error;
      setSelected(null); setOvenId(""); setOvenPosition(""); setTargetMachine(""); setNotes(""); setDialogProblem("");
      setMessage(`${selected.tool} entrou no forno. O contador já está em andamento.`);
      requestOfflineSync(); await load();
    } catch (error) { setDialogProblem(errorMessage(error)); await load(true); }
    finally { setSaving(false); }
  }
  async function release() {
    if (!releaseCycle) return;
    const early = now < new Date(releaseCycle.expected_ready_at).getTime();
    if (early && releaseReason.trim().length < 8) {
      setDialogProblem("Explique o motivo da retirada antecipada com pelo menos 8 caracteres.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await createClient().rpc("release_tool_heating", { p_cycle_id: releaseCycle.id, p_actor: operatorName, p_notes: releaseReason.trim() || null });
      if (error) throw error;
      const tool = releaseCycle.tool_code;
      setReleaseCycle(null); setReleaseReason(""); setDialogProblem("");
      setMessage(early ? `${tool} liberada antecipadamente. A justificativa foi registrada.` : `${tool} liberada para abrir a ficha e produzir.`);
      requestOfflineSync(); await load();
    } catch (error) { setDialogProblem(errorMessage(error)); }
    finally { setSaving(false); }
  }
  async function cancel() {
    if (!cancelCycle || cancelReason.trim().length < 4) { setMessage("Informe o motivo do cancelamento."); return; }
    setSaving(true);
    try {
      const { error } = await createClient().rpc("cancel_tool_heating", { p_cycle_id: cancelCycle.id, p_actor: operatorName, p_reason: cancelReason.trim() });
      if (error) throw error;
      setCancelCycle(null); setCancelReason(""); setMessage("Aquecimento cancelado e ferramenta devolvida à fila."); await load();
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setSaving(false); }
  }
  function openRelocate(cycle: HeatingCycle) {
    setRelocateCycle(cycle); setRelocateMachine(cycle.machine_code);
    setRelocateOvenId(cycle.oven_id || ""); setRelocatePosition(String(cycle.oven_position || ""));
    setRelocateReason(""); setDialogProblem("");
  }
  async function relocate() {
    if (!relocateCycle || !relocateMachine || relocateReason.trim().length < 4) { setDialogProblem("Selecione a prensa e informe o motivo da alteração."); return; }
    const position = Number(relocatePosition);
    if (relocateCycle.status === "heating" && (!relocateOvenId || !Number.isInteger(position))) { setDialogProblem("Selecione o forno e uma posição livre."); return; }
    if (relocateCycle.status === "heating" && relocateOccupiedMap.has(position)) { setDialogProblem("Esta vaga está ocupada. Escolha uma posição livre."); return; }
    setSaving(true);
    try {
      const { error } = await createClient().rpc("reallocate_tool_heating", {
        p_cycle_id: relocateCycle.id, p_target_machine: relocateMachine,
        p_oven_id: relocateCycle.status === "heating" ? relocateOvenId : null,
        p_oven_position: relocateCycle.status === "heating" ? position : null,
        p_actor: operatorName, p_reason: relocateReason.trim(),
      });
      if (error) throw error;
      const movedTool = relocateCycle.tool_code;
      setRelocateCycle(null); setRelocateReason(""); setDialogProblem("");
      setMessage(`${movedTool} realocada com sucesso. O histórico foi preservado.`);
      requestOfflineSync(); await load();
    } catch (error) { setDialogProblem(errorMessage(error)); await load(true); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-3 md:-my-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div><div className="flex items-center gap-2"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-orange-600">Produção · preparação</p><span className="hidden items-center text-xs text-slate-400 sm:inline-flex">Simplificada <ChevronRight className="size-3.5" /> aquecimento <ChevronRight className="size-3.5" /> produção</span></div><h1 className="mt-0.5 font-heading text-2xl font-bold text-slate-950">Forno de ferramentas</h1></div>
        <div className="flex items-center gap-2"><select value={effectiveMachineFilter} onChange={(event) => { setMachineFilter(event.target.value); setWaitingPage(1); setHeatingPage(1); setReleasedPage(1); }} className="h-9 rounded-lg border bg-white px-3 text-sm font-semibold"><option value="">{allowedMachines ? "Minhas prensas" : "Todas as prensas"}</option>{["18", "19"].filter((code) => !allowedMachines || allowedMachines.has(code)).map((code) => <option key={code} value={code}>{machineLabel(code)}</option>)}</select><button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border bg-white px-2.5 text-sm font-medium transition hover:bg-slate-100 disabled:pointer-events-none disabled:opacity-50"><RefreshCw className={cn("size-4", loading && "animate-spin")} />Atualizar</button></div>
      </header>
      {message && <div className={cn("rounded-lg border px-3 py-2 text-sm", /não|falha|erro|ainda/i.test(message) ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800")}>{message}</div>}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-semibold text-slate-500">Exibir etapas</p>
          <div className="flex flex-wrap gap-1.5">
            <StageToggle active={visibleStages.waiting} tone="slate" onClick={() => toggleStage("waiting")}>Aguardando <span>{available.length}</span></StageToggle>
            <StageToggle active={visibleStages.heating} tone="orange" onClick={() => toggleStage("heating")}>Aquecendo <span>{heating.length}</span></StageToggle>
            <StageToggle active={visibleStages.released} tone="green" onClick={() => toggleStage("released")}>Liberadas <span>{released.length}</span></StageToggle>
          </div>
        </div>
        <div className="flex items-center rounded-lg bg-slate-100 p-0.5">
          <button type="button" onClick={() => setBoardView("cards")} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-bold transition", boardView === "cards" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}><List className="size-3.5" />Cards</button>
          <button type="button" onClick={() => setBoardView("map")} className={cn("inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-bold transition", boardView === "map" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800")}><LayoutGrid className="size-3.5" />Mapa do forno</button>
        </div>
      </div>

      <div className={cn("grid min-w-0 gap-3", boardGridClass)}>
        {visibleStages.waiting && <BoardColumn title="1. Aguardando" subtitle="Simplificadas ativas" icon={<PackageSearch className="size-4" />} value={available.length} detail="para o forno" collapsed={collapsedStages.waiting} onToggle={() => setCollapsedStages((current) => ({ ...current, waiting: !current.waiting }))}>
          <div className="relative mb-2"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => { setQuery(event.target.value); setWaitingPage(1); }} placeholder="Ferramenta, Plano ou cliente" className="h-9 pl-9" /></div>
          {loading ? <Loading /> : available.length ? visibleAvailable.map((group) => <AvailableCard key={group.key} group={group} onChoose={() => { setSelected(group); setToolType(inferredToolType(group.orders)); setTargetMachine(group.machine); setOvenId(""); setOvenPosition(""); setMessage(""); setDialogProblem(""); }} />) : <Empty text="Nenhuma ferramenta aguardando forno." />}
          <Pager page={Math.min(waitingPage, waitingPages)} pages={waitingPages} onChange={setWaitingPage} />
        </BoardColumn>}
        {boardView === "cards" && visibleStages.heating && <BoardColumn title="2. Aquecendo" subtitle="Contagem em tempo real" icon={<Flame className="size-4 text-orange-600" />} value={heating.length} detail={`${Math.max(0, visibleCapacity - heating.length)} vagas livres`} tone="orange" collapsed={collapsedStages.heating} onToggle={() => setCollapsedStages((current) => ({ ...current, heating: !current.heating }))}>
          {heating.length ? visibleHeating.map((cycle) => <HeatingCard key={cycle.id} cycle={cycle} now={now} saving={saving} onRelease={() => { setReleaseCycle(cycle); setReleaseReason(""); setDialogProblem(""); }} onCancel={() => { setCancelCycle(cycle); setCancelReason(""); }} onRelocate={() => openRelocate(cycle)} />) : <Empty text="Nenhuma ferramenta no forno." />}
          <Pager page={Math.min(heatingPage, heatingPages)} pages={heatingPages} onChange={setHeatingPage} />
        </BoardColumn>}
        {boardView === "cards" && visibleStages.released && <BoardColumn title="3. Liberadas" subtitle="Prontas para produzir" icon={<CheckCircle2 className="size-4 text-emerald-600" />} value={released.length} detail="aguardando produção" tone="green" collapsed={collapsedStages.released} onToggle={() => setCollapsedStages((current) => ({ ...current, released: !current.released }))}>
          {released.length ? visibleReleased.map((cycle) => <ReleasedCard key={cycle.id} cycle={cycle} onRelocate={() => openRelocate(cycle)} />) : <Empty text="Nenhuma ferramenta liberada aguardando produção." />}
          <Pager page={Math.min(releasedPage, releasedPages)} pages={releasedPages} onChange={setReleasedPage} />
        </BoardColumn>}
      </div>
      {boardView === "map" && (visibleStages.heating || visibleStages.released) && <OvenMap ovens={visibleOvens} heating={visibleStages.heating ? heating : []} released={visibleStages.released ? released : []} now={now} onRelease={(cycle) => { setReleaseCycle(cycle); setReleaseReason(""); setDialogProblem(""); }} onRelocate={openRelocate} />}

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>Entrada da ferramenta no forno</DialogTitle><DialogDescription>{selected?.tool} · Prensa {machineLabel(selected?.machine || "")} · {selected?.orders.length || 0} item(ns) vinculados</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <div><span className="text-sm font-semibold">Tipo da ferramenta</span><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => setToolType("solid")} className={cn("rounded-xl border px-3 py-2 text-sm font-bold", toolType === "solid" ? "border-orange-500 bg-orange-50 text-orange-700" : "bg-white")}>Sólida · 400 °C</button><button type="button" onClick={() => setToolType("tubular")} className={cn("rounded-xl border px-3 py-2 text-sm font-bold", toolType === "tubular" ? "border-orange-500 bg-orange-50 text-orange-700" : "bg-white")}>Tubular · 420 °C</button></div></div>
            <label className="block text-sm font-semibold">Prensa de destino<select value={targetMachine} onChange={(event) => { setTargetMachine(event.target.value); setOvenId(""); setOvenPosition(""); setDialogProblem(""); }} className="mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm">{["18", "19"].filter((code) => !allowedMachines || allowedMachines.has(code)).map((code) => <option key={code} value={code}>{machineLabel(code)}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">Cada prensa possui 3 fornos próprios, com 7 vagas em cada um.</span></label>
            <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-semibold">Forno da Prensa {machineLabel(targetMachine)}<select value={ovenId} onChange={(event) => { setOvenId(event.target.value); setOvenPosition(""); setDialogProblem(""); }} className="mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm" autoFocus><option value="">Selecione</option>{entryOvens.map((oven) => <option key={oven.id} value={oven.id}>{oven.name}</option>)}</select></label><label className="block text-sm font-semibold">Posição<select value={ovenPosition} onChange={(event) => { setOvenPosition(event.target.value); setDialogProblem(""); }} disabled={!ovenId} className="mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-slate-100"><option value="">Selecione</option>{allPositions.map((position) => { const occupant = occupiedPositionMap.get(position); return <option key={position} value={position} disabled={!!occupant}>Posição {position}{occupant ? ` — OCUPADA: ${occupant.tool_code} · P${machineLabel(occupant.machine_code)}` : " — livre"}</option>; })}</select></label></div>
            <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><ShieldAlert className="mt-0.5 size-4 shrink-0" /><span><b>Uma ferramenta por vaga.</b> A posição só fica livre após retirar ou realocar a ferramenta anterior.</span></div>
            {ovenId && allPositions.length > 0 && allPositions.every((position) => occupiedPositionMap.has(position)) && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">Este forno está lotado. Escolha outro forno ou realoque uma ferramenta.</p>}
            <div className="grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-center text-xs"><Time label="Mínimo" value="4 horas" /><Time label="Máximo" value="24 horas" /><Time label="Temperatura" value={`${toolType === "tubular" ? selectedOven?.tubular_target_temperature_c ?? 420 : selectedOven?.solid_target_temperature_c ?? 400} °C`} /></div>
            <label className="block text-sm font-semibold">Observação <span className="font-normal text-slate-400">(opcional)</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-500" /></label>
            {selected && <PlannedTimes orders={selected.orders} />}
            {dialogProblem && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{dialogProblem}</p>}
          </div><DialogFooter><Button variant="outline" onClick={() => setSelected(null)}>Cancelar</Button><Button onClick={() => void startHeating()} disabled={saving || !ovenId || !ovenPosition}><Flame />{saving ? "Registrando..." : "Registrar entrada"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!releaseCycle} onOpenChange={(open) => { if (!open) { setReleaseCycle(null); setReleaseReason(""); setDialogProblem(""); } }}>
        <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{releaseCycle && now < new Date(releaseCycle.expected_ready_at).getTime() ? "Liberar antes do tempo mínimo?" : "Liberar ferramenta para produção"}</DialogTitle><DialogDescription>{releaseCycle?.tool_code} · Prensa {machineLabel(releaseCycle?.machine_code || "")} · {releaseCycle?.oven_code} / posição {releaseCycle?.oven_position}</DialogDescription></DialogHeader>
          {releaseCycle && now < new Date(releaseCycle.expected_ready_at).getTime() ? <div className="space-y-3"><div className="flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" /><div><p className="font-bold">A ferramenta ainda não completou as 4 horas.</p><p className="mt-1 text-xs">Faltam {duration(new Date(releaseCycle.expected_ready_at).getTime() - now)}. A retirada antecipada pode afetar a estabilidade do processo e ficará registrada na auditoria.</p></div></div><label className="block text-sm font-semibold">Justificativa obrigatória<textarea value={releaseReason} onChange={(event) => { setReleaseReason(event.target.value); setDialogProblem(""); }} rows={3} placeholder="Ex.: retirada para liberar a vaga e atender produção prioritária" className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-orange-500" autoFocus /><span className="mt-1 block text-xs font-normal text-slate-500">Responsável: {operatorName} · o horário e o tempo aquecido serão salvos automaticamente.</span></label></div> : <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900"><p className="font-bold">Tempo mínimo atingido.</p><p className="mt-1 text-xs">Ao confirmar, a vaga será liberada e a ferramenta ficará disponível para iniciar a produção.</p></div>}
          {dialogProblem && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{dialogProblem}</p>}
          <DialogFooter><Button variant="outline" onClick={() => setReleaseCycle(null)}>Voltar</Button><Button onClick={() => void release()} disabled={saving || (!!releaseCycle && now < new Date(releaseCycle.expected_ready_at).getTime() && releaseReason.trim().length < 8)}><CheckCircle2 />{saving ? "Liberando..." : releaseCycle && now < new Date(releaseCycle.expected_ready_at).getTime() ? "Confirmar antecipação" : "Liberar para produção"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!cancelCycle} onOpenChange={(open) => !open && setCancelCycle(null)}>
        <DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Cancelar aquecimento</DialogTitle><DialogDescription>Esta ação devolve a ferramenta à fila e fica registrada no histórico.</DialogDescription></DialogHeader><label className="text-sm font-semibold">Motivo<Input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Explique o motivo" className="mt-1" autoFocus /></label><DialogFooter><Button variant="outline" onClick={() => setCancelCycle(null)}>Voltar</Button><Button variant="destructive" onClick={() => void cancel()} disabled={saving}>Confirmar cancelamento</Button></DialogFooter></DialogContent>
      </Dialog>

      <Dialog open={!!relocateCycle} onOpenChange={(open) => { if (!open) { setRelocateCycle(null); setDialogProblem(""); } }}>
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{relocateCycle?.status === "heating" ? "Realocar ferramenta" : "Alterar prensa de produção"}</DialogTitle><DialogDescription>{relocateCycle?.tool_code} · origem P{machineLabel(relocateCycle?.machine_code || "")}. A alteração fica registrada com usuário, data, origem, destino e motivo.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-2">
            <label className="block text-sm font-semibold">Prensa de destino<select value={relocateMachine} onChange={(event) => { setRelocateMachine(event.target.value); setRelocateOvenId(""); setRelocatePosition(""); setDialogProblem(""); }} className="mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm"><option value="18">Prensa 1.8</option><option value="19">Prensa 1.9</option></select></label>
            {relocateCycle?.status === "heating" && <><div className="grid grid-cols-2 gap-3"><label className="block text-sm font-semibold">Forno da Prensa {machineLabel(relocateMachine)}<select value={relocateOvenId} onChange={(event) => { setRelocateOvenId(event.target.value); setRelocatePosition(""); setDialogProblem(""); }} className="mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm"><option value="">Selecione</option>{relocateOvens.map((oven) => <option key={oven.id} value={oven.id}>{oven.name}</option>)}</select></label><label className="block text-sm font-semibold">Posição<select value={relocatePosition} onChange={(event) => { setRelocatePosition(event.target.value); setDialogProblem(""); }} disabled={!relocateOvenId} className="mt-1 h-10 w-full rounded-xl border bg-white px-3 text-sm disabled:bg-slate-100"><option value="">Selecione</option>{relocatePositions.map((position) => { const occupant = relocateOccupiedMap.get(position); return <option key={position} value={position} disabled={!!occupant}>Posição {position}{occupant ? ` — OCUPADA: ${occupant.tool_code} · P${machineLabel(occupant.machine_code)}` : " — livre"}</option>; })}</select></label></div><div className="flex gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800"><TimerReset className="mt-0.5 size-4 shrink-0" /><span><b>O relógio não será reiniciado.</b> Entrada, liberação mínima e limite de 24 horas permanecem os mesmos.</span></div></>}
            <label className="block text-sm font-semibold">Motivo da alteração<Input value={relocateReason} onChange={(event) => setRelocateReason(event.target.value)} placeholder="Ex.: indisponibilidade da prensa 1.8" className="mt-1" /></label>
            {dialogProblem && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{dialogProblem}</p>}
          </div><DialogFooter><Button variant="outline" onClick={() => setRelocateCycle(null)}>Cancelar</Button><Button onClick={() => void relocate()} disabled={saving || !relocateMachine || relocateReason.trim().length < 4 || (relocateCycle?.status === "heating" && (!relocateOvenId || !relocatePosition))}><ArrowRightLeft />{saving ? "Salvando..." : "Confirmar realocação"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function OvenMap({ ovens, heating, released, now, onRelease, onRelocate }: { ovens: ToolOven[]; heating: HeatingCycle[]; released: HeatingCycle[]; now: number; onRelease: (cycle: HeatingCycle) => void; onRelocate: (cycle: HeatingCycle) => void }) {
  const cycles = [...heating, ...released];
  return <section className="rounded-2xl border bg-white p-3 shadow-sm">
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-heading text-sm font-bold text-slate-900">Mapa do forno</h2><p className="text-[11px] text-slate-500">Visão rápida das vagas ocupadas e livres. Selecione uma vaga ocupada para agir.</p></div><div className="flex items-center gap-3 text-[10px] font-semibold text-slate-500"><span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-orange-500" />Aquecendo</span><span className="inline-flex items-center gap-1"><i className="size-2 rounded-full bg-emerald-500" />Liberada</span><span className="inline-flex items-center gap-1"><i className="size-2 rounded-full border border-slate-300 bg-white" />Livre</span></div></div>
    {ovens.length ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{ovens.map((oven) => {
      const ovenCycles = cycles.filter((cycle) => cycle.oven_id === oven.id);
      const byPosition = new Map(ovenCycles.map((cycle) => [cycle.oven_position, cycle]));
      return <div key={oven.id} className="rounded-xl border bg-slate-50/70 p-2.5"><div className="mb-2 flex items-center justify-between"><div><p className="text-xs font-black text-slate-900">{oven.name}</p><p className="text-[10px] text-slate-500">Prensa {machineLabel(oven.machine_code)} · {ovenCycles.length}/{oven.position_count} ocupadas</p></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-slate-500">{oven.position_count - ovenCycles.length} livres</span></div><div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{Array.from({ length: oven.position_count }, (_, index) => index + 1).map((position) => { const cycle = byPosition.get(position); if (!cycle) return <div key={position} className="flex min-h-16 flex-col justify-between rounded-lg border border-dashed border-slate-200 bg-white p-2"><span className="text-[9px] font-bold text-slate-400">Vaga {position}</span><span className="text-[10px] text-slate-400">Livre</span></div>; const isHeating = cycle.status === "heating"; const ready = isHeating && now >= new Date(cycle.expected_ready_at).getTime(); return <button key={position} type="button" onClick={() => isHeating ? onRelease(cycle) : onRelocate(cycle)} className={cn("min-h-16 rounded-lg border p-2 text-left transition hover:-translate-y-0.5 hover:shadow-sm", isHeating ? ready ? "border-emerald-200 bg-emerald-50" : "border-orange-200 bg-orange-50" : "border-emerald-200 bg-emerald-50/80")} title={isHeating ? "Abrir opções de liberação" : "Abrir opções da ferramenta liberada"}><div className="flex items-start justify-between gap-1"><span className="text-[9px] font-bold text-slate-500">Vaga {position}</span><span className={cn("size-2 rounded-full", isHeating ? ready ? "bg-emerald-500" : "bg-orange-500" : "bg-emerald-500")} /></div><p className="mt-1 truncate font-mono text-xs font-black text-slate-900">{cycle.tool_code}</p><p className="truncate text-[9px] text-slate-500">{isHeating ? ready ? "Pronta" : duration(new Date(cycle.expected_ready_at).getTime() - now) : "Liberada"}</p></button>; })}</div></div>;
    })}</div> : <Empty text="Nenhum forno cadastrado para esta prensa." />}
    <p className="mt-3 text-[10px] text-slate-400">Clique em uma vaga aquecendo para liberar/justificar, ou em uma vaga liberada para realocar a ferramenta.</p>
  </section>;
}

function BoardColumn({ title, subtitle, icon, value, detail, tone = "slate", children, collapsed = false, onToggle }: { title: string; subtitle: string; icon: React.ReactNode; value: number; detail: string; tone?: "slate" | "orange" | "green"; children: React.ReactNode; collapsed?: boolean; onToggle?: () => void }) {
  return <section className={cn("min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm", collapsed && "self-start")}><header className="flex min-h-14 items-center justify-between gap-2 border-b px-3 py-2"><div className="flex min-w-0 items-center gap-2"><span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", tone === "orange" ? "bg-orange-50" : tone === "green" ? "bg-emerald-50" : "bg-slate-50")}>{icon}</span><div className="min-w-0"><h2 className="truncate font-heading text-sm font-bold text-slate-900">{title}</h2><p className="truncate text-[11px] text-slate-500">{subtitle}</p></div></div><div className="flex shrink-0 items-center gap-2 text-right"><div><p className={cn("text-xl font-black leading-none", tone === "orange" ? "text-orange-600" : tone === "green" ? "text-emerald-600" : "text-slate-950")}>{value}</p><p className="mt-0.5 text-[9px] text-slate-400">{detail}</p></div>{onToggle && <button type="button" onClick={onToggle} className="grid size-7 place-items-center rounded-lg border text-slate-500 transition hover:bg-slate-50" aria-label={collapsed ? `Expandir ${title}` : `Recolher ${title}`}>{collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}</button>}</div></header>{!collapsed && <div className="space-y-2 p-3">{children}</div>}</section>;
}
function StageToggle({ active, tone, onClick, children }: { active: boolean; tone: "slate" | "orange" | "green"; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={cn("inline-flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition", active ? tone === "orange" ? "border-orange-300 bg-orange-50 text-orange-700" : tone === "green" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-slate-100 text-slate-800" : "border-slate-200 bg-white text-slate-400 hover:bg-slate-50")}>{children}</button>;
}
function AvailableCard({ group, onChoose }: { group: ToolGroup; onChoose: () => void }) {
  const plans = [...new Set(group.orders.map((order) => order.plan_code).filter(Boolean))];
  const customers = [...new Set(group.orders.map((order) => order.customer_name).filter(Boolean))];
  return <article className="group rounded-xl border px-3 py-2.5 transition hover:border-orange-300 hover:bg-orange-50/30"><div className="flex items-center gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate font-mono text-base font-black text-orange-600">{group.tool}</p><span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold">{group.orders.length}</span></div><p className="truncate text-[11px] text-slate-500">P{machineLabel(group.machine)} · Plano {plans.join(", ") || "—"} · {customers.join(", ") || "Sem cliente"}</p><PlannedTimes orders={group.orders} compact /></div><div className="shrink-0 text-right"><p className="text-xs font-black text-slate-900">{group.orders.map(orderDemand).join(" + ")}</p><Button className="mt-1 h-7 px-2.5 text-xs" size="sm" onClick={onChoose}><Flame className="size-3.5" />Enviar</Button></div></div></article>;
}
function PlannedTimes({ orders, compact = false }: { orders: HeatingOrder[]; compact?: boolean }) {
  const entries = [...new Set(orders.map((order) => order.source_data?.entradaForno).filter(Boolean))];
  const exits = [...new Set(orders.map((order) => order.source_data?.saidaForno).filter(Boolean))];
  if (!entries.length && !exits.length) return compact ? null : <p className="rounded-lg bg-slate-50 p-2 text-xs text-slate-500">A planilha não possui horários preenchidos. A entrada real será registrada agora.</p>;
  return <div className={cn("flex gap-2 rounded-lg bg-blue-50 text-xs text-blue-800", compact ? "mt-1 px-1.5 py-0.5 text-[10px]" : "mt-2 p-3")}><Clock3 className={cn("shrink-0", compact ? "size-3" : "size-4")} /><span>Excel: {entries.join(", ") || "—"} → {exits.join(", ") || "—"}</span></div>;
}
function HeatingCard({ cycle, now, saving, onRelease, onCancel, onRelocate }: { cycle: HeatingCycle; now: number; saving: boolean; onRelease: () => void; onCancel: () => void; onRelocate: () => void }) {
  const end = new Date(cycle.expected_ready_at).getTime();
  const maximum = new Date(cycle.maximum_due_at).getTime();
  const start = new Date(cycle.entered_at).getTime();
  const expired = now >= maximum;
  const ready = now >= end && !expired;
  const nearMaximum = !expired && maximum - now <= 4 * 60 * 60 * 1000;
  const progress = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
  const orders = cycle.tool_heating_cycle_orders.map((link) => link.production_orders).filter(Boolean) as HeatingOrder[];
  return (
    <article className={cn("@container rounded-xl border p-3", expired ? "border-red-300 bg-red-50" : ready ? "border-emerald-300 bg-emerald-50/50" : "border-orange-200 bg-orange-50/40")}>
      <div className="flex justify-between gap-3">
        <div>
          <p className="font-mono text-lg font-black text-slate-950">{cycle.tool_code}</p>
          <p className="text-xs text-slate-500">Prensa {machineLabel(cycle.machine_code)} · {cycle.oven_code || "Forno"} / posição {cycle.oven_position || "—"}</p>
          <p className="mt-1 text-[11px] font-semibold text-slate-500">{cycle.tool_type === "tubular" ? "Tubular" : "Sólida"} · {cycle.target_temperature_c || "—"} °C</p>
        </div>
        <span className={cn("h-fit rounded-full px-2 py-1 text-[10px] font-black uppercase", expired ? "bg-red-100 text-red-700" : ready ? "bg-emerald-100 text-emerald-700" : "bg-orange-100 text-orange-700")}>
          {expired ? "Limite excedido" : ready ? "Tempo atingido" : "Aquecendo"}
        </span>
      </div>
      <div className="mt-2 rounded-xl bg-white p-2.5 shadow-sm">
        <div className="grid gap-2 @[420px]:grid-cols-[minmax(132px,.72fr)_minmax(0,1.28fr)] @[420px]:items-center">
          <div className="min-w-0">
            <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400">{expired ? "Excedeu 24 horas há" : ready ? "Pronta há" : "Tempo restante"}</p>
            <p className={cn("whitespace-nowrap font-mono text-2xl font-black leading-tight", expired ? "text-red-600" : ready ? "text-emerald-600" : "text-orange-600")}>{duration(Math.abs((expired ? maximum : end) - now))}</p>
            <p className="mt-0.5 truncate text-[10px] text-slate-500">{orders.length} item(ns) · Plano {[...new Set(orders.map((order) => order.plan_code))].join(", ")}</p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={cn("h-full rounded-full transition-all", expired ? "bg-red-500" : ready ? "bg-emerald-500" : "bg-orange-500")} style={{ width: `${progress}%` }} />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[8px]">
              <Time label="Entrada" value={clock(cycle.entered_at)} />
              <Time label="Liberação" value={clock(cycle.expected_ready_at)} />
              <Time label="Limite 24 h" value={clock(cycle.maximum_due_at)} />
            </div>
          </div>
          <ThermalCurve cycle={cycle} now={now} progress={progress} ready={ready} expired={expired} />
        </div>
        {nearMaximum && <p className="mt-2 rounded-lg bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-700">Atenção: aproximação do limite máximo de permanência.</p>}
        {expired && <p className="mt-2 rounded-lg bg-red-50 px-2 py-1.5 text-xs font-bold text-red-700">Liberação bloqueada. Retire a ferramenta e encaminhe para avaliação.</p>}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Button className="h-8 text-xs" variant="outline" size="sm" onClick={onRelocate}><ArrowRightLeft className="size-3.5" />Realocar</Button>
        <Button className="h-8 text-xs" variant="outline" size="sm" onClick={onCancel}><X className="size-3.5" />{expired ? "Retirar" : "Cancelar"}</Button>
        <Button className={cn("h-8 text-xs", !ready && !expired && "bg-amber-500 text-white hover:bg-amber-600")} size="sm" disabled={saving || expired} onClick={onRelease}><CheckCircle2 className="size-3.5" />{ready ? "Liberar" : expired ? "Bloqueada" : "Liberar antes"}</Button>
      </div>
    </article>
  );
}
function ThermalCurve({ cycle, now, progress, ready, expired }: { cycle: HeatingCycle; now: number; progress: number; ready: boolean; expired: boolean }) {
  const ambientTemperature = 25;
  const targetTemperature = Number(cycle.target_temperature_c || (cycle.tool_type === "tubular" ? 420 : 400));
  const normalizedProgress = Math.min(1, Math.max(0, progress / 100));
  const curveFactor = (value: number) => (1 - Math.exp(-3.2 * value)) / (1 - Math.exp(-3.2));
  const estimatedTemperature = Math.round(ambientTemperature + (targetTemperature - ambientTemperature) * curveFactor(normalizedProgress));
  const chartLeft = 7;
  const chartRight = 193;
  const chartTop = 8;
  const chartBottom = 48;
  const temperatureY = (temperature: number) => chartBottom - ((temperature - ambientTemperature) / Math.max(1, targetTemperature - ambientTemperature)) * (chartBottom - chartTop);
  const samples = Array.from({ length: 25 }, (_, index) => {
    const value = index / 24;
    const temperature = ambientTemperature + (targetTemperature - ambientTemperature) * curveFactor(value);
    return { x: chartLeft + value * (chartRight - chartLeft), y: temperatureY(temperature) };
  });
  const linePath = samples.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${chartRight},${chartBottom} L${chartLeft},${chartBottom} Z`;
  const markerX = chartLeft + normalizedProgress * (chartRight - chartLeft);
  const markerY = temperatureY(estimatedTemperature);
  const gradientId = `thermal-${cycle.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const elapsedMinutes = Math.max(0, Math.floor((now - new Date(cycle.entered_at).getTime()) / 60000));
  return <div className="mt-2 overflow-hidden rounded-lg border border-orange-100 bg-gradient-to-r from-orange-50/70 via-white to-amber-50/60 px-2.5 pb-1.5 pt-2" aria-label={`Simulação térmica: temperatura estimada ${estimatedTemperature} graus Celsius, alvo ${targetTemperature} graus Celsius`}>
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-1.5"><Flame className={cn("size-3.5 shrink-0", expired ? "text-red-500" : ready ? "text-emerald-500" : "text-orange-500")} /><p className="truncate text-[9px] font-black uppercase tracking-[.12em] text-slate-500">Simulação térmica</p><span className="rounded-full bg-white px-1.5 py-0.5 text-[8px] font-bold text-slate-400 ring-1 ring-slate-100">estimada</span></div>
      <p className={cn("shrink-0 font-mono text-sm font-black", expired ? "text-red-600" : ready ? "text-emerald-600" : "text-orange-600")}><span className="text-[9px] font-bold text-slate-400">agora </span>{estimatedTemperature} °C</p>
    </div>
    <svg viewBox="0 0 200 57" role="img" className="mt-0.5 h-[58px] w-full" preserveAspectRatio="none">
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={expired ? "#ef4444" : ready ? "#10b981" : "#f97316"} stopOpacity="0.32" /><stop offset="100%" stopColor="#fff7ed" stopOpacity="0.05" /></linearGradient></defs>
      <line x1={chartLeft} y1={chartTop} x2={chartRight} y2={chartTop} stroke="#fdba74" strokeWidth="0.8" strokeDasharray="3 3" />
      <line x1={chartLeft} y1={chartBottom} x2={chartRight} y2={chartBottom} stroke="#e2e8f0" strokeWidth="0.8" />
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <path d={linePath} fill="none" stroke={expired ? "#ef4444" : ready ? "#10b981" : "#f97316"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <line x1={markerX} y1={chartTop} x2={markerX} y2={chartBottom} stroke="#0f172a" strokeWidth="0.65" strokeDasharray="2 2" opacity="0.45" />
      <circle cx={markerX} cy={markerY} r="3.2" fill="#fff" stroke={expired ? "#ef4444" : ready ? "#10b981" : "#f97316"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <text x={chartLeft} y="56" fill="#94a3b8" fontSize="6">25 °C</text>
      <text x={chartRight} y="56" fill="#64748b" fontSize="6" textAnchor="end">alvo {targetTemperature} °C</text>
    </svg>
    <div className="-mt-0.5 flex items-center justify-between text-[8px] font-medium text-slate-400"><span>{elapsedMinutes} min no forno</span><span>{ready || expired ? "temperatura estabilizada" : `${Math.round(progress)}% do aquecimento mínimo`}</span></div>
  </div>;
}
function ReleasedCard({ cycle, onRelocate }: { cycle: HeatingCycle; onRelocate: () => void }) {
  const orders = cycle.tool_heating_cycle_orders.map((link) => link.production_orders).filter((order): order is HeatingOrder => !!order && order.is_active && ["planned","released","paused"].includes(order.status)); const query = new URLSearchParams({ tool: cycle.tool_code, machine: cycle.machine_code, orders: orders.map((order) => order.id).join(",") });
  return <article className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><p className="font-mono text-lg font-black text-emerald-700">{cycle.tool_code}</p>{cycle.released_early && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-700">Antecipada</span>}</div><p className="truncate text-[11px] text-slate-500">P{machineLabel(cycle.machine_code)} · {orders.length} item(ns) · {cycle.actual_heating_minutes ?? "—"} min · saída {clock(cycle.released_at)} · {cycle.released_by_name || "—"}</p></div><CheckCircle2 className="size-5 shrink-0 text-emerald-600" /></div><div className="mt-2 grid grid-cols-[auto_1fr] gap-2"><Button className="h-8 text-xs" variant="outline" size="sm" onClick={onRelocate}><ArrowRightLeft className="size-3.5" />Prensa</Button><Button className="h-8 text-xs" size="sm" render={<Link href={`/producao?${query.toString()}`} />}><Play className="size-3.5" />Abrir ficha</Button></div>{cycle.released_early && cycle.release_notes && <p className="mt-2 truncate rounded-lg bg-amber-50 px-2 py-1 text-[10px] text-amber-800" title={cycle.release_notes}>{cycle.release_notes}</p>}</article>;
}
function Time({ label, value }: { label: string; value: string }) { return <div><p className="text-slate-400">{label}</p><p className="mt-0.5 text-xs font-bold text-slate-800">{value}</p></div>; }
function Pager({ page, pages, onChange }: { page: number; pages: number; onChange: (page: number) => void }) {
  if (pages <= 1) return null;
  return <nav className="flex items-center justify-between border-t pt-2" aria-label="Paginação"><span className="text-[10px] text-slate-500">Página {page} de {pages}</span><div className="flex gap-1"><button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => onChange(page - 1)} className="grid size-7 place-items-center rounded-lg border bg-white disabled:opacity-35"><ChevronLeft className="size-4" /></button><button type="button" aria-label="Próxima página" disabled={page >= pages} onClick={() => onChange(page + 1)} className="grid size-7 place-items-center rounded-lg border bg-white disabled:opacity-35"><ChevronRight className="size-4" /></button></div></nav>;
}
function Empty({ text }: { text: string }) { return <div className="grid min-h-32 place-items-center rounded-xl border border-dashed p-4 text-center"><div><TimerReset className="mx-auto size-7 text-slate-300" /><p className="mt-2 text-xs text-slate-500">{text}</p></div></div>; }
function Loading() { return <div className="grid min-h-32 place-items-center"><Loader2 className="size-7 animate-spin text-orange-500" /></div>; }
