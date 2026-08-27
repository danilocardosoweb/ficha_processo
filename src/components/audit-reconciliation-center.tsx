"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, CheckCircle2, FileClock, History, Search, ShieldCheck, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCurrentUser } from "@/components/current-user-provider";
import { createClient } from "@/lib/supabase/client";

const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
const accepted = ".xlsx,.xls,.xlsm,.xlsb";

type Execution = {
  id: string; machine_code: string; tool_code: string; tool_sequence: number | null;
  plan_code: string | null; order_number: string; started_at: string | null; completed_at: string;
  produced_kg: number; produced_quantity: number; achieved_productivity_kg_h: number | null;
  operator_name: string; setup_snapshot: Record<string, unknown>; planning_snapshot: Record<string, unknown>;
};
type AuditEvent = { id: number; entity_type: string; entity_id: string; action: string; actor_name: string; occurred_at: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; snapshot: Record<string, unknown>; metadata: Record<string, unknown> };
type ExternalRecord = { id: string; production_date: string | null; machine_code: string | null; tool_code: string | null; tool_sequence: number | null; batch_number: string | null; order_number: string | null; net_weight_kg: number | null; achieved_productivity_kg_h: number | null; matched_execution_id: string | null; match_confidence: number | null };
type Tab = "production" | "changes" | "reconciliation";

function norm(value: unknown) { return String(value ?? "").trim(); }
function key(value: unknown) { return norm(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toLowerCase(); }
function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = norm(value); if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, "")); return Number.isFinite(parsed) ? parsed : null;
}
function isoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") { const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000); return date.toISOString().slice(0, 10); }
  const text = norm(value); const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const parsed = new Date(text); return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
