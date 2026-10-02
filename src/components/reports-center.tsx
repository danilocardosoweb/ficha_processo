"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Download, FileBarChart, Flame, Loader2, PlayCircle, ShieldAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

type RawRow = Record<string, unknown>;
type ReportId = "stoppages" | "production" | "heating" | "planning" | "maintenance" | "quality";
type ReportDefinition = {
  id: ReportId;
  title: string;
  description: string;
  icon: typeof FileBarChart;
  source: keyof ReportData;
  dateField: string;
  columns: Array<{ key: string; label: string }>;
  makeRows: (rows: RawRow[]) => Record<string, string | number | null>[];
};
type ReportData = Record<ReportId, RawRow[]>;

const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;

const reports: ReportDefinition[] = [
  {
    id: "stoppages", title: "Paradas de máquina", description: "Ocorrências abertas, encerradas, motivo, responsável e duração registrada.", icon: ShieldAlert, source: "stoppages", dateField: "started_at",
    columns: [{ key: "Prensa", label: "Prensa" }, { key: "Motivo", label: "Motivo" }, { key: "Início", label: "Início" }, { key: "Término", label: "Término" }, { key: "Duração", label: "Duração" }, { key: "Status", label: "Status" }],
    makeRows: (rows) => rows.map((row) => ({ Prensa: `P${text(row.machine_code)}`, Motivo: text(row.reason), Início: dateTime(row.started_at), Término: dateTime(row.ended_at), Duração: duration(row.duration_minutes), Turno: text(row.shift), Responsável: text(row.reported_by_name), Status: statusText(row.status) })),
  },
  {
    id: "production", title: "Produção realizada", description: "Ordens concluídas e em andamento, pesos planejados e produzidos, horários e situação.", icon: PlayCircle, source: "production", dateField: "actual_end",
    columns: [{ key: "Prensa", label: "Prensa" }, { key: "Ferramenta", label: "Ferramenta" }, { key: "Ordem", label: "Ordem" }, { key: "Planejado kg", label: "Planejado" }, { key: "Produzido kg", label: "Produzido" }, { key: "Fim real", label: "Fim real" }, { key: "Status", label: "Status" }],
    makeRows: (rows) => rows.map((row) => ({ Prensa: `P${text(row.machine_code)}`, Ferramenta: text(row.tool_code), Ordem: text(row.order_number), Plano: text(row.plan_code), "Planejado kg": number(row.target_kg), "Produzido kg": number(row.produced_kg), "Início real": dateTime(row.actual_start), "Fim real": dateTime(row.actual_end), Status: statusText(row.status) })),
  },
  {
    id: "heating", title: "Tempo de forno das ferramentas", description: "Entrada, liberação e duração real de cada ciclo de aquecimento por forno e ferramenta.", icon: Flame, source: "heating", dateField: "entered_at",
    columns: [{ key: "Prensa", label: "Prensa" }, { key: "Ferramenta", label: "Ferramenta" }, { key: "Forno", label: "Forno" }, { key: "Entrada", label: "Entrada" }, { key: "Liberação", label: "Liberação" }, { key: "Tempo no forno", label: "Tempo" }, { key: "Status", label: "Status" }],
    makeRows: (rows) => rows.map((row) => ({ Prensa: `P${text(row.machine_code)}`, Ferramenta: text(row.tool_code), Forno: text(row.oven_code), Posição: text(row.oven_position), Tipo: text(row.tool_type), Entrada: dateTime(row.entered_at), "Pronto previsto": dateTime(row.expected_ready_at), Liberação: dateTime(row.released_at), "Tempo no forno": elapsed(row.entered_at, row.released_at, row.cancelled_at), Status: statusText(row.status), Responsável: text(row.entered_by_name) })),
  },
  {
    id: "planning", title: "Carteira e programação", description: "Ordens do planejamento para acompanhar fila, prazo, sequência, peso e situação atual.", icon: FileBarChart, source: "planning", dateField: "due_date",
    columns: [{ key: "Prensa", label: "Prensa" }, { key: "Ferramenta", label: "Ferramenta" }, { key: "Ordem", label: "Ordem" }, { key: "Prazo", label: "Prazo" }, { key: "Planejado kg", label: "Planejado" }, { key: "Status", label: "Status" }],
    makeRows: (rows) => rows.map((row) => ({ Prensa: `P${text(row.machine_code)}`, Ferramenta: text(row.tool_code), Ordem: text(row.order_number), Plano: text(row.plan_code), Cliente: text(row.customer_name), Sequência: text(row.sequence), Prazo: dateOnly(row.due_date), "Planejado kg": number(row.target_kg), "Produzido kg": number(row.produced_kg), Status: statusText(row.status) })),
  },
  {
    id: "maintenance", title: "Atendimentos de manutenção", description: "Chamados abertos pelas paradas, prioridade, responsável e conclusão do atendimento.", icon: Wrench, source: "maintenance", dateField: "opened_at",
    columns: [{ key: "Prensa", label: "Prensa" }, { key: "Ferramenta", label: "Ferramenta" }, { key: "Título", label: "Título" }, { key: "Prioridade", label: "Prioridade" }, { key: "Aberto", label: "Aberto" }, { key: "Concluído", label: "Concluído" }, { key: "Status", label: "Status" }],
    makeRows: (rows) => rows.map((row) => ({ Prensa: text(row.machine_code) ? `P${text(row.machine_code)}` : "—", Ferramenta: text(row.tool_code), Título: text(row.title), Prioridade: text(row.priority), Aberto: dateTime(row.opened_at), Concluído: dateTime(row.completed_at), Status: statusText(row.status) })),
  },
  {
    id: "quality", title: "Inspeções de qualidade", description: "Resultados de inspeção associados às ordens para consulta e exportação.", icon: ClipboardCheck, source: "quality", dateField: "inspected_at",
    columns: [{ key: "Ordem", label: "Ordem" }, { key: "Resultado", label: "Resultado" }, { key: "Inspecionado em", label: "Inspecionado em" }, { key: "Observações", label: "Observações" }],
    makeRows: (rows) => rows.map((row) => ({ Ordem: text(row.production_order_id), Resultado: statusText(row.result), "Inspecionado em": dateTime(row.inspected_at), Observações: text(row.notes) })),
  },
];

