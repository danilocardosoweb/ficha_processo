"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, CalendarClock, Clock3, Flame, Gauge, GripVertical, Loader2, PackageOpen, RefreshCw, Route, Settings2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { simulateMachineLoad, type LoadOrderInput, type MachineLoadSettings, type ProductivitySource, type WorkShiftInput } from "@/modules/planning/machine-load-simulator";
import { useCurrentUser } from "@/components/current-user-provider";

interface RawOrder {
  id: string; order_number: string; plan_code: string | null; machine_code: string; tool_code: string; alloy_code: string | null;
  target_kg: number | string | null; produced_kg: number | string | null; sequence: number | null; due_date: string | null;
  status: string; last_productivity_kg_h: number | string | null;
}
interface RawSheet { tool_code: string; machine_code: string | null; parameters: Record<string, unknown> | null; }
interface RawTool { code: string; matrix_code: string | null; productivity_kg_h: string | null; }
interface RawSetting { machine_code: string; billet_bar_weight_kg: number | string; extrusion_efficiency: number | string; default_productivity_kg_h: number | string; setup_minutes: number; alloy_change_minutes: number; tool_heating_minutes: number; }
interface RawShift { id: string; code: string; name: string; start_time: string; end_time: string; break_minutes: number; machine_codes: string[]; is_active: boolean; }
interface ProductionSettingsPayload { settings: RawSetting[]; shifts: RawShift[]; }
interface RawCycleOrder { production_order_id: string; tool_heating_cycles: { status: string; expected_ready_at: string | null; released_at: string | null } | null; }
interface RawAlloy { tool_code: string; alloy_code: string; is_primary: boolean; }

