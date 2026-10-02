"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, CheckCircle2, FileClock, History, Search, ShieldCheck, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const accepted = ".xlsx,.xls,.xlsm,.xlsb";

type Execution = {
  id: string; machine_code: string; tool_code: string; tool_sequence: number | null;
  plan_code: string | null; order_number: string; started_at: string | null; completed_at: string;
  produced_kg: number; produced_quantity: number; achieved_productivity_kg_h: number | null;
  operator_name: string; setup_snapshot: Record<string, unknown>; planning_snapshot: Record<string, unknown>;
};
type AuditEvent = { id: number; entity_type: string; entity_id: string; action: string; actor_name: string; occurred_at: string; before_data: Record<string, unknown> | null; after_data: Record<string, unknown> | null; snapshot: Record<string, unknown>; metadata: Record<string, unknown> };
type MatchCandidate = { executionId: string; score: number; classification: string; reasons: Array<{ field: string; points: number; detail: string }> };
type ExternalRecord = { id: string; production_date: string | null; machine_code: string | null; tool_code: string | null; tool_sequence: number | null; batch_number: string | null; order_number: string | null; net_weight_kg: number | null; produced_quantity?: number | null; alloy_code?: string | null; achieved_productivity_kg_h: number | null; matched_execution_id: string | null; match_confidence: number | null; match_classification?: string | null; review_status?: string | null; match_evidence?: { candidates?: MatchCandidate[]; field_comparisons?: Array<Record<string, unknown>>; discrepancies?: Array<Record<string, unknown>> } | null };
type Tab = "production" | "changes" | "reconciliation";
type ImportPreview = { import_id: string; status: "preview" | "duplicate"; row_count: number; valid_row_count: number; rejected_row_count: number; file_hash?: string | null };

