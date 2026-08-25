"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, CircleGauge, Clock3, EyeOff, Loader2, PackageSearch, Search, ShieldAlert, Target, UsersRound, X } from "lucide-react";
import { PcpDataImports } from "@/components/pcp-data-imports";
import { Input } from "@/components/ui/input";
import { createClient, withSupabaseTimeout } from "@/lib/supabase/client";
import type { OrderPortfolioRow, PcpImportBatch, PcpImportType } from "@/types/database";

type HistorySummary = { order_key: string; first_programming_date: string | null; first_plan_date: string | null; last_plan_date: string | null; plan_count: number; lot_count: number; planned_kg: number; planned_pieces: number; fulfilled_kg: number; fulfilled_pieces: number };
type ActivePlan = { id: string; plan_code: string | null; order_number: string; tool_code: string; customer_name: string | null; target_kg: number | null; target_quantity: number | null; demand_unit: "kg" | "pieces" | "bars"; due_date: string | null };
type ToolLife = { tool_code: string; physical_tool_count: number; available_tool_count: number; remaining_life_kg: number; useful_life_kg: number; produced_kg: number };
type AnalysisStatus = "full" | "partial" | "unplanned" | "over" | "attended";
type StatusFilter = "all" | AnalysisStatus;
type Period = "all" | "overdue" | "today" | "3" | "7" | "15" | "30";
type AnalysisRow = OrderPortfolioRow & { history: HistorySummary | null; portfolioPlanned: boolean; currentPlannedUnit: number; plannedUnit: number; plannedKg: number; balanceUnit: number; kgPerPiece: number; statusKey: AnalysisStatus; daysToDue: number | null; leadDays: number | null };
type CachePayload = { batches: Partial<Record<PcpImportType, PcpImportBatch>>; portfolio: OrderPortfolioRow[]; history: HistorySummary[]; activePlans: ActivePlan[]; toolLives: ToolLife[] };

const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
const cacheKey = "alummes-pcp-analysis-cache-v1";
const periods: { key: Period; label: string }[] = [
  { key: "all", label: "Todos" }, { key: "overdue", label: "Atrasados" }, { key: "today", label: "Hoje" },
  { key: "3", label: "3 dias" }, { key: "7", label: "7 dias" }, { key: "15", label: "15 dias" }, { key: "30", label: "30 dias" },
];

