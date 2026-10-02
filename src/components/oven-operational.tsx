"use client";

/* The operational board intentionally polls external state and uses a wall clock for countdowns. */
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */

import { useCallback, useEffect, useMemo, useState, type ReactNode, type TextareaHTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Flame,
  LogOut,
  Maximize,
  Minimize,
  Plus,
  RefreshCw,
  ShieldCheck,
  Thermometer,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { requestOfflineSync } from "@/lib/offline-store";
import type { LocalUser } from "@/lib/local-auth/types";
import { cn } from "@/lib/utils";

type MachineCode = "18" | "19";
type CycleStatus = "heating" | "released";
type ProductionOrder = {
  id: string;
  order_number: string;
  plan_code: string | null;
  machine_code: string;
  tool_code: string;
  customer_name: string | null;
  status: string;
  is_active: boolean;
  sequence: number | null;
  due_date: string | null;
  import_batch_id: string | null;
};
type CycleOrderLink = { production_order_id: string; production_orders: ProductionOrder | null };
type HeatingCycle = {
  id: string;
  machine_code: string;
  tool_code: string;
  oven_code: string | null;
  oven_id: string | null;
  oven_position: number | null;
  tool_type: "solid" | "tubular" | null;
  target_temperature_c: number | null;
  maximum_due_at: string;
  status: CycleStatus;
  required_minutes: number;
  entered_at: string;
  expected_ready_at: string;
  released_at: string | null;
  entered_by_name: string;
  released_by_name: string | null;
  released_early: boolean;
  notes: string | null;
  release_notes: string | null;
  tool_heating_cycle_orders: CycleOrderLink[];
};
type ToolOven = {
  id: string;
  machine_code: string;
  code: string;
  name: string;
  position_count: number;
  solid_minimum_minutes: number;
  tubular_minimum_minutes: number;
  maximum_minutes: number;
  solid_target_temperature_c: number;
  tubular_target_temperature_c: number;
  is_active: boolean;
};
type QueueTool = {
  id: string;
  tool: string;
  machine: MachineCode;
  plan: string;
  sequence: number;
  orders: ProductionOrder[];
};
type SelectedSlot = { id: string; machine: MachineCode; oven: ToolOven; position: number };

const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
const orderFields = "id,import_batch_id,order_number,plan_code,machine_code,tool_code,customer_name,status,is_active,sequence,due_date";
const cycleFields = "id,machine_code,tool_code,oven_code,oven_id,oven_position,tool_type,target_temperature_c,maximum_due_at,status,required_minutes,entered_at,expected_ready_at,released_at,entered_by_name,released_by_name,released_early,notes,release_notes,tool_heating_cycle_orders(production_order_id,production_orders(" + orderFields + "))";
const ovenFields = "id,machine_code,code,name,position_count,solid_minimum_minutes,tubular_minimum_minutes,maximum_minutes,solid_target_temperature_c,tubular_target_temperature_c,is_active";
const machineLabel = (machine: string) => machine === "18" ? "1.8" : machine === "19" ? "1.9" : machine;
const duration = (milliseconds: number) => {
  const minutes = Math.max(0, Math.floor(Math.abs(milliseconds) / 60000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${String(rest).padStart(2, "0")}min` : `${rest}min`;
};
const formatDateTime = (value: string) => new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

function errorMessage(value: unknown) {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return String(record.message || record.details || record.hint || "Não foi possível concluir a operação.");
  }
  return "Não foi possível concluir a operação.";
}

function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} />;
}

export function OvenOperational({ user }: { user: LocalUser }) {
  const router = useRouter();
  const allowedMachines = useMemo<MachineCode[]>(() => user.role === "operator" && user.machine_codes.length ? (["18", "19"] as const).filter((code) => user.machine_codes.includes(code)) : ["18", "19"], [user.machine_codes, user.role]);
  const [machine, setMachine] = useState<MachineCode>(allowedMachines[0] ?? "18");
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [cycles, setCycles] = useState<HeatingCycle[]>([]);
  const [ovens, setOvens] = useState<ToolOven[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [clock, setClock] = useState("");
  const [notice, setNotice] = useState("Carregando a operação do forno…");
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<SelectedSlot | null>(null);
  const [selectedCycle, setSelectedCycle] = useState<HeatingCycle | null>(null);
  const [toolType, setToolType] = useState<"solid" | "tubular">("solid");
  const [startNotes, setStartNotes] = useState("");
  const [releaseReason, setReleaseReason] = useState("");
  const [limitAction, setLimitAction] = useState<"release_at_risk" | "cool_and_polish">("cool_and_polish");
  const [limitReason, setLimitReason] = useState("");
  const [query, setQuery] = useState("");
  const [machineFilterReady, setMachineFilterReady] = useState(false);
  const machineFilterKey = `tecnomes:forno-operacional:machine-filter:${user.user_id}`;

  const load = useCallback(async (silent = false) => {
    if (!organizationId) {
      setNotice("A organização padrão não está configurada. O painel não pode acessar a operação.");
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true); else setRefreshing(true);
    try {
      const supabase = createClient();
      const [{ data: orderData, error: orderError }, { data: cycleData, error: cycleError }, { data: ovenData, error: ovenError }] = await Promise.all([
        supabase.from("production_orders").select(`${orderFields},simplified_imports!inner(id,is_active,status,deleted_at)`).eq("organization_id", organizationId).eq("is_active", true).in("status", ["planned", "released", "paused"]).eq("simplified_imports.is_active", true).eq("simplified_imports.status", "processed").is("simplified_imports.deleted_at", null).order("sequence").limit(2000),
        supabase.from("tool_heating_cycles").select(cycleFields).eq("organization_id", organizationId).in("status", ["heating", "released"]).order("entered_at", { ascending: false }).limit(500),
        supabase.from("tool_ovens").select(ovenFields).eq("organization_id", organizationId).eq("is_active", true).order("machine_code").order("code"),
      ]);
      if (orderError) throw orderError;
      if (cycleError) throw cycleError;
      if (ovenError) throw ovenError;
      setOrders((orderData ?? []) as unknown as ProductionOrder[]);
      setCycles((cycleData ?? []) as unknown as HeatingCycle[]);
      setOvens((ovenData ?? []) as ToolOven[]);
      setNotice("Operação sincronizada com o banco.");
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    try {
      const saved = window.localStorage.getItem(machineFilterKey);
      queueMicrotask(() => {
        if (!active) return;
        if ((saved === "18" || saved === "19") && allowedMachines.includes(saved)) setMachine(saved);
        setMachineFilterReady(true);
      });
    } catch { setMachineFilterReady(true); }
    return () => { active = false; };
  }, [allowedMachines, machineFilterKey]);
  useEffect(() => { if (machineFilterReady) try { window.localStorage.setItem(machineFilterKey, machine); } catch {} }, [machine, machineFilterKey, machineFilterReady]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void load(true); }, 15000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
    const connection = () => setOnline(navigator.onLine);
    tick(); connection();
    const timer = window.setInterval(tick, 1000);
    window.addEventListener("online", connection); window.addEventListener("offline", connection);
    return () => { window.clearInterval(timer); window.removeEventListener("online", connection); window.removeEventListener("offline", connection); };
  }, []);
  useEffect(() => { const change = () => setFullscreen(Boolean(document.fullscreenElement)); document.addEventListener("fullscreenchange", change); return () => document.removeEventListener("fullscreenchange", change); }, []);
  useEffect(() => {
    document.body.classList.add("oven-operational-active");
    return () => document.body.classList.remove("oven-operational-active");
  }, []);

  const activeCycles = useMemo(() => cycles.filter((cycle) => cycle.machine_code === machine), [cycles, machine]);
  const visibleOvens = useMemo(() => ovens.filter((oven) => oven.machine_code === machine), [machine, ovens]);
  const linkedOrderIds = useMemo(() => new Set(cycles.flatMap((cycle) => cycle.tool_heating_cycle_orders.map((link) => link.production_order_id))), [cycles]);
  const queue = useMemo<QueueTool[]>(() => {
    const grouped = new Map<string, QueueTool>();
    const normalized = query.trim().toUpperCase();
    for (const order of orders) {
      if (linkedOrderIds.has(order.id) || order.machine_code !== machine) continue;
      const haystack = `${order.tool_code} ${order.plan_code ?? ""} ${order.order_number} ${order.customer_name ?? ""}`.toUpperCase();
      if (normalized && !haystack.includes(normalized)) continue;
      const key = order.tool_code.toUpperCase();
      const current = grouped.get(key) ?? { id: `${machine}-${key}`, tool: order.tool_code, machine, plan: order.plan_code ?? "Sem plano", sequence: order.sequence ?? 0, orders: [] };
      current.orders.push(order);
      if ((order.sequence ?? 0) < current.sequence) current.sequence = order.sequence ?? 0;
      grouped.set(key, current);
    }
    return [...grouped.values()].sort((left, right) => left.sequence - right.sequence || left.tool.localeCompare(right.tool));
  }, [linkedOrderIds, machine, orders, query]);
  const selectedTool = queue.find((tool) => tool.id === selectedToolId) ?? null;
  const selectedCycleFromData = activeCycles.find((cycle) => cycle.id === selectedCycle?.id) ?? null;
  const heatingCount = activeCycles.filter((cycle) => cycle.status === "heating").length;
  const releasedCount = activeCycles.filter((cycle) => cycle.status === "released").length;
  const alertCount = activeCycles.filter((cycle) => cycle.status === "heating" && Date.now() >= new Date(cycle.maximum_due_at).getTime()).length;
  const freeCount = visibleOvens.reduce((total, oven) => total + oven.position_count, 0) - activeCycles.filter((cycle) => cycle.oven_id).length;

  function chooseTool(tool: QueueTool) {
    setSelectedToolId(tool.id);
    setSelectedCycle(null);
    setNotice(selectedSlot ? `${tool.tool} e a vaga ${selectedSlot.position} do ${selectedSlot.oven.name} foram selecionadas.` : `${tool.tool} selecionada. Escolha uma vaga livre no mapa.`);
  }
  function chooseFreeSlot(oven: ToolOven, position: number) {
    setSelectedSlot({ id: `${oven.id}-${position}`, machine, oven, position });
    setSelectedCycle(null);
    setNotice(selectedTool ? `${selectedTool.tool} e a vaga ${position} do ${oven.name} foram selecionadas.` : `Vaga ${position} do ${oven.name} selecionada. Escolha uma ferramenta da fila.`);
  }
  function chooseCycle(cycle: HeatingCycle) {
    setSelectedCycle(cycle);
    setSelectedSlot(null);
    setSelectedToolId(null);
    setReleaseReason(""); setLimitReason("");
    setNotice(`${cycle.tool_code} selecionada. Confira o estado antes de decidir.`);
  }
  function cycleAt(ovenId: string, position: number) { return activeCycles.find((cycle) => cycle.oven_id === ovenId && cycle.oven_position === position); }

  async function startHeating() {
    if (!online || !selectedSlot || !selectedTool) return;
    setBusy(true);
    try {
      const { error } = await createClient().rpc("start_tool_heating", { p_order_ids: selectedTool.orders.map((order) => order.id), p_actor: user.display_name, p_oven_id: selectedSlot.oven.id, p_oven_position: selectedSlot.position, p_tool_type: toolType, p_target_machine: machine, p_notes: startNotes.trim() || null });
      if (error) throw error;
      setNotice(`${selectedTool.tool} entrou no ${selectedSlot.oven.name}, vaga ${selectedSlot.position}.`);
      setSelectedToolId(null); setSelectedSlot(null); setStartNotes("");
      requestOfflineSync("tool_heating_cycles"); await load(true);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function releaseCycle() {
    if (!online || !selectedCycleFromData) return;
    const early = Date.now() < new Date(selectedCycleFromData.expected_ready_at).getTime();
    if (early && releaseReason.trim().length < 8) { setNotice("A retirada antecipada exige uma justificativa com pelo menos 8 caracteres."); return; }
    setBusy(true);
    try {
      const { error } = await createClient().rpc("release_tool_heating", { p_cycle_id: selectedCycleFromData.id, p_actor: user.display_name, p_notes: releaseReason.trim() || null });
      if (error) throw error;
      setNotice(`${selectedCycleFromData.tool_code} foi liberada para produção.`);
      setSelectedCycle(null); setReleaseReason(""); requestOfflineSync("tool_heating_cycles"); await load(true);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function resolveLimit() {
    if (!online || !selectedCycleFromData) return;
    if (limitReason.trim().length < 8) { setNotice("Informe uma justificativa com pelo menos 8 caracteres."); return; }
    setBusy(true);
    try {
      const { error } = await createClient().rpc("resolve_tool_heating_limit", { p_cycle_id: selectedCycleFromData.id, p_actor: user.display_name, p_action: limitAction, p_reason: limitReason.trim() });
      if (error) throw error;
      setNotice(limitAction === "release_at_risk" ? `${selectedCycleFromData.tool_code} liberada sob risco e registrada.` : `${selectedCycleFromData.tool_code} retirada para resfriar e polir.`);
      setSelectedCycle(null); setLimitReason(""); requestOfflineSync("tool_heating_cycles"); await load(true);
    } catch (error) { setNotice(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function toggleFullscreen() {
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    await document.documentElement.requestFullscreen().catch(() => setNotice("Tela cheia não permitida pelo navegador."));
  }

  return <div className="oven-operational-shell min-h-[100dvh] w-screen overflow-x-hidden bg-[#07101f] text-slate-950">
    <header className="border-b border-white/10 bg-[#0b172a] px-3 py-2 text-white sm:px-5"><div className="flex min-h-12 items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-orange-500"><Flame className="size-5" /></span><div className="min-w-0"><p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Painel operacional</p><h1 className="truncate font-heading text-base font-black sm:text-xl">Fornos de ferramentas — Prensa {machineLabel(machine)}</h1></div></div><div className="flex shrink-0 items-center gap-2 text-xs font-bold sm:gap-4 sm:text-sm"><span className={cn("hidden items-center gap-1.5 sm:inline-flex", online ? "text-emerald-300" : "text-red-300")}><i className={cn("size-2 rounded-full", online ? "bg-emerald-400" : "bg-red-400")} />{online ? "ONLINE" : "SEM CONEXÃO"}</span><span className="font-mono tabular-nums text-slate-200">{clock}</span><button type="button" title={fullscreen ? "Sair da tela cheia" : "Tela cheia"} onClick={() => void toggleFullscreen()} className="grid size-10 place-items-center rounded-lg border border-white/15 hover:bg-white/10">{fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}</button><button type="button" title="Sair do modo operacional" onClick={() => router.push("/forno")} className="hidden size-10 place-items-center rounded-lg border border-white/15 hover:bg-white/10 sm:grid"><LogOut className="size-4" /></button></div></div><div className="mt-2 flex items-center justify-between gap-2 overflow-x-auto"><div className="flex min-w-0 gap-1 rounded-lg bg-white/5 p-1">{allowedMachines.map((code) => <button key={code} type="button" onClick={() => { setMachine(code); setSelectedToolId(null); setSelectedSlot(null); setSelectedCycle(null); }} className={cn("min-h-10 shrink-0 rounded-md px-4 text-xs font-black", machine === code ? "bg-orange-500 text-white" : "text-slate-300 hover:bg-white/10")}>PRENSA {machineLabel(code)}</button>)}</div><div className="hidden items-center gap-3 text-[11px] font-bold text-slate-300 md:flex"><span>{freeCount} livres</span><span>{heatingCount} aquecendo</span><span>{releasedCount} liberadas</span>{alertCount > 0 && <span className="text-red-300">{alertCount} limites</span>}<button type="button" onClick={() => void load()} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 hover:bg-white/10"><RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} />Atualizar</button></div></div></header>
    <main className="flex min-h-[calc(100dvh-76px)] flex-col gap-2 p-2 sm:gap-3 sm:p-3"><div className="flex min-h-8 items-center justify-between gap-2 rounded-lg border border-emerald-300/50 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-950"><span className="truncate"><ShieldCheck className="mr-1 inline size-3.5" />MODO PRODUÇÃO — ações registradas no banco e no histórico operacional.</span><span className="hidden whitespace-nowrap md:inline">{notice}</span></div><div className="grid min-h-0 flex-1 gap-2 xl:grid-cols-[minmax(0,1fr)_21rem]"><section className="min-w-0 rounded-2xl bg-white p-2 shadow-lg sm:p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-heading text-lg font-black">Mapa do forno</h2><p className="text-xs text-slate-500">Toque em uma vaga livre para carregar a próxima ferramenta.</p></div><div className="flex flex-wrap gap-1 text-[10px] font-semibold"><Legend icon={<Plus className="size-3" />} text="Livre" tone="slate" /><Legend icon={<Flame className="size-3" />} text="Aquecendo" tone="orange" /><Legend icon={<CheckCircle2 className="size-3" />} text="Liberada" tone="green" /><Legend icon={<AlertTriangle className="size-3" />} text="Limite" tone="red" /></div></div>{loading ? <div className="grid min-h-64 place-items-center text-sm text-slate-500"><RefreshCw className="mr-2 inline size-4 animate-spin" />Carregando fornos…</div> : <div className="grid gap-2 md:grid-cols-2 min-[1200px]:grid-cols-3">{visibleOvens.map((oven) => <OvenCard key={oven.id} oven={oven} cycles={activeCycles} selectedCycleId={selectedCycle?.id ?? null} selectedSlotId={selectedSlot?.id ?? null} onFree={chooseFreeSlot} onCycle={chooseCycle} cycleAt={cycleAt} />)}</div>}</section><aside className="min-w-0 rounded-2xl bg-white p-3 shadow-lg"><div className="flex items-start justify-between gap-3"><div><h2 className="font-heading text-lg font-black">Próximas para aquecer</h2><p className="text-xs text-slate-500">Fila real da Simplificada ativa.</p></div><Thermometer className="size-5 text-orange-600" /></div><div className="mt-3"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ferramenta ou plano" className="h-10 w-full rounded-xl border px-3 text-sm outline-none focus:border-orange-400" /></div><div className="mt-3 space-y-2">{queue.length ? queue.map((tool) => <button key={tool.id} type="button" aria-pressed={selectedToolId === tool.id} onClick={() => chooseTool(tool)} className={cn("min-h-16 w-full rounded-xl border p-3 text-left transition", selectedToolId === tool.id ? "border-orange-400 bg-orange-50 ring-2 ring-orange-100" : "hover:border-orange-300 hover:bg-orange-50/40")}><div className="flex items-center justify-between gap-2"><p className="font-mono text-base font-black text-orange-700">{tool.tool}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">{selectedToolId === tool.id ? "Selecionada" : `Seq. ${tool.sequence || "—"}`}</span></div><p className="mt-1 text-xs text-slate-500">Plano {tool.plan} · {tool.orders.length} item(ns)</p></button>) : <p className="rounded-xl border border-dashed p-5 text-center text-sm text-slate-500">Não há ferramenta aguardando nesta prensa.</p>}</div><div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><Clock3 className="mr-1 inline size-4 text-slate-500" />A fila é atualizada automaticamente a cada 15 segundos.</div></aside></div></main>
    {(selectedSlot || selectedCycleFromData) && <ActionPanel selectedSlot={selectedSlot} selectedTool={selectedTool} cycle={selectedCycleFromData} toolType={toolType} setToolType={setToolType} startNotes={startNotes} setStartNotes={setStartNotes} releaseReason={releaseReason} setReleaseReason={setReleaseReason} limitAction={limitAction} setLimitAction={setLimitAction} limitReason={limitReason} setLimitReason={setLimitReason} busy={busy || !online} onStart={() => void startHeating()} onRelease={() => void releaseCycle()} onResolveLimit={() => void resolveLimit()} onClose={() => { setSelectedSlot(null); setSelectedCycle(null); setSelectedToolId(null); }} />}
  </div>;
}

function OvenCard({ oven, cycles, selectedCycleId, selectedSlotId, onFree, onCycle, cycleAt }: { oven: ToolOven; cycles: HeatingCycle[]; selectedCycleId: string | null; selectedSlotId: string | null; onFree: (oven: ToolOven, position: number) => void; onCycle: (cycle: HeatingCycle) => void; cycleAt: (ovenId: string, position: number) => HeatingCycle | undefined }) {
  const occupied = cycles.filter((cycle) => cycle.oven_id === oven.id).length;
  return <article className="rounded-2xl border bg-slate-50/60 p-2 sm:p-3"><header className="mb-2 flex items-center justify-between"><div><h3 className="font-heading text-base font-black">{oven.name}</h3><p className="text-xs text-slate-500">{occupied}/{oven.position_count} posições ocupadas</p></div><span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-600">{oven.position_count - occupied} livres</span></header><div className="grid grid-cols-4 gap-1.5 sm:gap-2">{Array.from({ length: oven.position_count }, (_, index) => index + 1).map((position) => { const cycle = cycleAt(oven.id, position); if (!cycle) return <button key={position} type="button" onClick={() => onFree(oven, position)} className={cn("min-h-24 rounded-xl border border-dashed border-slate-300 bg-white p-2 text-left text-slate-500 transition hover:border-orange-400 hover:bg-orange-50 focus-visible:outline-2 focus-visible:outline-orange-500 sm:min-h-28", selectedSlotId === `${oven.id}-${position}` && "ring-2 ring-slate-950 ring-offset-2")}><p className="text-[10px] font-black uppercase sm:text-[11px]">Vaga {position}</p><p className="mt-5 text-xs font-bold sm:mt-7 sm:text-sm">Livre</p></button>; const ready = cycle.status === "heating" && Date.now() >= new Date(cycle.expected_ready_at).getTime(); const expired = cycle.status === "heating" && Date.now() >= new Date(cycle.maximum_due_at).getTime(); const released = cycle.status === "released"; return <button key={position} type="button" onClick={() => onCycle(cycle)} className={cn("min-h-24 rounded-xl border p-2 text-left transition hover:-translate-y-0.5 hover:shadow-sm sm:min-h-28", released ? "border-emerald-300 bg-emerald-50 text-emerald-950" : expired ? "border-red-400 bg-red-50 text-red-900" : ready ? "border-rose-300 bg-rose-50 text-rose-950" : "border-orange-300 bg-orange-50 text-orange-950", selectedCycleId === cycle.id && "ring-2 ring-slate-950 ring-offset-2")}><div className="flex items-start justify-between gap-1"><span className="text-[10px] font-black uppercase sm:text-[11px]">Vaga {position}</span>{released ? <CheckCircle2 className="size-3" /> : expired ? <AlertTriangle className="size-3" /> : <Flame className="size-3" />}</div><p className="mt-2 truncate font-mono text-xs font-black sm:text-sm">{cycle.tool_code}</p><p className="mt-1 line-clamp-2 text-[10px] font-semibold sm:text-[11px]">{released ? "Liberada · retirar" : expired ? "Limite excedido" : ready ? `Pronta · ${duration(Date.now() - new Date(cycle.expected_ready_at).getTime())}` : `Aquecendo · ${duration(new Date(cycle.expected_ready_at).getTime() - Date.now())}`}</p></button>; })}</div></article>;
}

function ActionPanel({ selectedSlot, selectedTool, cycle, toolType, setToolType, startNotes, setStartNotes, releaseReason, setReleaseReason, limitAction, setLimitAction, limitReason, setLimitReason, busy, onStart, onRelease, onResolveLimit, onClose }: { selectedSlot: SelectedSlot | null; selectedTool: QueueTool | null; cycle: HeatingCycle | null; toolType: "solid" | "tubular"; setToolType: (value: "solid" | "tubular") => void; startNotes: string; setStartNotes: (value: string) => void; releaseReason: string; setReleaseReason: (value: string) => void; limitAction: "release_at_risk" | "cool_and_polish"; setLimitAction: (value: "release_at_risk" | "cool_and_polish") => void; limitReason: string; setLimitReason: (value: string) => void; busy: boolean; onStart: () => void; onRelease: () => void; onResolveLimit: () => void; onClose: () => void }) {
  const now = Date.now();
  const early = cycle ? cycle.status === "heating" && now < new Date(cycle.expected_ready_at).getTime() : false;
  const expired = cycle ? cycle.status === "heating" && now >= new Date(cycle.maximum_due_at).getTime() : false;
  return <section className="fixed inset-x-2 bottom-2 z-20 rounded-2xl border-2 border-slate-950 bg-white p-4 shadow-2xl sm:inset-x-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><p className="text-xs font-black uppercase tracking-wide text-slate-500">Ação operacional</p>{selectedSlot && <><p className="mt-1 font-heading text-lg font-black">{selectedSlot.oven.name} · vaga {selectedSlot.position} · livre</p><p className="mt-1 text-sm text-slate-600">{selectedTool ? `Ferramenta escolhida: ${selectedTool.tool} · ${selectedTool.orders.length} item(ns)` : "Escolha uma ferramenta da fila."}</p>{selectedTool && <div className="mt-2 flex flex-wrap gap-1"><button type="button" onClick={() => setToolType("solid")} className={cn("rounded-lg border px-3 py-1.5 text-xs font-bold", toolType === "solid" ? "border-orange-500 bg-orange-50 text-orange-700" : "bg-white")}>Sólida</button><button type="button" onClick={() => setToolType("tubular")} className={cn("rounded-lg border px-3 py-1.5 text-xs font-bold", toolType === "tubular" ? "border-orange-500 bg-orange-50 text-orange-700" : "bg-white")}>Tubular</button></div>}{selectedTool && <Textarea value={startNotes} onChange={(event) => setStartNotes(event.target.value)} placeholder="Observação da entrada (opcional)" className="mt-2 min-h-12 max-w-xl text-xs" />}</>}{cycle && <><p className="mt-1 font-heading text-lg font-black">{cycle.tool_code} · {cycle.status === "released" ? "liberada" : expired ? "limite excedido" : early ? "aquecendo" : "pronta"}</p><p className="mt-1 text-sm text-slate-600">{cycle.oven_code} · vaga {cycle.oven_position} · {cycle.tool_type === "tubular" ? "Tubular" : "Sólida"} · entrou {formatDateTime(cycle.entered_at)}</p>{cycle.status === "heating" && <p className="mt-1 text-xs font-semibold text-slate-500">{early ? `Pronta a partir de ${formatDateTime(cycle.expected_ready_at)}` : expired ? `Limite atingido em ${formatDateTime(cycle.maximum_due_at)}` : "Tempo mínimo cumprido."}</p>}{early && <Textarea value={releaseReason} onChange={(event) => setReleaseReason(event.target.value)} placeholder="Justifique a retirada antecipada (mínimo 8 caracteres)" className="mt-2 min-h-12 max-w-xl text-xs" />}{expired && <><div className="mt-2 flex flex-wrap gap-1"><button type="button" onClick={() => setLimitAction("release_at_risk")} className={cn("rounded-lg border px-3 py-1.5 text-xs font-bold", limitAction === "release_at_risk" ? "border-red-500 bg-red-50 text-red-700" : "bg-white")}>Liberar sob risco</button><button type="button" onClick={() => setLimitAction("cool_and_polish")} className={cn("rounded-lg border px-3 py-1.5 text-xs font-bold", limitAction === "cool_and_polish" ? "border-blue-500 bg-blue-50 text-blue-700" : "bg-white")}>Resfriar e polir</button></div><Textarea value={limitReason} onChange={(event) => setLimitReason(event.target.value)} placeholder="Justifique a decisão (mínimo 8 caracteres)" className="mt-2 min-h-12 max-w-xl text-xs" /></>}</>}</div><div className="flex flex-wrap gap-2 lg:max-w-[42rem] lg:justify-end">{selectedSlot && <Button className="min-h-12 px-5" disabled={!selectedTool || busy} onClick={onStart}><Flame />{busy ? "Registrando…" : selectedTool ? `Colocar ${selectedTool.tool}` : "Escolha uma ferramenta"}</Button>}{cycle?.status === "heating" && <Button className="min-h-12 px-5" disabled={busy} onClick={expired ? onResolveLimit : onRelease}>{busy ? "Registrando…" : expired ? "Confirmar decisão" : early ? "Liberar antecipadamente" : "Liberar para produção"}</Button>}{cycle && cycle.status === "released" && <Button className="min-h-12 bg-emerald-600 px-5 hover:bg-emerald-700" onClick={onClose}><CheckCircle2 />Fechar acompanhamento</Button>}<Button className="min-h-12" variant="outline" disabled={busy} onClick={onClose}><XCircle />Fechar</Button></div></div></section>;
}

function Legend({ icon, text, tone }: { icon: ReactNode; text: string; tone: "slate" | "orange" | "green" | "red" }) {
  const tones = { slate: "bg-slate-100 text-slate-700", orange: "bg-orange-100 text-orange-700", green: "bg-emerald-100 text-emerald-700", red: "bg-red-100 text-red-700" };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1", tones[tone])}>{icon}{text}</span>;
}