function norm(value: unknown) { return String(value ?? "").trim(); }
function dateTime(value: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "—"; }
function formatNumber(value: number | null | undefined, suffix = "") { return value == null ? "—" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value)}${suffix}`; }

export function AuditReconciliationCenter() {
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
  const [pendingImport, setPendingImport] = useState<ImportPreview | null>(null);
  const [reviewing, setReviewing] = useState<ExternalRecord | null>(null);
  const [reviewExecutionId, setReviewExecutionId] = useState("");
  const [reviewReason, setReviewReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/audit/reconciliation", { cache: "no-store" });
    const payload = await response.json().catch(() => ({})) as { error?: string; history?: Execution[]; audit?: AuditEvent[]; external?: ExternalRecord[] };
    if (!response.ok) setMessage(payload.error || "Não foi possível carregar a auditoria.");
    else { setExecutions(payload.history ?? []); setEvents(payload.audit ?? []); setExternal(payload.external ?? []); }
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
    if (!file) return;
    setWorking(true); setMessage("");
    try {
      const form = new FormData(); form.set("file", file);
      const response = await fetch("/api/audit/reconciliation/import/preview", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({})) as ImportPreview & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível preparar a prévia.");
      if (payload.status === "duplicate") {
        setMessage(`Este arquivo já foi importado. Foram encontrados ${payload.row_count} registros nessa importação.`);
        await load(); setTab("reconciliation");
      } else {
        setPendingImport(payload);
        setMessage(`Prévia pronta: ${payload.valid_row_count} linhas válidas e ${payload.rejected_row_count} para revisão.`);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível importar o relatório."); }
    finally { setWorking(false); if (inputRef.current) inputRef.current.value = ""; }
  }

  async function confirmImport() {
    if (!pendingImport) return;
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/audit/reconciliation/import/confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ importId: pendingImport.import_id }) });
      const payload = await response.json().catch(() => ({})) as { error?: string; inserted_rows?: number; rejected_rows?: number };
      if (!response.ok) throw new Error(payload.error || "Não foi possível confirmar a importação.");
      setPendingImport(null);
      setMessage(`${payload.inserted_rows ?? 0} apontamentos confirmados. Executando conciliação segura…`);
      await reconcile(); await load(); setTab("reconciliation");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível confirmar a importação."); }
    finally { setWorking(false); }
  }

  async function reconcile() {
    const response = await fetch("/api/audit/reconciliation/match", { method: "POST" });
    const payload = await response.json().catch(() => ({})) as { error?: string; linked?: number; ambiguous?: number; pending?: number };
    if (!response.ok) throw new Error(payload.error || "Não foi possível executar a conciliação.");
    setMessage(`${payload.linked ?? 0} vínculos seguros, ${payload.ambiguous ?? 0} ambíguos e ${payload.pending ?? 0} aguardando revisão.`);
  }

  async function confirmManualMatch() {
    if (!reviewing || !reviewExecutionId || reviewReason.trim().length < 5) return;
    setWorking(true);
    try {
      const response = await fetch("/api/audit/reconciliation/match/manual", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recordId: reviewing.id, executionId: reviewExecutionId, reason: reviewReason.trim() }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Não foi possível confirmar o vínculo.");
      setReviewing(null); setReviewExecutionId(""); setReviewReason(""); setMessage("Vínculo manual salvo com usuário, motivo e evidência."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível confirmar o vínculo."); }
    finally { setWorking(false); }
  }

  return <div className="space-y-4">
    <section className="grid gap-3 sm:grid-cols-3">
      <Metric icon={FileClock} label="Produções registradas" value={executions.length} detail="com fotografia do setup" />
      <Metric icon={History} label="Mudanças auditadas" value={events.length} detail="receitas, forno e paradas" />
      <Metric icon={ShieldCheck} label="Conciliação" value={external.length ? `${matched}/${external.length}` : "—"} detail="apontamentos vinculados" />
    </section>
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      {pendingImport && <div className="border-b bg-blue-50 px-4 py-3 text-sm text-blue-950"><div className="flex flex-wrap items-center justify-between gap-3"><span><b>Prévia do ERP:</b> {pendingImport.row_count} linhas · {pendingImport.valid_row_count} válidas · {pendingImport.rejected_row_count} para revisão. Nada foi gravado como produção até confirmar.</span><span className="flex gap-2"><Button size="sm" onClick={() => void confirmImport()} disabled={working}>Confirmar importação</Button><Button size="sm" variant="outline" onClick={() => setPendingImport(null)} disabled={working}>Cancelar</Button></span></div></div>}
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
      {loading ? <div className="p-12 text-center text-sm text-slate-500">Carregando auditoria…</div> : tab === "production" ? <ProductionTable rows={filteredExecutions} onOpen={setSnapshot} /> : tab === "changes" ? <AuditTable rows={filteredEvents} onOpen={setSnapshot} /> : <ReconciliationTable rows={external} executionById={executionById} onReview={(row) => { setReviewing(row); setReviewExecutionId(row.match_evidence?.candidates?.[0]?.executionId ?? ""); setReviewReason(""); }} />}
    </section>
    {snapshot && <SnapshotDialog row={snapshot} onClose={() => setSnapshot(null)} />}
    {reviewing && <ManualReviewDialog row={reviewing} executionById={executionById} executionId={reviewExecutionId} reason={reviewReason} working={working} onExecutionChange={setReviewExecutionId} onReasonChange={setReviewReason} onConfirm={() => void confirmManualMatch()} onClose={() => setReviewing(null)} />}
  </div>;
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Activity; label: string; value: string | number; detail: string }) { return <div className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm"><span className="grid size-10 place-items-center rounded-xl bg-orange-50 text-orange-600"><Icon className="size-5" /></span><div><p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="font-heading text-xl font-bold text-slate-950">{value}</p><p className="text-xs text-slate-500">{detail}</p></div></div>; }
function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button onClick={onClick} className={`rounded-lg px-3 py-2 text-sm font-bold ${active ? "bg-white text-slate-950 shadow-sm" : "text-slate-500"}`}>{children}</button>; }
function Empty({ text }: { text: string }) { return <div className="p-14 text-center text-sm text-slate-500">{text}</div>; }

function ProductionTable({ rows, onOpen }: { rows: Execution[]; onOpen: (row: Execution) => void }) { if (!rows.length) return <Empty text="Nenhuma produção concluída registrada ainda." />; return <div className="overflow-x-auto"><table className="w-full min-w-[950px] text-sm"><thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500"><tr><th className="px-4 py-3">Data / operador</th><th>Prensa</th><th>Ferramenta / seq.</th><th>Plano / ordem</th><th>Produzido</th><th>Produtividade alcançada</th><th className="px-4 text-right">Setup</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t"><td className="px-4 py-3"><b>{dateTime(row.completed_at)}</b><p className="text-xs text-slate-500">{row.operator_name}</p></td><td>{row.machine_code}</td><td><b className="text-orange-600">{row.tool_code}</b> · seq. {row.tool_sequence ?? "—"}</td><td>{row.plan_code ?? "—"}<p className="text-xs text-slate-500">{row.order_number}</p></td><td>{formatNumber(row.produced_kg, " kg")}</td><td className="font-bold text-emerald-700">{formatNumber(row.achieved_productivity_kg_h, " kg/h")}</td><td className="px-4 text-right"><Button variant="ghost" size="sm" onClick={() => onOpen(row)}><FileClock />Ver fotografia</Button></td></tr>)}</tbody></table></div>; }
function AuditTable({ rows, onOpen }: { rows: AuditEvent[]; onOpen: (row: AuditEvent) => void }) { if (!rows.length) return <Empty text="Nenhuma alteração auditada ainda." />; return <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-sm"><thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500"><tr><th className="px-4 py-3">Data</th><th>Usuário</th><th>Área</th><th>Ação</th><th className="px-4 text-right">Detalhes</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t"><td className="px-4 py-3 font-semibold">{dateTime(row.occurred_at)}</td><td>{row.actor_name}</td><td>{row.entity_type.replaceAll("_", " ")}</td><td><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{row.action}</span></td><td className="px-4 text-right"><Button variant="ghost" size="sm" onClick={() => onOpen(row)}><History />Antes e depois</Button></td></tr>)}</tbody></table></div>; }
function ReconciliationTable({ rows, executionById, onReview }: { rows: ExternalRecord[]; executionById: Map<string, Execution>; onReview: (row: ExternalRecord) => void }) { if (!rows.length) return <Empty text="Importe o F_Relatorio_Apontamento_Produção para comparar o setup do aplicativo com o resultado real." />; return <div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-sm"><thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500"><tr><th className="px-4 py-3">Produção empresa</th><th>Prensa</th><th>Ferramenta / seq.</th><th>Lote / OP</th><th>Peso líquido</th><th>Prod. empresa</th><th>Prod. aplicativo</th><th>Diferença</th><th>Status</th><th className="px-4 text-right">Ação</th></tr></thead><tbody>{rows.map(row => { const app = row.matched_execution_id ? executionById.get(row.matched_execution_id) : undefined; const delta = app?.achieved_productivity_kg_h && row.achieved_productivity_kg_h ? row.achieved_productivity_kg_h - app.achieved_productivity_kg_h : null; return <tr key={row.id} className="border-t"><td className="px-4 py-3 font-semibold">{row.production_date ? new Date(`${row.production_date}T12:00:00`).toLocaleDateString("pt-BR") : "—"}</td><td>{row.machine_code ?? "—"}</td><td><b className="text-orange-600">{row.tool_code ?? "—"}</b> · seq. {row.tool_sequence ?? "—"}</td><td>{row.batch_number ?? "—"}<p className="text-xs text-slate-500">{row.order_number ?? "Sem OP"}</p></td><td>{formatNumber(row.net_weight_kg, " kg")}</td><td className="font-bold">{formatNumber(row.achieved_productivity_kg_h, " kg/h")}</td><td>{formatNumber(app?.achieved_productivity_kg_h, " kg/h")}</td><td className={delta == null ? "" : delta >= 0 ? "font-bold text-emerald-700" : "font-bold text-red-600"}>{delta == null ? "—" : `${delta >= 0 ? "+" : ""}${formatNumber(delta, " kg/h")}`}</td><td>{app ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700"><CheckCircle2 className="size-3" />Conferido {row.match_confidence}%</span> : <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">{row.match_classification === "AMBIGUOUS" ? "Ambíguo" : "Revisar vínculo"}</span>}</td><td className="px-4 text-right">{!app && row.match_evidence?.candidates?.length ? <Button size="sm" variant="outline" onClick={() => onReview(row)}>Revisar</Button> : "—"}</td></tr>; })}</tbody></table></div>; }

function ManualReviewDialog({ row, executionById, executionId, reason, working, onExecutionChange, onReasonChange, onConfirm, onClose }: { row: ExternalRecord; executionById: Map<string, Execution>; executionId: string; reason: string; working: boolean; onExecutionChange: (value: string) => void; onReasonChange: (value: string) => void; onConfirm: () => void; onClose: () => void }) {
  const candidates = row.match_evidence?.candidates ?? [];
  const comparisons = row.match_evidence?.field_comparisons ?? [];
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}><div className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b p-4"><div><h2 className="font-heading text-lg font-bold">Revisar vínculo ERP</h2><p className="text-sm text-slate-500">Escolha o candidato e informe por que ele representa esta produção.</p></div><button onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><X className="size-5" /></button></header><div className="space-y-4 overflow-auto p-5"><div className="rounded-xl bg-slate-50 p-3 text-sm"><b>{row.tool_code ?? "Ferramenta sem código"}</b> · {row.machine_code ?? "Prensa não informada"} · {row.production_date ?? "Data não informada"}<p className="text-slate-500">OP {row.order_number ?? "não informada"} · classificação {row.match_classification ?? "pendente"}</p></div>{comparisons.length > 0 && <div><p className="mb-2 text-sm font-bold">Confronto dos campos</p><div className="overflow-x-auto rounded-xl border"><table className="w-full text-xs"><thead className="bg-slate-50 text-left uppercase text-slate-500"><tr><th className="px-3 py-2">Campo</th><th className="px-3 py-2">ERP</th><th className="px-3 py-2">Aplicativo</th><th className="px-3 py-2">Situação</th></tr></thead><tbody>{comparisons.map(comparison => <tr key={String(comparison.field)} className="border-t"><td className="px-3 py-2 font-semibold">{String(comparison.field).replaceAll("_", " ")}</td><td className="px-3 py-2">{String(comparison.erp_value ?? "—")}</td><td className="px-3 py-2">{String(comparison.app_value ?? "—")}</td><td className={`px-3 py-2 font-bold ${comparison.status === "equal" ? "text-emerald-700" : comparison.status === "different" ? "text-red-600" : "text-amber-700"}`}>{comparison.status === "equal" ? "Igual" : comparison.status === "different" ? "Divergente" : "Ausente"}</td></tr>)}</tbody></table></div></div>}<div><p className="mb-2 text-sm font-bold">Candidatos calculados</p><div className="space-y-2">{candidates.map(candidate => { const execution = executionById.get(candidate.executionId); return <label key={candidate.executionId} className={`block cursor-pointer rounded-xl border p-3 ${executionId === candidate.executionId ? "border-orange-500 bg-orange-50" : "hover:bg-slate-50"}`}><input type="radio" name="manual-match" className="mr-2" checked={executionId === candidate.executionId} onChange={() => onExecutionChange(candidate.executionId)} /><b>{execution?.tool_code ?? candidate.executionId}</b> · score {candidate.score}/100<p className="ml-5 text-xs text-slate-500">{candidate.reasons.map(reasonItem => reasonItem.detail).join(" · ") || "Sem evidência de coincidência"}</p></label>; })}</div></div><label className="block text-sm font-semibold">Motivo da confirmação manual<textarea value={reason} onChange={event => onReasonChange(event.target.value)} rows={3} className="mt-1 w-full rounded-xl border px-3 py-2 font-normal outline-none focus:border-orange-500" placeholder="Ex.: conferido com a ordem e o horário no relatório do turno" /></label><div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={working}>Cancelar</Button><Button onClick={onConfirm} disabled={working || !executionId || reason.trim().length < 5}>{working ? "Salvando…" : "Confirmar vínculo"}</Button></div></div></div></div>;
}

function SnapshotDialog({ row, onClose }: { row: Execution | AuditEvent; onClose: () => void }) {
  const isExecution = "setup_snapshot" in row; const data = isExecution ? row.setup_snapshot : { antes: row.before_data, depois: row.after_data, fotografia: row.snapshot };
  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}><div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"><header className="flex items-center justify-between border-b p-4"><div><h2 className="font-heading text-lg font-bold">{isExecution ? "Fotografia do setup utilizado" : "Detalhes da alteração"}</h2><p className="text-sm text-slate-500">Registro preservado para rastreabilidade e auditoria.</p></div><button onClick={onClose} className="rounded-lg p-2 hover:bg-slate-100"><X className="size-5" /></button></header><div className="max-h-[72vh] overflow-auto p-5"><SnapshotValues data={data} /></div></div></div>;
}
function SnapshotValues({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return <p className="text-sm text-slate-500">Sem dados registrados.</p>;
  const entries = Object.entries(data as Record<string, unknown>);
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{entries.map(([name, value]) => <div key={name} className="rounded-xl border bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{name.replaceAll("_", " ")}</p>{value && typeof value === "object" ? <div className="mt-2 sm:col-span-2"><SnapshotValues data={value} /></div> : <p className="mt-1 break-words text-sm font-semibold text-slate-800">{value == null || value === "" ? "—" : String(value)}</p>}</div>)}</div>;
}