const num = (value: unknown) => Number(value ?? 0) || 0;
const norm = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const toolKey = (value: unknown) => { const key = norm(value); return key.startsWith("SF") ? key.slice(2) : key; };
const isSfTool = (value: unknown) => norm(value).startsWith("SF");
const customerKey = (tool: unknown, customer: unknown) => `${toolKey(tool)}|${norm(customer)}`;
const dateAtNoon = (value: string) => new Date(`${value}T12:00:00`);
const today = () => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12); };
const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 86400000);
const formatKg = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`;
const formatNumber = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const formatDate = (value: string | null) => value ? dateAtNoon(value).toLocaleDateString("pt-BR") : "—";
const compactReference = (value: string | null) => value && !/GMT|Horário Padrão de Brasília|Brasilia Standard Time/i.test(value) ? value : "—";

async function loadAll<T>(table: string, select: string, equalities: Record<string, string>, orderFields: string[] = []) {
  const rows: T[] = [];
  for (let start = 0; ; start += 1000) {
    let query = createClient().from(table).select(select);
    for (const [column, value] of Object.entries(equalities)) query = query.eq(column, value);
    for (const field of orderFields) query = query.order(field);
    query = query.range(start, start + 999);
    const { data, error } = await withSupabaseTimeout(query, 20000);
    if (error) throw error;
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

function numericPortfolio(row: OrderPortfolioRow): OrderPortfolioRow {
  return { ...row, ordered_kg: num(row.ordered_kg), ordered_pieces: num(row.ordered_pieces), balance_kg: num(row.balance_kg), balance_pieces: num(row.balance_pieces), committed_kg: num(row.committed_kg), committed_pieces: num(row.committed_pieces), produced_kg: num(row.produced_kg), produced_pieces: num(row.produced_pieces), packed_kg: num(row.packed_kg), packed_pieces: num(row.packed_pieces), invoiced_kg: num(row.invoiced_kg), invoiced_pieces: num(row.invoiced_pieces) };
}

function getStatus(balance: number, planned: number, portfolioPlanned: boolean): AnalysisStatus {
  if (balance <= 0.0001) return "attended";
  if (planned <= 0.0001) return portfolioPlanned ? "full" : "unplanned";
  if (planned < balance * 0.995) return "partial";
  if (planned > balance * 1.005) return "over";
  return "full";
}

function statusMeta(status: AnalysisStatus) {
  return {
    full: ["Planejado integralmente", "bg-emerald-50 text-emerald-700"], partial: ["Planejado parcialmente", "bg-amber-50 text-amber-700"],
    unplanned: ["Não planejado", "bg-red-50 text-red-700"], over: ["Acima da necessidade", "bg-violet-50 text-violet-700"],
    attended: ["Atendido / sem saldo", "bg-slate-100 text-slate-600"],
  }[status];
}

function dueMeta(days: number | null) {
  if (days === null) return ["Sem data", "text-slate-500 bg-slate-100"];
  if (days < 0) return [`${Math.abs(days)}d atrasado`, "text-red-700 bg-red-50"];
  if (days === 0) return ["Entrega hoje", "text-orange-700 bg-orange-50"];
  if (days <= 3) return [`Em ${days}d`, "text-amber-700 bg-amber-50"];
  return [`Em ${days}d`, "text-slate-600 bg-slate-100"];
}

export function PcpPlanningAnalysis() {
  const [batches, setBatches] = useState<Partial<Record<PcpImportType, PcpImportBatch>>>({});
  const [portfolio, setPortfolio] = useState<OrderPortfolioRow[]>([]);
  const [history, setHistory] = useState<HistorySummary[]>([]);
  const [activePlans, setActivePlans] = useState<ActivePlan[]>([]);
  const [toolLives, setToolLives] = useState<ToolLife[]>([]);
  const [selectedTool, setSelectedTool] = useState("");
  const [period, setPeriod] = useState<Period>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [hideSfTools, setHideSfTools] = useState(true);
  const [insightsCollapsed, setInsightsCollapsed] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);

  const load = useCallback(async () => {
    if (!organizationId) { setError("Organização padrão não configurada."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const supabase = createClient();
      const { data: batchRows, error: batchError } = await withSupabaseTimeout(supabase.from("pcp_import_batches").select("id,organization_id,import_type,file_name,source_sheet,row_count,status,imported_by_name,imported_at,processed_at,metadata").eq("organization_id", organizationId).eq("status", "processed").order("imported_at", { ascending: false }).limit(20), 20000);
      if (batchError) throw batchError;
      const latest: Partial<Record<PcpImportType, PcpImportBatch>> = {};
      for (const batch of (batchRows ?? []) as PcpImportBatch[]) if (!latest[batch.import_type]) latest[batch.import_type] = batch;
      const portfolioBatch = latest.order_portfolio;
      const portfolioRows = portfolioBatch ? await loadAll<OrderPortfolioRow>("order_portfolio", "id,import_batch_id,source_row,order_key,order_number,customer_name,customer_order_number,implantation_date,due_date,scheduled_date,product_code,tool_code,service_unit,ordered_kg,ordered_pieces,balance_kg,balance_pieces,committed_kg,committed_pieces,produced_kg,produced_pieces,packed_kg,packed_pieces,invoiced_kg,invoiced_pieces,priority,alloy_code,temper,status,item_status,special_conditions", { organization_id: organizationId, import_batch_id: portfolioBatch.id }, ["due_date", "source_row"]) : [];
      const orderKeys = [...new Set(portfolioRows.map((row) => row.order_key).filter(Boolean))];
      const historyRows: HistorySummary[] = [];
      for (let start = 0; start < orderKeys.length; start += 150) {
        const { data, error: historyError } = await withSupabaseTimeout(supabase.from("pcp_latest_planning_summary").select("order_key,first_programming_date,first_plan_date,last_plan_date,plan_count,lot_count,planned_kg,planned_pieces,fulfilled_kg,fulfilled_pieces").eq("organization_id", organizationId).in("order_key", orderKeys.slice(start, start + 150)), 20000);
        if (historyError) throw historyError;
        historyRows.push(...((data ?? []) as HistorySummary[]));
      }
      const { data: planRows, error: planError } = await withSupabaseTimeout(supabase.from("production_orders").select("id,plan_code,order_number,tool_code,customer_name,target_kg,target_quantity,demand_unit,due_date").eq("organization_id", organizationId).eq("is_active", true).in("status", ["planned", "released", "in_progress", "paused"]), 20000);
      if (planError) throw planError;
      const toolCodes = [...new Set(portfolioRows.flatMap((row) => row.tool_code ? [String(row.tool_code), String(row.tool_code).replace(/^SF/i, "")] : []).filter(Boolean))];
      const lifeRows: ToolLife[] = [];
      for (let start = 0; start < toolCodes.length; start += 150) {
        const { data, error: lifeError } = await withSupabaseTimeout(supabase.from("pcp_tool_life_summary").select("tool_code,physical_tool_count,available_tool_count,remaining_life_kg,useful_life_kg,produced_kg").eq("organization_id", organizationId).in("tool_code", toolCodes.slice(start, start + 150)), 20000);
        if (lifeError) throw lifeError;
        lifeRows.push(...((data ?? []) as ToolLife[]));
      }
      const payload: CachePayload = { batches: latest, portfolio: portfolioRows.map(numericPortfolio), history: historyRows.map((row) => ({ ...row, plan_count: num(row.plan_count), lot_count: num(row.lot_count), planned_kg: num(row.planned_kg), planned_pieces: num(row.planned_pieces), fulfilled_kg: num(row.fulfilled_kg), fulfilled_pieces: num(row.fulfilled_pieces) })), activePlans: ((planRows ?? []) as ActivePlan[]).map((row) => ({ ...row, target_kg: row.target_kg === null ? null : num(row.target_kg), target_quantity: row.target_quantity === null ? null : num(row.target_quantity) })), toolLives: lifeRows.map((row) => ({ ...row, physical_tool_count: num(row.physical_tool_count), available_tool_count: num(row.available_tool_count), remaining_life_kg: num(row.remaining_life_kg), useful_life_kg: num(row.useful_life_kg), produced_kg: num(row.produced_kg) })) };
      window.localStorage.setItem(cacheKey, JSON.stringify(payload));
      setBatches(payload.batches); setPortfolio(payload.portfolio); setHistory(payload.history); setActivePlans(payload.activePlans); setToolLives(payload.toolLives); setOffline(false);
    } catch (cause) {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) {
        const payload = JSON.parse(cached) as CachePayload;
        setBatches(payload.batches); setPortfolio(payload.portfolio); setHistory(payload.history); setActivePlans(payload.activePlans); setToolLives(payload.toolLives); setOffline(true);
      } else setError(cause instanceof Error ? cause.message : "Não foi possível carregar a análise.");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void Promise.resolve().then(load); }, [load, reloadToken]);

  const scopedPortfolio = useMemo(() => hideSfTools ? portfolio.filter((row) => !isSfTool(row.tool_code)) : portfolio, [portfolio, hideSfTools]);

  const tools = useMemo(() => {
    const grouped = new Map<string, { code: string; overdue: number; earliest: number }>();
    for (const row of scopedPortfolio) {
      if (!row.tool_code || (row.balance_kg <= 0 && row.balance_pieces <= 0)) continue;
      const key = toolKey(row.tool_code); const due = row.due_date ? dateAtNoon(row.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      const current = grouped.get(key) ?? { code: row.tool_code, overdue: 0, earliest: due };
      current.overdue += row.due_date && dateAtNoon(row.due_date) < today() ? 1 : 0; current.earliest = Math.min(current.earliest, due); grouped.set(key, current);
    }
    return [...grouped.values()].sort((a, b) => b.overdue - a.overdue || a.earliest - b.earliest || a.code.localeCompare(b.code));
  }, [scopedPortfolio]);

  const analysis = useMemo(() => {
    const historyByOrder = new Map(history.map((row) => [row.order_key, row]));
    const matchingRows = scopedPortfolio.filter((row) => !selectedTool || toolKey(row.tool_code) === toolKey(selectedTool)).sort((a, b) => {
      const dateA = a.due_date ? dateAtNoon(a.due_date).getTime() : Number.MAX_SAFE_INTEGER; const dateB = b.due_date ? dateAtNoon(b.due_date).getTime() : Number.MAX_SAFE_INTEGER;
      return dateA - dateB || (a.implantation_date ?? "").localeCompare(b.implantation_date ?? "") || (a.priority ?? 999) - (b.priority ?? 999);
    });
    const pools = new Map<string, { kg: number; pieces: number }>();
    for (const plan of activePlans.filter((item) => (!hideSfTools || !isSfTool(item.tool_code)) && (!selectedTool || toolKey(item.tool_code) === toolKey(selectedTool)))) {
      const key = customerKey(plan.tool_code, plan.customer_name); const pool = pools.get(key) ?? { kg: 0, pieces: 0 };
      if (plan.demand_unit === "kg") pool.kg += num(plan.target_kg); else pool.pieces += num(plan.target_quantity);
      pools.set(key, pool);
    }
    const result: AnalysisRow[] = [];
    const lastByPool = new Map<string, number>();
    for (const row of matchingRows) {
      const historyRow = historyByOrder.get(row.order_key) ?? null;
      const balanceUnit = row.service_unit === "pieces" ? row.balance_pieces : row.balance_kg;
      const kgPerPiece = row.balance_pieces > 0 ? row.balance_kg / row.balance_pieces : row.ordered_pieces > 0 ? row.ordered_kg / row.ordered_pieces : 0;
      const portfolioPlanned = norm(row.status).includes("PLANEJ");
      const key = customerKey(row.tool_code, row.customer_name); const pool = pools.get(key) ?? { kg: 0, pieces: 0 };
      const available = row.service_unit === "pieces" ? pool.pieces : pool.kg;
      const currentPlannedUnit = Math.min(balanceUnit, available);
      if (row.service_unit === "pieces") pool.pieces -= currentPlannedUnit; else pool.kg -= currentPlannedUnit;
      pools.set(key, pool); lastByPool.set(`${key}|${row.service_unit}`, result.length);
      const plannedUnit = currentPlannedUnit;
      const plannedKg = row.service_unit === "pieces" ? currentPlannedUnit * kgPerPiece : currentPlannedUnit;
      const daysToDue = row.due_date ? daysBetween(today(), dateAtNoon(row.due_date)) : null;
      const planDate = historyRow?.first_plan_date || historyRow?.first_programming_date;
      result.push({ ...row, history: historyRow, portfolioPlanned, currentPlannedUnit, plannedUnit, plannedKg, balanceUnit, kgPerPiece, statusKey: getStatus(balanceUnit, plannedUnit, portfolioPlanned), daysToDue, leadDays: row.due_date && planDate ? daysBetween(dateAtNoon(planDate), dateAtNoon(row.due_date)) : null });
    }
    for (const [key, pool] of pools) {
      for (const unitName of ["kg", "pieces"] as const) {
        const left = pool[unitName]; const index = lastByPool.get(`${key}|${unitName}`);
        if (left > 0 && index !== undefined) {
          const row = result[index]; row.currentPlannedUnit += left; row.plannedUnit += left; row.plannedKg += unitName === "pieces" ? left * row.kgPerPiece : left; row.statusKey = getStatus(row.balanceUnit, row.plannedUnit, row.portfolioPlanned);
        }
      }
    }
    return result;
  }, [scopedPortfolio, history, activePlans, selectedTool, hideSfTools]);

  const filteredRows = useMemo(() => analysis.filter((row) => {
    const queryMatch = !query || norm(`${row.tool_code} ${row.customer_name} ${row.order_number} ${row.customer_order_number} ${row.product_code}`).includes(norm(query));
    if (!queryMatch) return false;
    if (statusFilter !== "all" && row.statusKey !== statusFilter) return false;
    if (period === "all") return true; if (period === "overdue") return row.daysToDue !== null && row.daysToDue < 0; if (period === "today") return row.daysToDue === 0;
    return row.daysToDue !== null && row.daysToDue >= 0 && row.daysToDue <= Number(period);
  }), [analysis, period, query, statusFilter]);

  const summary = useMemo(() => {
    const totalKg = analysis.reduce((sum, row) => sum + Math.max(row.balance_kg, 0), 0);
    const plannedKg = analysis.reduce((sum, row) => sum + row.plannedKg, 0);
    const statuses = Object.fromEntries((["full", "partial", "unplanned", "over", "attended"] as AnalysisStatus[]).map((status) => [status, analysis.filter((row) => row.statusKey === status).length])) as Record<AnalysisStatus, number>;
    const overdue = analysis.filter((row) => row.daysToDue !== null && row.daysToDue < 0 && row.balanceUnit > 0).length;
    const clients = new Set(analysis.filter((row) => row.balanceUnit > 0).map((row) => norm(row.customer_name))).size;
    const leadRows = analysis.filter((row) => row.leadDays !== null); const averageLead = leadRows.length ? leadRows.reduce((sum, row) => sum + (row.leadDays ?? 0), 0) / leadRows.length : null;
    const openRows = analysis.filter((row) => row.statusKey !== "attended");
    const coveredRows = openRows.filter((row) => row.statusKey !== "unplanned");
    const balanceKg = analysis.reduce((sum, row) => row.statusKey === "unplanned" ? sum + Math.max(row.balance_kg, 0) : row.statusKey === "partial" ? sum + Math.max(row.balance_kg - row.plannedKg, 0) : sum, 0);
    return { totalKg, plannedKg, balanceKg, coverage: openRows.length ? coveredRows.length / openRows.length : 1, statuses, overdue, clients, averageLead };
  }, [analysis]);

  const attentionTools = useMemo(() => {
    const grouped = new Map<string, { code: string; open: number; unplanned: number; partial: number; overdue: number; balanceKg: number }>();
    for (const row of analysis) {
      if (!row.tool_code || row.balanceUnit <= 0) continue;
      const key = toolKey(row.tool_code);
      const current = grouped.get(key) ?? { code: row.tool_code, open: 0, unplanned: 0, partial: 0, overdue: 0, balanceKg: 0 };
      current.open += 1;
      current.unplanned += row.statusKey === "unplanned" ? 1 : 0;
      current.partial += row.statusKey === "partial" ? 1 : 0;
      current.overdue += row.daysToDue !== null && row.daysToDue < 0 ? 1 : 0;
      current.balanceKg += Math.max(row.balance_kg - row.plannedKg, 0);
      grouped.set(key, current);
    }
    return [...grouped.values()].sort((a, b) => b.overdue - a.overdue || b.unplanned - a.unplanned || b.partial - a.partial || b.balanceKg - a.balanceKg).slice(0, 6);
  }, [analysis]);

  const selectedLife = useMemo(() => toolLives.find((row) => toolKey(row.tool_code) === toolKey(selectedTool)), [toolLives, selectedTool]);
  const remainingLife = num(selectedLife?.remaining_life_kg);
  const lifeMeta = remainingLife >= summary.totalKg ? { label: "Vida suficiente para toda a carteira", color: "text-emerald-700 bg-emerald-50", bar: "bg-emerald-500" } : remainingLife >= summary.plannedKg ? { label: "Atende o planejado, mas não toda a carteira", color: "text-amber-700 bg-amber-50", bar: "bg-amber-500" } : { label: "Vida insuficiente para o planejamento", color: "text-red-700 bg-red-50", bar: "bg-red-500" };

  if (loading) return <div className="grid min-h-[60vh] place-items-center"><div className="text-center"><Loader2 className="mx-auto size-7 animate-spin text-orange-500" /><p className="mt-3 text-sm text-slate-500">Cruzando carteira, planos e ferramentas...</p></div></div>;

  return (
    <div className="space-y-4">
      <PcpDataImports batches={batches} onImported={() => setReloadToken((token) => token + 1)} />
      {offline && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800">Modo offline: exibindo a última análise salva neste computador.</div>}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {!batches.order_portfolio ? <EmptyState /> : <>
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input list="pcp-tools" value={selectedTool} onChange={(event) => setSelectedTool(event.target.value.toUpperCase())} placeholder="Todas as ferramentas — digite para detalhar" className="h-11 px-10 font-mono text-base font-bold" />{selectedTool && <button type="button" onClick={() => setSelectedTool("")} aria-label="Limpar ferramenta" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X className="size-4" /></button>}<datalist id="pcp-tools">{tools.map((tool) => <option key={tool.code} value={tool.code}>{tool.overdue ? `${tool.overdue} pedido(s) atrasado(s)` : "Sem atraso"}</option>)}</datalist></div>
            <div className="relative flex-1"><PackageSearch className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cliente, pedido ou produto" className="h-11 pl-10" /></div>
            <div className="flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">{periods.map((item) => <button key={item.key} type="button" onClick={() => setPeriod(item.key)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${period === item.key ? "bg-white text-orange-600 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}>{item.label}</button>)}</div>
            <div className="flex shrink-0 gap-2"><button type="button" onClick={() => { const next = !hideSfTools; setHideSfTools(next); if (next && isSfTool(selectedTool)) setSelectedTool(""); }} className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition ${hideSfTools ? "border-orange-200 bg-orange-50 text-orange-700" : "bg-white text-slate-600 hover:bg-slate-50"}`}><span className={`grid size-4 place-items-center rounded border ${hideSfTools ? "border-orange-500 bg-orange-500 text-white" : "border-slate-300 bg-white"}`}>{hideSfTools && <Check className="size-3" />}</span><EyeOff className="size-3.5" />Ocultar SF{hideSfTools && <span className="rounded bg-white/70 px-1.5 py-0.5 text-[9px]">{portfolio.length - scopedPortfolio.length}</span>}</button><button type="button" onClick={() => setInsightsCollapsed((value) => !value)} className="inline-flex h-10 items-center gap-1.5 rounded-xl border bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50">{insightsCollapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}{insightsCollapsed ? "Expandir análise" : "Recolher análise"}</button></div>
          </div>
        </section>

        {insightsCollapsed ? <section className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-white px-4 py-2.5 text-xs shadow-sm"><strong className="text-slate-900">Resumo da carteira</strong><span><b className="text-slate-900">{Math.round(summary.coverage * 100)}%</b> coberto</span><span><b className="text-red-600">{summary.overdue}</b> atrasados</span><span><b className="text-slate-900">{summary.statuses.partial}</b> parciais</span><span><b className="text-red-600">{summary.statuses.unplanned}</b> não planejados</span><span className="ml-auto text-slate-400">{tools.length} ferramentas analisadas · SF ocultas: {hideSfTools ? portfolio.length - scopedPortfolio.length : 0}</span></section> : <section className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(520px,.65fr)]">
          <div className="rounded-2xl border bg-[#111927] p-4 text-white shadow-sm">
            {selectedTool ? <>
              <div className="flex items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-orange-400">Ferramenta selecionada</p><h2 className="font-mono text-xl font-black">{selectedTool}</h2></div><span className="hidden text-xs text-slate-400 sm:inline">{selectedLife?.physical_tool_count ?? 0} seq. · {selectedLife?.available_tool_count ?? 0} disponível(is)</span></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold ${lifeMeta.color}`}>{lifeMeta.label}</span></div>
              <div className="mt-3 grid grid-cols-3 gap-2"><DarkMetric label="Vida disponível" value={formatKg(remainingLife)} /><DarkMetric label="Carteira" value={formatKg(summary.totalKg)} /><DarkMetric label="Planejado" value={formatKg(summary.plannedKg)} /></div>
              <div className="mt-2"><div className="mb-1 flex justify-between text-[9px] text-slate-400"><span>Consumo potencial da vida</span><span>{remainingLife > 0 ? Math.round((summary.totalKg / remainingLife) * 100) : 0}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full ${lifeMeta.bar}`} style={{ width: `${Math.min(100, remainingLife > 0 ? (summary.totalKg / remainingLife) * 100 : 100)}%` }} /></div></div>
            </> : <>
              <div className="flex items-center justify-between gap-4"><div className="flex min-w-0 items-center gap-3"><div><p className="text-[9px] font-bold uppercase tracking-[.18em] text-orange-400">Visão consolidada</p><h2 className="text-xl font-black">Toda a carteira</h2></div><span className="hidden text-xs text-slate-400 sm:inline">Clique numa ferramenta abaixo para detalhar.</span></div><span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-[9px] font-bold text-blue-700">{tools.length} ferramentas</span></div>
              <div className="mt-3 grid grid-cols-3 gap-2"><DarkMetric label="Carteira total" value={formatKg(summary.totalKg)} /><DarkMetric label="Planejado" value={formatKg(summary.plannedKg)} /><DarkMetric label="Saldo não planejado" value={formatKg(summary.balanceKg)} /></div>
              <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-0.5"><span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-500">Atenção</span>{attentionTools.map((tool) => <button type="button" key={tool.code} onClick={() => setSelectedTool(tool.code)} className="shrink-0 rounded-lg border border-white/10 bg-white/[.06] px-2.5 py-1.5 text-left transition hover:bg-white/10"><strong className="font-mono text-[10px] text-white">{tool.code}</strong><span className="ml-2 text-[8px] text-slate-400">{tool.unplanned} fora · {tool.overdue} atras.</span></button>)}</div>
            </>}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2"><Metric icon={Target} label="Cobertura" value={`${Math.round(summary.coverage * 100)}%`} detail={`${formatKg(summary.balanceKg)} não planejado`} tone="orange" /><Metric icon={ShieldAlert} label="Atrasados" value={String(summary.overdue)} detail="pedidos com saldo" tone={summary.overdue ? "red" : "green"} /><Metric icon={UsersRound} label="Clientes" value={String(summary.clients)} detail={selectedTool ? "na ferramenta" : "na carteira"} tone="blue" /><Metric icon={Clock3} label="Antecedência" value={summary.averageLead === null ? "—" : `${Math.round(summary.averageLead)}d`} detail="plano → entrega" tone="violet" /></div>
        </section>}

        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div><h2 className="font-heading font-bold text-slate-900">Pedidos e cobertura do planejamento</h2><p className="text-xs text-slate-500">Prioridade automática: prazo de entrega, atraso, implantação e prioridade comercial.</p></div>
            <div className="flex flex-wrap gap-2"><StatusButton label="Todos" count={analysis.length} active={statusFilter === "all"} onClick={() => setStatusFilter("all")} className="bg-slate-100 text-slate-700" /><StatusButton label="Integrais" count={summary.statuses.full} active={statusFilter === "full"} onClick={() => setStatusFilter("full")} className="bg-emerald-50 text-emerald-700" /><StatusButton label="Parciais" count={summary.statuses.partial} active={statusFilter === "partial"} onClick={() => setStatusFilter("partial")} className="bg-amber-50 text-amber-700" /><StatusButton label="Não planejados" count={summary.statuses.unplanned} active={statusFilter === "unplanned"} onClick={() => setStatusFilter("unplanned")} className="bg-red-50 text-red-700" /><StatusButton label="Acima" count={summary.statuses.over} active={statusFilter === "over"} onClick={() => setStatusFilter("over")} className="bg-violet-50 text-violet-700" /><StatusButton label="Atendidos" count={summary.statuses.attended} active={statusFilter === "attended"} onClick={() => setStatusFilter("attended")} className="bg-slate-100 text-slate-600" /></div>
          </div>
          <div className="max-h-[calc(100dvh-390px)] min-h-72 overflow-auto">
            <table className="w-full min-w-[1280px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 text-[9px] uppercase tracking-wider text-slate-500 shadow-[0_1px_0_#e2e8f0]"><tr><th className="px-4 py-3">Urgência</th><th className="px-4 py-3">Ferramenta</th><th className="px-4 py-3">Cliente / pedido</th><th className="px-4 py-3">Implantação</th><th className="px-4 py-3">Entrega</th><th className="px-4 py-3 text-right">Saldo carteira</th><th className="px-4 py-3">Status / histórico</th><th className="px-4 py-3 text-right">Simplificada ativa</th><th className="px-4 py-3 text-right">Saldo não planejado</th><th className="px-4 py-3">Situação</th></tr></thead>
              <tbody>{filteredRows.map((row) => { const status = statusMeta(row.statusKey); const due = dueMeta(row.daysToDue); const unplanned = ["full", "over", "attended"].includes(row.statusKey) ? 0 : Math.max(row.balanceUnit - row.plannedUnit, 0); const unitLabel = row.service_unit === "pieces" ? "pc" : "kg"; return <tr key={row.id} className="border-t hover:bg-orange-50/30"><td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-bold ${due[1]}`}>{due[0]}</span></td><td className="px-4 py-3"><button type="button" onClick={() => setSelectedTool(row.tool_code ?? "")} className="font-mono font-black text-orange-600 hover:underline">{row.tool_code || "—"}</button></td><td className="px-4 py-3"><strong className="block max-w-48 truncate text-slate-900" title={row.customer_name ?? ""}>{row.customer_name || "Sem cliente"}</strong><span className="font-mono text-[10px] text-slate-500">{row.order_number} · {compactReference(row.customer_order_number || row.product_code)}</span></td><td className="px-4 py-3 tabular-nums">{formatDate(row.implantation_date)}</td><td className="px-4 py-3 font-semibold tabular-nums">{formatDate(row.due_date)}</td><td className="px-4 py-3 text-right font-bold tabular-nums">{formatNumber(row.balanceUnit)} {unitLabel}</td><td className="px-4 py-3"><span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-bold ${row.portfolioPlanned ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{row.portfolioPlanned ? "Planejado" : (row.status || "Sem status")}</span><span className="mt-1 block text-[9px] text-slate-400">{row.history?.plan_count ?? 0} planejamento(s) · {row.history?.lot_count ?? 0} lote(s)</span></td><td className="px-4 py-3 text-right font-semibold tabular-nums text-orange-600">{formatNumber(row.currentPlannedUnit)} {unitLabel}</td><td className={`px-4 py-3 text-right font-bold tabular-nums ${unplanned > 0 ? "text-red-600" : "text-emerald-600"}`}>{formatNumber(unplanned)} {unitLabel}</td><td className="px-4 py-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ${status[1]}`}>{status[0]}</span></td></tr>; })}</tbody>
            </table>
            {!filteredRows.length && <div className="grid min-h-52 place-items-center text-sm text-slate-400">Nenhum pedido encontrado para os filtros selecionados.</div>}
          </div>
          <div className="flex items-center justify-between border-t bg-slate-50/60 px-4 py-3 text-xs text-slate-500"><span>{filteredRows.length.toLocaleString("pt-BR")} pedido(s) exibido(s)</span><span>Última carteira: {batches.order_portfolio ? new Date(batches.order_portfolio.imported_at).toLocaleString("pt-BR") : "—"}</span></div>
        </section>
      </>}
    </div>
  );
}