function time(value: unknown): string | null {
  if (typeof value === "number") { const seconds = Math.round(value * 86400); return `${String(Math.floor(seconds / 3600) % 24).padStart(2, "0")}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, "0")}:00`; }
  const match = norm(value).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/); return match ? `${match[1].padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}` : null;
}
function dateTime(value: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—"; }
function formatNumber(value: number | null | undefined, suffix = "") { return value == null ? "—" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}${suffix}`; }
function machine(value: unknown) { const raw = norm(value).replace(/^P/i, ""); return raw ? `P${raw.replace(".", "")}` : ""; }
function toolParts(value: unknown) { const raw = norm(value).toUpperCase(); const match = raw.match(/^(.+?)[\/-](\d{1,3})$/); return { tool: match ? match[1] : raw, sequence: match ? Number(match[2]) : null }; }
function get(row: Record<string, unknown>, ...names: string[]) { const normalized = Object.fromEntries(Object.entries(row).map(([k, v]) => [key(k), v])); for (const name of names) if (key(name) in normalized) return normalized[key(name)]; return null; }

export function AuditReconciliationCenter() {
  const { display_name: operatorName } = useCurrentUser();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("production");
  const [executions, setExecutions] = useState<Execution[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [external, setExternal] = useState<ExternalRecord[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [snapshot, setSnapshot] = useState<Execution | AuditEvent | null>(null);

  const load = useCallback(async () => {
    if (!organizationId) { setMessage("Organização padrão não configurada."); setLoading(false); return; }
    setLoading(true);
    const client = createClient();
    const [history, audit, report] = await Promise.all([
      client.from("production_execution_history").select("id,machine_code,tool_code,tool_sequence,plan_code,order_number,started_at,completed_at,produced_kg,produced_quantity,achieved_productivity_kg_h,operator_name,setup_snapshot,planning_snapshot").eq("organization_id", organizationId).order("completed_at", { ascending: false }).limit(500),
      client.from("system_audit_events").select("id,entity_type,entity_id,action,actor_name,occurred_at,before_data,after_data,snapshot,metadata").eq("organization_id", organizationId).order("occurred_at", { ascending: false }).limit(1000),
      client.from("external_production_records").select("id,production_date,machine_code,tool_code,tool_sequence,batch_number,order_number,net_weight_kg,achieved_productivity_kg_h,matched_execution_id,match_confidence").eq("organization_id", organizationId).order("created_at", { ascending: false }).limit(2000),
    ]);
    const error = history.error || audit.error || report.error;
    if (error) setMessage(error.message); else { setExecutions((history.data ?? []) as Execution[]); setEvents((audit.data ?? []) as AuditEvent[]); setExternal((report.data ?? []) as ExternalRecord[]); }
    setLoading(false);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filteredExecutions = useMemo(() => executions.filter(row => [row.machine_code, row.tool_code, row.tool_sequence, row.plan_code, row.order_number, row.operator_name].some(value => norm(value).toLowerCase().includes(search.toLowerCase()))), [executions, search]);
  const filteredEvents = useMemo(() => events.filter(row => [row.entity_type, row.action, row.actor_name, JSON.stringify(row.metadata)].some(value => norm(value).toLowerCase().includes(search.toLowerCase()))), [events, search]);
  const executionById = useMemo(() => new Map(executions.map(row => [row.id, row])), [executions]);
  const matched = external.filter(row => row.matched_execution_id).length;

  async function importReport(file?: File) {
    if (!file || !organizationId) return;
    setWorking(true); setMessage("");
    try {
      const [XLSX, codepage] = await Promise.all([import("xlsx"), import("xlsx/dist/cpexcel.full.mjs")]);
      XLSX.set_cptable(codepage.default);
      const buffer = await file.arrayBuffer(); const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sourceSheet = workbook.SheetNames.find(name => key(name) === "reports") ?? workbook.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sourceSheet], { defval: null, raw: true });
      if (!rows.length) throw new Error("O relatório não possui linhas para importar.");
      const digest = await crypto.subtle.digest("SHA-256", buffer); const hash = Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join("");
      const client = createClient();
      const { data: importRow, error: importError } = await client.from("production_report_imports").insert({ organization_id: organizationId, file_name: file.name, file_hash: hash, source_sheet: sourceSheet, row_count: rows.length, imported_by_name: operatorName, metadata: { headers: Object.keys(rows[0]), imported_at: new Date().toISOString() } }).select("id").single();
      if (importError) throw importError;
      const payload = rows.map((row, index) => {
        const parts = toolParts(get(row, "Ferramenta", "Ferrametna"));
        return { organization_id: organizationId, import_id: importRow.id, row_number: index + 2, machine_code: machine(get(row, "Prensa")), production_date: isoDate(get(row, "Data Produção")), batch_number: norm(get(row, "Lote")) || null, start_time: time(get(row, "Hora Inicial")), end_time: time(get(row, "Hora Final")), shift_code: norm(get(row, "Turno")) || null, product_code: norm(get(row, "Produto")) || null, tool_code: parts.tool || null, tool_sequence: parts.sequence, billet_quantity: num(get(row, "Qtde Tarugo")), billet_length_mm: num(get(row, "Compr Tarugo")), gross_weight_kg: num(get(row, "Peso Bruto")), net_weight_kg: num(get(row, "Peso Liq.")), efficiency_percent: num(get(row, "Eficiencia")), achieved_productivity_kg_h: num(get(row, "Produtividade")), produced_quantity: num(get(row, "Qt Pc")), theoretical_linear_weight_kg_m: num(get(row, "Kg/m Teórico")), actual_linear_weight_kg_m: num(get(row, "kg/m Real")), packaging_linear_weight_kg_m: num(get(row, "kg/m Embalagem")), alloy_code: norm(get(row, "Liga")) || null, alloy_used: norm(get(row, "Liga Utilizada")) || null, order_number: norm(get(row, "OP")) || null, state: norm(get(row, "Estado")) || null, scrap_kg: num(get(row, "Sucata")), losses_kg: num(get(row, "Perdas")), raw_data: row };
      });
      for (let index = 0; index < payload.length; index += 200) { const { error } = await client.from("external_production_records").insert(payload.slice(index, index + 200)); if (error) throw error; }
      setMessage(`${payload.length} apontamentos importados. Executando conciliação automática…`);
      await reconcile(); await load(); setTab("reconciliation");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível importar o relatório."); }
    finally { setWorking(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function reconcile() {
    if (!organizationId) return;
    const client = createClient();
    const [{ data: history }, { data: report }] = await Promise.all([
      client.from("production_execution_history").select("id,machine_code,tool_code,tool_sequence,order_number,completed_at").eq("organization_id", organizationId),
      client.from("external_production_records").select("id,machine_code,tool_code,tool_sequence,order_number,production_date").eq("organization_id", organizationId).is("matched_execution_id", null),
    ]);
    for (const record of report ?? []) {
      let best: { id: string; score: number } | null = null;
      for (const app of history ?? []) {
        let score = 0;
        if (key(app.tool_code) && key(app.tool_code) === key(record.tool_code)) score += 40; else continue;
        if (record.tool_sequence != null && app.tool_sequence === record.tool_sequence) score += 15;
        if (key(app.machine_code) === key(record.machine_code)) score += 20;
        if (record.production_date && app.completed_at?.slice(0, 10) === record.production_date) score += 15;
        if (record.order_number && key(app.order_number) === key(record.order_number)) score += 10;
        if (!best || score > best.score) best = { id: app.id, score };
      }
      if (best && best.score >= 60) await client.from("external_production_records").update({ matched_execution_id: best.id, match_confidence: best.score, matched_at: new Date().toISOString() }).eq("id", record.id);
    }
  }

  return <div className="space-y-4">
    <section className="grid gap-3 sm:grid-cols-3">
      <Metric icon={FileClock} label="Produções registradas" value={executions.length} detail="com fotografia do setup" />
      <Metric icon={History} label="Mudanças auditadas" value={events.length} detail="receitas, forno e paradas" />
      <Metric icon={ShieldCheck} label="Conciliação" value={external.length ? `${matched}/${external.length}` : "—"} detail="apontamentos vinculados" />
    </section>
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
        <div className="flex rounded-xl bg-slate-100 p-1">
          <TabButton active={tab === "production"} onClick={() => setTab("production")}>Produção</TabButton>
          <TabButton active={tab === "changes"} onClick={() => setTab("changes")}>Alterações</TabButton>
          <TabButton active={tab === "reconciliation"} onClick={() => setTab("reconciliation")}>Conciliação</TabButton>
        </div>
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-xl border px-3"><Search className="size-4 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Ferramenta, ordem, Plano, operador ou ação" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
        <input ref={inputRef} type="file" accept={accepted} className="hidden" onChange={event => void importReport(event.target.files?.[0])} />
        <Button onClick={() => inputRef.current?.click()} disabled={working}><Upload />{working ? "Processando…" : "Importar apontamentos"}</Button>
      </div>
      {message && <div className="border-b bg-amber-50 px-4 py-2 text-sm text-amber-900">{message}</div>}
      {loading ? <div className="p-12 text-center text-sm text-slate-500">Carregando auditoria…</div> : tab === "production" ? <ProductionTable rows={filteredExecutions} onOpen={setSnapshot} /> : tab === "changes" ? <AuditTable rows={filteredEvents} onOpen={setSnapshot} /> : <ReconciliationTable rows={external} executionById={executionById} />}
    </section>
    {snapshot && <SnapshotDialog row={snapshot} onClose={() => setSnapshot(null)} />}
  </div>;
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string | number; detail: string }) { return <div className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm"><span className="grid size-10 place-items-center rounded-xl bg-orange-50 text-orange-600"><Icon className="size-5" /></span><div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="font-heading text-xl font-bold text-slate-950">{value}</p><p className="text-xs text-slate-500">{detail}</p></div></div>; }
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={`rounded-lg px-3 py-2 text-sm font-bold ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{children}</button>; }
function Empty({ text }: { text: string }) { return <div className="p-14 text-center text-sm text-slate-500">{text}</div>; }