export function ReportsCenter() {
  const [data, setData] = useState<ReportData>({ stoppages: [], production: [], heating: [], planning: [], maintenance: [], quality: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ReportId>("stoppages");
  const [period, setPeriod] = useState("all");

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true); setError("");
    try {
      const client = createClient();
      const [stoppages, production, heating, maintenance, quality] = await Promise.all([
        client.from("machine_stoppages").select("machine_code,reason,shift,started_at,ended_at,duration_minutes,status,reported_by_name").eq("organization_id", organizationId).eq("is_deleted", false).order("started_at", { ascending: false }).limit(5000),
        client.from("production_orders").select("machine_code,tool_code,order_number,plan_code,customer_name,sequence,due_date,target_kg,produced_kg,actual_start,actual_end,status").eq("organization_id", organizationId).order("due_date", { ascending: false }).limit(5000),
        client.from("tool_heating_cycles").select("machine_code,tool_code,oven_code,oven_position,tool_type,entered_at,expected_ready_at,released_at,cancelled_at,status,entered_by_name").eq("organization_id", organizationId).order("entered_at", { ascending: false }).limit(5000),
        client.from("maintenance_work_orders").select("machine_code,tool_code,title,priority,status,opened_at,completed_at").eq("organization_id", organizationId).order("opened_at", { ascending: false }).limit(5000),
        client.from("quality_inspections").select("production_order_id,result,notes,inspected_at").eq("organization_id", organizationId).order("inspected_at", { ascending: false }).limit(5000),
      ]);
      const failed = [stoppages, production, heating, maintenance, quality].find((result) => result.error)?.error;
      if (failed) throw failed;
      const productionRows = (production.data ?? []) as RawRow[];
      setData({ stoppages: (stoppages.data ?? []) as RawRow[], production: productionRows, heating: (heating.data ?? []) as RawRow[], planning: productionRows, maintenance: (maintenance.data ?? []) as RawRow[], quality: (quality.data ?? []) as RawRow[] });
    } catch (cause) { setError(message(cause)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const definition = reports.find((report) => report.id === selected) ?? reports[0];
  const reportRows = useMemo(() => definition.makeRows(filterByPeriod(data[definition.source], definition.dateField, period)), [data, definition, period]);
  const preview = reportRows.slice(0, 8);

  return <div className="space-y-5">
    <header><p className="text-xs font-bold uppercase tracking-[.18em] text-orange-600">Acompanhamento · dados operacionais</p><h1 className="mt-1 font-heading text-2xl font-black text-slate-950 min-[1440px]:text-3xl">Relatórios</h1><p className="mt-1 max-w-3xl text-sm text-slate-500">Gere arquivos a partir dos registros reais do aplicativo. Os relatórios não alteram a produção nem os apontamentos.</p></header>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-white p-4 shadow-sm"><div><strong className="text-sm">Período do relatório</strong><p className="text-xs text-slate-500">O filtro é aplicado antes de gerar o arquivo.</p></div><select value={period} onChange={(event) => setPeriod(event.target.value)} className="h-10 rounded-lg border bg-white px-3 text-sm font-semibold"><option value="all">Todo o histórico</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="365">Últimos 12 meses</option></select></div>
    {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">Não foi possível carregar todos os dados: {error}</div>}
    <section className="grid gap-3 sm:grid-cols-2 min-[1440px]:grid-cols-3">{reports.map((report) => { const Icon = report.icon; const active = report.id === selected; const count = filterByPeriod(data[report.source], report.dateField, period).length; return <button key={report.id} type="button" onClick={() => setSelected(report.id)} className={`rounded-2xl border p-4 text-left transition ${active ? "border-orange-300 bg-orange-50 shadow-sm" : "bg-white hover:border-slate-300 hover:shadow-sm"}`}><span className={`mb-3 grid size-10 place-items-center rounded-xl ${active ? "bg-orange-500 text-white" : "bg-slate-100 text-slate-600"}`}><Icon className="size-5" /></span><strong className="block text-sm text-slate-900">{report.title}</strong><span className="mt-1 block min-h-10 text-xs text-slate-500">{report.description}</span><span className="mt-3 block text-xs font-bold text-orange-700">{loading ? "Consultando…" : `${count.toLocaleString("pt-BR")} registro(s)`}</span></button>; })}</section>
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div><h2 className="font-heading font-bold text-slate-900">{definition.title}</h2><p className="text-xs text-slate-500">Prévia de até oito linhas. O arquivo contém todos os registros do período.</p></div><Button disabled={loading || reportRows.length === 0} onClick={() => downloadCsv(definition.title, reportRows)} className="bg-orange-500 font-bold hover:bg-orange-600"><Download /> Gerar CSV</Button></div>{loading ? <div className="grid min-h-56 place-items-center"><Loader2 className="size-6 animate-spin text-orange-500" /></div> : preview.length === 0 ? <div className="grid min-h-56 place-items-center px-4 text-center text-sm text-slate-500">Não há registros para este relatório no período selecionado.</div> : <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr>{definition.columns.map((column) => <th key={column.key} className="px-4 py-3 font-bold">{column.label}</th>)}</tr></thead><tbody>{preview.map((row, index) => <tr key={index} className="border-t">{definition.columns.map((column) => <td key={column.key} className="px-4 py-3">{row[column.key] ?? "—"}</td>)}</tr>)}</tbody></table></div>}</section>
  </div>;
}

function filterByPeriod(rows: RawRow[], field: string, period: string) { if (period === "all") return rows; const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - Number(period)); return rows.filter((row) => { const value = row[field]; if (!value) return false; const date = new Date(String(value)); return !Number.isNaN(date.getTime()) && date >= cutoff; }); }
function text(value: unknown) { return value == null || value === "" ? "—" : String(value); }
function number(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? `${parsed.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg` : "—"; }
function dateTime(value: unknown) { if (!value) return "—"; const date = new Date(String(value)); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
function dateOnly(value: unknown) { if (!value) return "—"; const date = new Date(`${String(value)}T12:00:00`); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString("pt-BR"); }
function duration(value: unknown) { const minutes = Number(value); if (!Number.isFinite(minutes)) return "—"; return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}min`; }
function elapsed(start: unknown, ...endCandidates: unknown[]) { const end = endCandidates.find(Boolean); if (!start || !end) return "Em andamento"; const elapsedMinutes = (new Date(String(end)).getTime() - new Date(String(start)).getTime()) / 60000; return Number.isFinite(elapsedMinutes) && elapsedMinutes >= 0 ? duration(elapsedMinutes) : "—"; }
function statusText(value: unknown) { const labels: Record<string, string> = { open: "Aberta", closed: "Encerrada", heating: "Aquecendo", released: "Liberada", cancelled: "Cancelada", completed: "Concluída", in_progress: "Em andamento", planned: "Planejada", paused: "Pausada", approved: "Aprovada", rejected: "Reprovada", pending: "Pendente", conditional: "Condicional" }; return labels[String(value)] ?? text(value); }
function downloadCsv(title: string, rows: Record<string, string | number | null>[]) { const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row)))); const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`; const content = `\uFEFF${columns.map(quote).join(";")}\n${rows.map((row) => columns.map((column) => quote(row[column])).join(";")).join("\n")}`; const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = `${title.toLowerCase().replaceAll(/[^a-z0-9]+/gi, "-")}-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url); }
function message(cause: unknown) { return cause instanceof Error ? cause.message : "Verifique a conexão e tente novamente."; }