function EmptyState() { return <section className="grid min-h-80 place-items-center rounded-2xl border border-dashed bg-white p-8 text-center"><div><span className="mx-auto grid size-14 place-items-center rounded-2xl bg-orange-50 text-orange-600"><CircleGauge className="size-7" /></span><h2 className="mt-4 font-heading text-lg font-bold">Importe a Carteira para iniciar a análise</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">O sistema cruzará automaticamente pedidos, Histórico, Simplificadas ativas e vida das ferramentas.</p></div></section>; }
function DarkMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-white/[.05] px-3 py-2"><p className="text-[8px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="text-xs font-black tabular-nums text-white">{value}</p></div>; }
function Metric({ icon: Icon, label, value, detail, tone }: { icon: typeof Target; label: string; value: string; detail: string; tone: "orange" | "red" | "green" | "blue" | "violet" }) { const tones = { orange: "bg-orange-50 text-orange-600", red: "bg-red-50 text-red-600", green: "bg-emerald-50 text-emerald-600", blue: "bg-blue-50 text-blue-600", violet: "bg-violet-50 text-violet-600" }; return <div className="rounded-xl border bg-white px-3 py-2 shadow-sm"><div className="flex items-center gap-2"><span className={`grid size-6 place-items-center rounded-md ${tones[tone]}`}><Icon className="size-3.5" /></span><span className="text-[8px] font-bold uppercase tracking-wide text-slate-400">{label}</span></div><div className="mt-1 flex items-baseline gap-2"><p className="text-lg font-black leading-none tabular-nums text-slate-900">{value}</p><p className="truncate text-[9px] text-slate-500">{detail}</p></div></div>; }
function StatusButton({ label, count, className, active, onClick }: { label: string; count: number; className: string; active: boolean; onClick: () => void }) { return <button type="button" onClick={onClick} className={`rounded-full px-2.5 py-1 text-[10px] font-bold transition ${className} ${active ? "ring-2 ring-orange-400 ring-offset-1" : "hover:brightness-95"}`}>{label} {count}</button>; }