function ProductionTable({ rows, onOpen }: { rows: Execution[]; onOpen: (row: Execution) => void }) { if (!rows.length) return <Empty text="Nenhuma produção concluída registrada ainda." />; return <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500"><tr><th className="px-4 py-3">Data / operador</th><th>Prensa</th><th>Ferramenta / seq.</th><th>Plano / ordem</th><th>Produzido</th><th>Produtividade alcançada</th><th className="px-4 text-right">Setup</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t"><td className="px-4 py-3"><b>{dateTime(row.completed_at)}</b><p className="text-xs text-slate-500">{row.operator_name}</p></td><td>{row.machine_code}</td><td><b className="text-orange-600">{row.tool_code}</b> · seq. {row.tool_sequence ?? "—"}</td><td>{row.plan_code ?? "—"}<p className="text-xs text-slate-500">{row.order_number}</p></td><td>{formatNumber(row.produced_kg, " kg")}</td><td className="font-bold text-emerald-700">{formatNumber(row.achieved_productivity_kg_h, " kg/h")}</td><td className="px-4 text-right"><Button variant="ghost" size="sm" onClick={() => onOpen(row)}><FileClock />Ver fotografia</Button></td></tr>)}</tbody></table></div>; }
function AuditTable({ rows, onOpen }: { rows: AuditEvent[]; onOpen: (row: AuditEvent) => void }) { if (!rows.length) return <Empty text="Nenhuma alteração auditada ainda." />; return <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500"><tr><th className="px-4 py-3">Data</th><th>Usuário</th><th>Área</th><th>Ação</th><th className="px-4 text-right">Detalhes</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t"><td className="px-4 py-3 font-semibold">{dateTime(row.occurred_at)}</td><td>{row.actor_name}</td><td>{row.entity_type.replaceAll("_", " ")}</td><td><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{row.action}</span></td><td className="px-4 text-right"><Button variant="ghost" size="sm" onClick={() => onOpen(row)}><History />Antes e depois</Button></td></tr>)}</tbody></table></div>; }
function ReconciliationTable({ rows, executionById }: { rows: ExternalRecord[]; executionById: Map<string, Execution> }) { if (!rows.length) return <Empty text="Importe o F_Relatorio_Apontamento_Produção para comparar o setup do aplicativo com o resultado real." />; return <div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500"><tr><th className="px-4 py-3">Produção empresa</th><th>Prensa</th><th>Ferramenta / seq.</th><th>Lote / OP</th><th>Peso líquido</th><th>Prod. empresa</th><th>Prod. aplicativo</th><th>Diferença</th><th>Status</th></tr></thead><tbody>{rows.map(row => { const app = row.matched_execution_id ? executionById.get(row.matched_execution_id) : undefined; const delta = app?.achieved_productivity_kg_h && row.achieved_productivity_kg_h ? row.achieved_productivity_kg_h - app.achieved_productivity_kg_h : null; return <tr key={row.id} className="border-t"><td className="px-4 py-3 font-semibold">{row.production_date ? new Date(`${row.production_date}T12:00:00`).toLocaleDateString("pt-BR") : "—"}</td><td>{row.machine_code ?? "—"}</td><td><b className="text-orange-600">{row.tool_code ?? "—"}</b> · seq. {row.tool_sequence ?? "—"}</td><td>{row.batch_number ?? "—"}<p className="text-xs text-slate-500">{row.order_number ?? "Sem OP"}</p></td><td>{formatNumber(row.net_weight_kg, " kg")}</td><td className="font-bold">{formatNumber(row.achieved_productivity_kg_h, " kg/h")}</td><td>{formatNumber(app?.achieved_productivity_kg_h, " kg/h")}</td><td className={delta == null ? "" : delta >= 0 ? "font-bold text-emerald-700" : "font-bold text-red-600"}>{delta == null ? "—" : `${delta >= 0 ? "+" : ""}${formatNumber(delta, " kg/h")}`}</td><td>{app ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="size-3" />Conciliado {row.match_confidence}%</span> : <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">Revisar vínculo</span>}</td></tr>; })}</tbody></table></div>; }

function SnapshotDialog({ row, onClose }: { row: Execution | AuditEvent; onClose: () => void }) {
  const isExecution = "setup_snapshot" in row; const data = isExecution ? row.setup_snapshot : { antes: row.before_data, depois: row.after_data, fotografia: row.snapshot };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}><div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b p-4"><div><h2 className="font-heading text-lg font-bold">{isExecution ? "Fotografia do setup utilizado" : "Detalhes da alteração"}</h2><p className="text-sm text-slate-500">Registro preservado para rastreabilidade e auditoria.</p></div><button onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><X className="size-5" /></button></header><div className="max-h-[72vh] overflow-auto p-5"><SnapshotValues data={data} /></div></div></div>;
}
function SnapshotValues({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return <p className="text-sm text-slate-500">Sem dados registrados.</p>;
  const entries = Object.entries(data as Record<string, unknown>);
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{entries.map(([name, value]) => <div key={name} className="rounded-xl border bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{name.replaceAll("_", " ")}</p>{value && typeof value === "object" ? <div className="mt-2 sm:col-span-2"><SnapshotValues data={value} /></div> : <p className="mt-1 break-words text-sm font-semibold text-slate-800">{value == null || value === "" ? "—" : String(value)}</p>}</div>)}</div>;
}