const defaultSettings: MachineLoadSettings = { billetBarWeightKg: 415, extrusionEfficiency: 0.85, defaultProductivityKgH: 1000, setupMinutes: 20, alloyChangeMinutes: 15, toolHeatingMinutes: 240, ovenSlots: 21 };
const numberValue = (value: unknown) => typeof value === "number" ? value : Number(String(value ?? "").replace(/\./g, "").replace(",", ".")) || 0;
const formatNumber = (value: number, digits = 1) => value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const formatDuration = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(Math.round(minutes % 60)).padStart(2, "0")}min`;
const formatDateTime = (date: Date | null) => date ? date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const machineLabel = (code: string) => code === "18" ? "Prensa 1.8" : code === "19" ? "Prensa 1.9" : `Prensa ${code}`;
const toInputDateTime = (date: Date) => { const pad = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; };
const parseInputDateTime = (value: string) => { const [datePart, timePart] = value.split("T"); if (!datePart || !timePart) return null; const [year, month, day] = datePart.split("-").map(Number); const [hours, minutes] = timePart.split(":").map(Number); const date = new Date(year, month - 1, day, hours, minutes); return Number.isNaN(date.getTime()) ? null : date; };
const sourceLabel: Record<ProductivitySource, string> = { simplificada: "Ult. Prod.", ficha: "Ficha", ferramenta: "Histórico", padrao: "Padrão" };

function readSheetProductivity(parameters: Record<string, unknown> | null) {
  if (!parameters) return 0;
  return numberValue(parameters.target_productivity_kg_h ?? parameters.productivity_kg_h ?? parameters.produtividade_kg_h ?? parameters.produtividade);
}

export function MachineLoadSimulator() {
  const { role, machine_codes: userMachineCodes } = useCurrentUser();
  const canPlan = role === "admin" || role === "pcp";
  const allowedMachines = useMemo(() => canPlan || !userMachineCodes?.length ? null : new Set(userMachineCodes), [canPlan, userMachineCodes]);
  const [orders, setOrders] = useState<LoadOrderInput[]>([]);
  const [settings, setSettings] = useState<Record<string, MachineLoadSettings>>({});
  const [shifts, setShifts] = useState<WorkShiftInput[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"fifo" | "optimized" | "manual">("optimized");
  const [manualOrder, setManualOrder] = useState<Record<string, string[]>>({});
  const [machine, setMachine] = useState("all");
  const [tab, setTab] = useState<"timeline" | "billets">("timeline");
  const [startedAt, setStartedAt] = useState<Date | null>(null);
  const [startInput, setStartInput] = useState("");

  const load = useCallback(async function load() {
    setLoading(true); setError("");
    try {
      if (!isSupabaseConfigured()) throw new Error("Supabase não configurado.");
      const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
      if (!organizationId) throw new Error("Organização padrão não configurada.");
      const supabase = createClient();
      const [ordersResult, sheetsResult, toolsResult, cyclesResult, alloysResult, productionSettingsResponse] = await Promise.all([
        supabase.from("production_orders").select("id,order_number,plan_code,machine_code,tool_code,alloy_code,target_kg,produced_kg,sequence,due_date,status,last_productivity_kg_h").eq("organization_id", organizationId).eq("is_active", true).in("status", ["planned", "released", "in_progress", "paused"]).order("machine_code").order("sequence"),
        supabase.from("process_sheets").select("tool_code,machine_code,parameters").eq("organization_id", organizationId).eq("is_active", true),
        supabase.from("tools").select("code,matrix_code,productivity_kg_h").eq("organization_id", organizationId),
        supabase.from("tool_heating_cycle_orders").select("production_order_id,tool_heating_cycles!inner(status,expected_ready_at,released_at,organization_id)").eq("tool_heating_cycles.organization_id", organizationId).in("tool_heating_cycles.status", ["heating", "released"]),
        supabase.from("tool_alloy_options").select("tool_code,alloy_code,is_primary").eq("organization_id", organizationId).eq("is_active", true).order("priority"),
        fetch("/api/production-settings", { cache: "no-store" }),
      ]);
      const firstError = [ordersResult.error, sheetsResult.error, toolsResult.error, cyclesResult.error, alloysResult.error].find(Boolean);
      if (firstError) throw firstError;
      const productionSettings = await productionSettingsResponse.json().catch(() => ({})) as ProductionSettingsPayload & { error?: string };
      if (!productionSettingsResponse.ok) throw new Error(productionSettings.error || "Não foi possível carregar os turnos de produção.");
      const rawOrders = (ordersResult.data ?? []) as RawOrder[];
      const rawSheets = (sheetsResult.data ?? []) as RawSheet[];
      const rawTools = (toolsResult.data ?? []) as RawTool[];
      const rawSettings = productionSettings.settings ?? [];
      const rawCycles = (cyclesResult.data ?? []) as unknown as RawCycleOrder[];
      const rawAlloys = (alloysResult.data ?? []) as RawAlloy[];
      const settingMap: Record<string, MachineLoadSettings> = {};
      for (const code of [...new Set(rawOrders.map((order) => order.machine_code))]) {
        const row = rawSettings.find((item) => item.machine_code === code);
        settingMap[code] = row ? { billetBarWeightKg: numberValue(row.billet_bar_weight_kg), extrusionEfficiency: numberValue(row.extrusion_efficiency), defaultProductivityKgH: numberValue(row.default_productivity_kg_h), setupMinutes: row.setup_minutes, alloyChangeMinutes: row.alloy_change_minutes, toolHeatingMinutes: row.tool_heating_minutes, ovenSlots: 21 } : { ...defaultSettings };
      }
      const input = rawOrders.map((order) => {
        const sheet = rawSheets.find((item) => item.tool_code.toUpperCase() === order.tool_code.toUpperCase() && (!item.machine_code || item.machine_code === order.machine_code));
        const tool = rawTools.find((item) => [item.code, item.matrix_code].filter(Boolean).some((code) => code!.toUpperCase() === order.tool_code.toUpperCase()));
        const sources: Array<[number, ProductivitySource]> = [[numberValue(order.last_productivity_kg_h), "simplificada"], [readSheetProductivity(sheet?.parameters ?? null), "ficha"], [numberValue(tool?.productivity_kg_h), "ferramenta"], [settingMap[order.machine_code]?.defaultProductivityKgH ?? 1000, "padrao"]];
        const productivity = sources.find(([value]) => value > 0) ?? [1000, "padrao" as const];
        const cycle = rawCycles.find((item) => item.production_order_id === order.id)?.tool_heating_cycles;
        const toolHeatingState = cycle?.status === "released" ? "released" : cycle?.status === "heating" ? "heating" : "waiting";
        const toolReadyAt = cycle?.status === "released" ? new Date() : cycle?.expected_ready_at ? new Date(cycle.expected_ready_at) : null;
        return { id: order.id, orderNumber: order.order_number, planCode: order.plan_code ?? "—", machineCode: order.machine_code, toolCode: order.tool_code, alloyCode: order.alloy_code ?? "SEM LIGA", alternativeAlloys: rawAlloys.filter((item) => item.tool_code.toUpperCase() === order.tool_code.toUpperCase() && !item.is_primary).map((item) => item.alloy_code), targetKg: numberValue(order.target_kg), producedKg: numberValue(order.produced_kg), sequence: order.sequence ?? 9999, dueDate: order.due_date, status: order.status, productivityKgH: productivity[0] as number, productivitySource: productivity[1] as ProductivitySource, toolReadyAt, toolHeatingState } satisfies LoadOrderInput;
      });
      setOrders(input); setSettings(settingMap);
      setShifts((productionSettings.shifts ?? []).map((shift) => ({ id: shift.id, code: shift.code, name: shift.name, startTime: shift.start_time.slice(0, 5), endTime: shift.end_time.slice(0, 5), breakMinutes: shift.break_minutes, machineCodes: shift.machine_codes ?? [], isActive: shift.is_active })));
      const initialStart = new Date();
      setStartedAt(initialStart);
      setStartInput(toInputDateTime(initialStart));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível montar a simulação.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const visibleOrders = useMemo(() => {
    const assigned = orders.filter((order) => !allowedMachines || allowedMachines.has(order.machineCode));
    return machine === "all" ? assigned : assigned.filter((order) => order.machineCode === machine);
  }, [orders, machine, allowedMachines]);
  const orderedVisibleOrders = useMemo(() => {
    if (mode !== "manual") return visibleOrders;
    return visibleOrders.map((order) => {
      const machineOrder = manualOrder[order.machineCode] ?? [];
      const position = machineOrder.indexOf(order.id);
      return { ...order, sequence: position >= 0 ? position + 1 : machineOrder.length + order.sequence };
    });
  }, [visibleOrders, mode, manualOrder]);
  const machineOptions = [...new Set(orders.map((order) => order.machineCode).filter((code) => !allowedMachines || allowedMachines.has(code)))].sort();
  const simulationState = useMemo(() => {
    if (!startedAt) return { simulation: null, problem: "" };
    try { return { simulation: simulateMachineLoad(orderedVisibleOrders, settings, startedAt, mode === "manual" ? "fifo" : mode, shifts), problem: "" }; }
    catch (cause) { return { simulation: null, problem: cause instanceof Error ? cause.message : "Não foi possível aplicar os turnos." }; }
  }, [orderedVisibleOrders, settings, startedAt, mode, shifts]);

  if (loading) return <div className="grid min-h-72 place-items-center rounded-2xl border bg-white"><Loader2 className="size-7 animate-spin text-orange-500" /></div>;
  if (error) return <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-5 text-sm font-semibold text-red-700"><TriangleAlert className="size-5" />{error}<Button variant="outline" size="sm" onClick={load}>Tentar novamente</Button></div>;
  if (simulationState.problem) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900"><div className="flex items-start gap-3"><TriangleAlert className="mt-0.5 size-5 shrink-0" /><div><strong className="block">Simulação aguardando calendário de produção</strong><p className="mt-1">{simulationState.problem}</p><a href="/configuracoes/producao" className="mt-3 inline-flex rounded-xl bg-amber-900 px-3 py-2 text-xs font-bold text-white">Cadastrar ou ajustar turnos</a></div></div></div>;
  const simulation = simulationState.simulation;
  if (!simulation) return null;
  const simulatedMachines = simulation.machines;
  const estimatedEnd = simulation.machines.reduce<Date | null>((latest, item) => !item.endsAt ? latest : !latest || item.endsAt > latest ? item.endsAt : latest, null);
  function activateManualMode() {
    if (mode !== "manual") {
      setManualOrder(Object.fromEntries(simulatedMachines.map((item) => [item.machineCode, item.items.map((row) => row.id)])));
    }
    setMode("manual");
  }
  function moveManualOrder(machineCode: string, draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    setManualOrder((current) => {
      const fallback = simulatedMachines.find((item) => item.machineCode === machineCode)?.items.map((item) => item.id) ?? [];
      const sequence = [...(current[machineCode] ?? fallback)];
      const from = sequence.indexOf(draggedId);
      const to = sequence.indexOf(targetId);
      if (from < 0 || to < 0) return current;
      sequence.splice(from, 1);
      sequence.splice(to, 0, draggedId);
      return { ...current, [machineCode]: sequence };
    });
  }

  return <div className="space-y-4">
    <section className="flex flex-wrap items-center gap-2 rounded-2xl border bg-white p-3 shadow-sm">
      <select value={machine} onChange={(event) => setMachine(event.target.value)} className="h-10 rounded-xl border bg-white px-3 text-sm font-semibold"><option value="all">{allowedMachines ? "Minhas prensas" : "Todas as prensas"}</option>{machineOptions.map((code) => <option key={code} value={code}>{machineLabel(code)}</option>)}</select>
      <label className="flex h-10 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-semibold text-slate-600">Início da simulação<input type="datetime-local" value={startInput} onChange={(event) => { setStartInput(event.target.value); const parsed = parseInputDateTime(event.target.value); if (parsed) setStartedAt(parsed); }} className="min-w-0 bg-transparent text-sm font-bold text-slate-900 outline-none" /></label>
      <div className="flex rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => setMode("fifo")} className={`rounded-lg px-3 py-2 text-xs font-bold ${mode === "fifo" ? "bg-white shadow-sm" : "text-slate-500"}`}>FIFO</button><button type="button" onClick={() => setMode("optimized")} className={`rounded-lg px-3 py-2 text-xs font-bold ${mode === "optimized" ? "bg-white shadow-sm" : "text-slate-500"}`}>Sequência sugerida</button><button type="button" onClick={activateManualMode} className={`flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold ${mode === "manual" ? "bg-orange-500 text-white shadow-sm" : "text-slate-500"}`}><GripVertical className="size-3.5" />Sequência manual</button></div>
      <span className="ml-auto text-xs text-slate-500">Base: {formatDateTime(startedAt)}</span>
      <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">{shifts.filter((shift) => shift.isActive).map((shift) => `${shift.code} ${shift.startTime}–${shift.endTime}`).join(" · ")}</span>
      <Button variant="outline" size="sm" onClick={load}><RefreshCw className="size-4" />Atualizar</Button>
    </section>

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Metric icon={Boxes} label="Carga ativa" value={`${formatNumber(simulation.totalDemandKg, 0)} kg`} />
      <Metric icon={Gauge} label="Tempo teórico" value={formatDuration(simulation.totalTheoreticalMinutes)} tone="orange" />
      <Metric icon={CalendarClock} label="Término simulado" value={formatDateTime(estimatedEnd)} tone="blue" />
      <Metric icon={PackageOpen} label="Barras a preparar" value={`${simulation.totalBars}`} tone="violet" />
      <Metric icon={Route} label="Itens na sequência" value={`${simulation.machines.reduce((sum, item) => sum + item.items.length, 0)}`} tone="green" />
    </section>
    <ThermalCoveragePanel machines={simulation.machines} />
    <AlloyWarnings machines={simulation.machines} />

    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b px-4 py-3"><div><h2 className="font-heading font-bold text-slate-900">Simulação operacional</h2><p className="text-xs text-slate-500">Prensa + ferramenta/forno + tarugo/liga.</p></div><div className="flex rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => setTab("timeline")} className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === "timeline" ? "bg-white shadow-sm" : "text-slate-500"}`}><Clock3 className="mr-1 inline size-3.5" />Linha do tempo</button><button type="button" onClick={() => setTab("billets")} className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === "billets" ? "bg-white shadow-sm" : "text-slate-500"}`}><PackageOpen className="mr-1 inline size-3.5" />Carga de tarugo</button></div></div>
      {tab === "timeline" ? <Timeline machines={simulation.machines} manual={mode === "manual"} onMove={moveManualOrder} /> : <BilletTable billets={simulation.billets} settings={settings} />}
    </section>
    <div className="flex items-start gap-2 rounded-xl bg-blue-50 px-4 py-3 text-xs text-blue-800"><Settings2 className="mt-0.5 size-4 shrink-0" /><p><strong>Premissas da V1:</strong> barra de 415 kg, eficiência de 85% e 21 vagas por prensa. As 4 h são a regra operacional cadastrada e a cobertura térmica respeita os turnos. Estoque físico ainda é apresentado como carga necessária.</p></div>
  </div>;
}

function ThermalCoveragePanel({ machines }: { machines: ReturnType<typeof simulateMachineLoad>["machines"] }) {
  const statusConfig = {
    protected: { label: "Cobertura protegida", detail: "A sequência mantém ferramentas prontas sem espera térmica prevista.", shell: "border-emerald-200 bg-emerald-50", badge: "bg-emerald-600 text-white", icon: "text-emerald-600" },
    attention: { label: "Mix curto exige atenção", detail: "Não há parada prevista, mas o mix curto ou a ocupação dos fornos reduz a margem.", shell: "border-amber-200 bg-amber-50", badge: "bg-amber-500 text-white", icon: "text-amber-600" },
    risk: { label: "Risco de falta de ferramenta", detail: "A prensa alcança a próxima ferramenta antes do fim do aquecimento.", shell: "border-red-200 bg-red-50", badge: "bg-red-600 text-white", icon: "text-red-600" },
  } as const;
  if (!machines.length) return null;
  return <section className="grid gap-3 xl:grid-cols-2">
    {machines.map((machine) => {
      const coverage = machine.thermalCoverage;
      const visual = statusConfig[coverage.status];
      return <article key={machine.machineCode} className={`rounded-2xl border px-4 py-3 shadow-sm ${visual.shell}`}>
        <div className="flex flex-wrap items-center gap-2">
          <ShieldCheck className={`size-5 ${visual.icon}`} />
          <div className="min-w-0"><h3 className="text-sm font-black text-slate-900">Cobertura térmica · {machineLabel(machine.machineCode)}</h3><p className="text-[11px] text-slate-600">{visual.detail}</p></div>
          <span className={`ml-auto rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wide ${visual.badge}`}>{visual.label}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Compact label={`Mix mínimo (${formatDuration(coverage.heatingHorizonMinutes)})`} value={`${formatNumber(coverage.minimumMixKg, 0)} kg`} />
          <Compact label="Carga protegida" value={`${formatNumber(coverage.protectedBufferKg, 0)} kg`} />
          <Compact label="Itens abaixo de 300 kg" value={`${coverage.shortRunCount} · máx. ${coverage.maxConsecutiveShortRuns} seguidos`} />
          <Compact label="Pico de vagas" value={`${coverage.peakOvenSlotsUsed}/${coverage.ovenSlots}`} />
        </div>
        {coverage.status === "risk" ? <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-red-200 bg-white/70 px-3 py-2 text-[11px] text-red-800"><TriangleAlert className="size-4 shrink-0" /><strong>{formatDuration(coverage.predictedIdleMinutes)} de espera térmica</strong><span>Primeiro risco: {coverage.firstRiskToolCode} · {formatDateTime(coverage.firstRiskAt)}</span></div> : coverage.nextToolToHeat ? <p className="mt-2 text-[11px] text-slate-600"><strong>Próxima preparação:</strong> {coverage.nextToolToHeat} deve entrar no forno até {formatDateTime(coverage.nextHeatingDeadlineAt)}.</p> : null}
      </article>;
    })}
  </section>;
}

function Metric({ icon: Icon, label, value, tone = "slate" }: { icon: typeof Gauge; label: string; value: string; tone?: "slate" | "orange" | "blue" | "violet" | "green" }) {
  const colors = { slate: "bg-slate-100 text-slate-700", orange: "bg-orange-50 text-orange-600", blue: "bg-blue-50 text-blue-600", violet: "bg-violet-50 text-violet-600", green: "bg-emerald-50 text-emerald-600" };
  return <div className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm"><span className={`grid size-10 place-items-center rounded-xl ${colors[tone]}`}><Icon className="size-5" /></span><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="text-lg font-black text-slate-900">{value}</p></div></div>;
}

function AlloyWarnings({ machines }: { machines: ReturnType<typeof simulateMachineLoad>["machines"] }) {
  const transitions = machines.flatMap((machine) => machine.items.slice(1).flatMap((item, index) => {
    const previous = machine.items[index];
    if (previous.selectedAlloy === item.selectedAlloy || previous.billetBalanceAfterKg < 0.1) return [];
    const accepted = item.alternativeAlloys.map((alloy) => alloy.trim().toUpperCase()).includes(previous.selectedAlloy.trim().toUpperCase());
    return [{ machine: machine.machineCode, from: previous.selectedAlloy, to: item.selectedAlloy, balance: previous.billetBalanceAfterKg, accepted }];
  }));
  if (!transitions.length) return <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800"><span className="grid size-6 place-items-center rounded-full bg-white font-black">✓</span><p><strong>Sequência eficiente de ligas.</strong> Não há sobra relevante antes de uma virada incompatível.</p></div>;
  return <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-950"><div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" /><div><p className="font-bold">Atenção ao consumo de tarugo antes da troca de liga</p><div className="mt-1 space-y-1">{transitions.map((transition) => <p key={`${transition.machine}-${transition.from}-${transition.to}`}>Prensa {transition.machine}: sobram <strong>{formatNumber(transition.balance)} kg de {transition.from}</strong> antes de {transition.to}. {transition.accepted ? "A próxima ferramenta aceita essa liga como alternativa; confirme o uso." : "As ligas são incompatíveis: reordene a sequência ou distribua o saldo antes da virada."}</p>)}</div></div></div></section>;
}

function Timeline({ machines, manual, onMove }: {
  machines: ReturnType<typeof simulateMachineLoad>["machines"];
  manual: boolean;
  onMove: (machineCode: string, draggedId: string, targetId: string) => void;
}) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  return <div className="divide-y">
    {manual && <div className="flex items-center gap-2 bg-orange-50 px-4 py-2 text-xs font-semibold text-orange-800">
      <GripVertical className="size-4" />
      Arraste uma linha pela alça para testar outra sequência. Horários, barras e saldo de tarugo são recalculados automaticamente.
    </div>}
    {machines.map((machine) => <div key={machine.machineCode} className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div><strong>{machineLabel(machine.machineCode)}</strong><span className="ml-2 text-xs text-slate-500">{machine.items.length} item(ns) · inicia {formatDateTime(machine.startsAt)} · termina {formatDateTime(machine.endsAt)}</span></div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">realista {formatDuration(machine.simulatedMinutes)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1260px] text-left text-xs">
          <thead className="bg-slate-50 text-[9px] uppercase tracking-wide text-slate-500">
            <tr><th className="px-3 py-2"># / Ferramenta</th><th className="px-3 py-2">Plano</th><th className="px-3 py-2">Pedido / ordem</th><th className="px-3 py-2">Qtd. pedida</th><th className="px-3 py-2">Saldo do pedido</th><th className="px-3 py-2">Preparação</th><th className="px-3 py-2">Início</th><th className="px-3 py-2">Duração</th><th className="px-3 py-2">Fim</th><th className="px-3 py-2">Produtividade</th><th className="px-3 py-2">Liga / barras</th><th className="px-3 py-2 text-right">Saldo de tarugo</th></tr>
          </thead>
          <tbody>{machine.items.map((item, index) => <tr
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
            onDragLeave={() => setOverId((current) => current === item.id ? null : current)}
            onDrop={(event) => {
              event.preventDefault();
              const sourceId = draggedId ?? event.dataTransfer.getData("text/plain");
              if (sourceId) onMove(machine.machineCode, sourceId, item.id);
              setDraggedId(null);
              setOverId(null);
            }}
            onDragEnd={() => { setDraggedId(null); setOverId(null); }}
            className={`border-t transition ${manual ? "cursor-grab active:cursor-grabbing" : ""} ${draggedId === item.id ? "opacity-40" : ""} ${overId === item.id ? "bg-orange-100 ring-2 ring-inset ring-orange-400" : "hover:bg-orange-50/30"}`}
          >
            <td className="px-3 py-2.5"><span className="inline-flex items-center"><span className="mr-2 text-slate-400">{String(index + 1).padStart(2, "0")}</span>{manual && <GripVertical className="mr-2 size-4 text-orange-500" aria-label={`Arrastar ${item.toolCode}`} />}<strong className="font-mono text-orange-600">{item.toolCode}</strong></span></td>
            <td className="px-3 py-2.5 font-bold">{item.planCode}</td>
            <td className="px-3 py-2.5 font-mono font-bold text-slate-700">{item.orderNumber}</td>
            <td className="px-3 py-2.5 font-bold tabular-nums">{formatNumber(item.targetKg)} kg</td>
            <td className="px-3 py-2.5 font-bold tabular-nums text-blue-700">{formatNumber(item.remainingKg)} kg</td>
            <td className="px-3 py-2.5"><span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-bold ${item.thermalWaitMinutes > 0.5 ? "bg-red-100 text-red-700" : item.toolHeatingState === "released" ? "bg-emerald-50 text-emerald-700" : item.toolHeatingState === "heating" ? "bg-orange-50 text-orange-700" : "bg-amber-50 text-amber-700"}`}><Flame className="size-3" />{item.thermalWaitMinutes > 0.5 ? `Espera ${formatDuration(item.thermalWaitMinutes)}` : item.toolHeatingState === "released" ? "Liberada" : item.toolHeatingState === "heating" ? "Aquecendo" : "Simulada 4h"}</span>{item.ovenSlotNumber && item.toolHeatingState !== "released" && <span className="mt-1 block text-[9px] text-slate-400">Vaga {item.ovenSlotNumber} · entrar até {formatDateTime(item.latestHeatingStartAt)}</span>}</td>
            <td className="px-3 py-2.5 tabular-nums">{formatDateTime(item.extrusionStartAt)}</td>
            <td className="px-3 py-2.5 font-bold tabular-nums">{formatDuration(item.theoreticalMinutes)}</td>
            <td className="px-3 py-2.5 tabular-nums">{formatDateTime(item.endAt)}</td>
            <td className="px-3 py-2.5"><strong>{formatNumber(item.productivityKgH, 0)} kg/h</strong><span className="block text-[9px] text-slate-400">{sourceLabel[item.productivitySource]}</span></td>
            <td className="px-3 py-2.5"><strong>{item.selectedAlloy}</strong><span className="block text-[10px] text-slate-400">+{item.billetBarsLoaded} barra(s)</span></td>
            <td className="px-3 py-2.5 text-right font-bold tabular-nums text-violet-700">{formatNumber(item.billetBalanceAfterKg)} kg</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>)}
  </div>;
}
function BilletTable({ billets, settings }: { billets: ReturnType<typeof simulateMachineLoad>["billets"]; settings: Record<string, MachineLoadSettings> }) {
  const base = Object.values(settings)[0] ?? defaultSettings;
  return <div><div className="grid gap-3 border-b bg-slate-50/70 p-4 sm:grid-cols-3"><Compact label="Peso da barra" value={`${formatNumber(base.billetBarWeightKg, 0)} kg`} /><Compact label="Eficiência" value={`${formatNumber(base.extrusionEfficiency * 100, 0)}%`} /><Compact label="Produto útil / barra" value={`${formatNumber(base.billetBarWeightKg * base.extrusionEfficiency, 2)} kg`} /></div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-sm"><thead className="text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Liga</th><th className="px-4 py-3 text-right">Demanda programada</th><th className="px-4 py-3 text-right">Tarugo teórico</th><th className="px-4 py-3 text-right">Barras</th><th className="px-4 py-3 text-right">Carga disponível</th><th className="px-4 py-3 text-right">Saldo final estimado</th></tr></thead><tbody>{billets.map((row) => <tr key={row.alloyCode} className="border-t"><td className="px-4 py-3 font-mono font-black text-orange-600">{row.alloyCode}</td><td className="px-4 py-3 text-right font-bold">{formatNumber(row.demandKg)} kg</td><td className="px-4 py-3 text-right">{formatNumber(row.rawRequiredKg)} kg</td><td className="px-4 py-3 text-right text-lg font-black">{row.bars}</td><td className="px-4 py-3 text-right">{formatNumber(row.loadedKg)} kg</td><td className="px-4 py-3 text-right font-bold text-emerald-600">{formatNumber(row.endingBalanceKg)} kg</td></tr>)}</tbody></table></div></div>;
}

function Compact({ label, value }: { label: string; value: string }) { return <div><p className="text-[9px] font-bold uppercase text-slate-400">{label}</p><p className="font-black text-slate-900">{value}</p></div>; }
