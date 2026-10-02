"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Plus,
  Loader2,
  Search,
  ShieldAlert,
  Eye,
  MoreHorizontal,
  Pencil,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { useCurrentUser } from "@/components/current-user-provider";

type Stoppage = {
  id: string;
  production_order_id: string;
  maintenance_work_order_id: string | null;
  machine_code: string;
  plan_code: string | null;
  order_number: string;
  tool_code: string;
  product_code: string | null;
  customer_name: string | null;
  category: string;
  reason_code: string | null;
  reason: string;
  responsible_department: string | null;
  notes: string | null;
  initial_observation: string | null;
  closing_observation: string | null;
  shift: string | null;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  status: "open" | "closed" | "cancelled";
  maintenance_required: boolean;
  reported_by_name: string;
  closed_by_name: string | null;
  created_at: string;
  updated_at: string;
  updated_by_name: string | null;
  is_deleted: boolean;
};
type StoppageHistory = { id: number; action: "created" | "closed" | "edited" | "deleted"; field_name: string | null; old_value: unknown; new_value: unknown; actor_name: string; occurred_at: string };
type StoppageCatalog = { id: string; code: string; label: string; group_code: string | null; metadata: { internal_category?: string }; responsible_department: string | null; routes_to_maintenance: boolean };

const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
const categories: Record<string, string> = {
  mechanical: "Mecânica",
  electrical: "Elétrica",
  hydraulic: "Hidráulica",
  tooling: "Ferramenta / matriz",
  quality: "Qualidade",
  process: "Processo",
  material: "Material",
  setup: "Setup / troca",
  other: "Outros",
};

export function MaintenanceControl() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { display_name: operatorName, user_id: operatorId, role } = useCurrentUser();
  const canManageStoppages = role === "admin" || role === "manager";
  const [rows, setRows] = useState<Stoppage[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("open");
  const [message, setMessage] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [machines, setMachines] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<StoppageCatalog[]>([]);
  const [shifts, setShifts] = useState<{ id: string; code: string; name: string; is_active: boolean }[]>([]);
  const [savingNew, setSavingNew] = useState(false);
  const [newForm, setNewForm] = useState({ machine: "", typeCode: "E", reasonId: "", reasonCode: "", reason: "", department: "Manutenção", shift: "", startedAt: localDateTimeValue(), notes: "" });
  const [closingRow, setClosingRow] = useState<Stoppage | null>(null);
  const [closingEndedAt, setClosingEndedAt] = useState("");
  const [closingObservation, setClosingObservation] = useState("");
  const [closingError, setClosingError] = useState("");
  const [actionRowId, setActionRowId] = useState<string | null>(null);
  const [viewingRow, setViewingRow] = useState<Stoppage | null>(null);
  const [history, setHistory] = useState<StoppageHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [editingRow, setEditingRow] = useState<Stoppage | null>(null);
  const [editForm, setEditForm] = useState({ machine: "", reason: "", startedAt: "", endedAt: "", initialObservation: "", closingObservation: "", department: "", shift: "" });
  const [editError, setEditError] = useState("");
  const [deletingRow, setDeletingRow] = useState<Stoppage | null>(null);
  const [deletionReason, setDeletionReason] = useState("");

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const { data, error } = await createClient()
        .from("machine_stoppages")
        .select(
          "id,production_order_id,maintenance_work_order_id,machine_code,plan_code,order_number,tool_code,product_code,customer_name,category,reason_code,reason,responsible_department,notes,initial_observation,closing_observation,shift,started_at,ended_at,duration_minutes,status,maintenance_required,reported_by_name,closed_by_name,created_at,updated_at,updated_by_name,is_deleted",
        )
        .eq("organization_id", organizationId)
        .eq("is_deleted", false)
        .order("started_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      setRows((data ?? []) as Stoppage[]);
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  useEffect(() => {
    if (searchParams.get("novaParada") !== "1") return;
    queueMicrotask(() => setAddOpen(true));
    const url = new URL(window.location.href);
    url.searchParams.delete("novaParada");
    window.history.replaceState(null, "", url);
  }, [searchParams]);

  useEffect(() => {
    void (async () => {
      if (!organizationId) return;
      const client = createClient();
      const [{ data }, { data: catalogRows }] = await Promise.all([
        client.from("machines").select("code").eq("organization_id", organizationId).eq("is_active", true).order("code"),
        client.from("operational_catalogs").select("id,code,label,group_code,metadata,responsible_department,routes_to_maintenance").eq("organization_id", organizationId).in("catalog_type", ["stoppage_type", "stoppage_reason"]).eq("is_active", true).order("sort_order"),
      ]);
      const codes = (data ?? []).map((item) => String(item.code));
      setMachines(codes.length ? codes : ["18", "19"]);
      setNewForm((current) => ({ ...current, machine: current.machine || codes[0] || "18" }));
      setCatalog((catalogRows ?? []) as StoppageCatalog[]);
      const settingsResponse = await fetch("/api/production-settings");
      if (settingsResponse.ok) {
        const settings = await settingsResponse.json();
        const activeShifts = (settings.shifts ?? []).filter((item: { is_active: boolean }) => item.is_active);
        setShifts(activeShifts);
        setNewForm((current) => ({ ...current, shift: current.shift || activeShifts[0]?.code || "" }));
      }
    })();
  }, []);

  const catalogTypes = catalog.filter((item) => ["E", "F", "O", "PL", "UTL", "NPR"].includes(item.code));
  const selectedCatalogType = catalogTypes.find((item) => item.code === newForm.typeCode);
  const catalogReasons = catalog.filter((item) => item.group_code === newForm.typeCode);
  const canOpenStoppage = Boolean(
    newForm.machine &&
      newForm.typeCode &&
      newForm.reasonId &&
      newForm.department.trim() &&
      newForm.shift &&
      newForm.startedAt &&
      newForm.reason.trim() &&
      newForm.notes.trim(),
  );

  async function addStoppage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !canOpenStoppage) return;
    setSavingNew(true); setMessage("");
    try {
      const startedAt = new Date(newForm.startedAt).toISOString();
      const selectedReason = catalogReasons.find((item) => item.id === newForm.reasonId);
      const { error } = await createClient().from("machine_stoppages").insert({
        organization_id: organizationId, production_order_id: null, import_batch_id: null,
        machine_code: newForm.machine, plan_code: null, order_number: "", tool_code: "",
        category: selectedCatalogType?.metadata?.internal_category || "other", reason_catalog_id: selectedReason?.id || null, stoppage_type_catalog_id: selectedCatalogType?.id || null,
        reason_code: newForm.reasonCode.trim() || selectedReason?.code || null,
        reason: [selectedReason?.label, newForm.reason.trim()].filter(Boolean).join(" · "), responsible_department: newForm.department.trim(),
        notes: newForm.notes.trim(), initial_observation: newForm.notes.trim(), created_by_user_id: operatorId, shift: newForm.shift.trim(),
        started_at: startedAt, status: "open", maintenance_required: true, reported_by_name: operatorName, updated_by_name: operatorName,
        occurrence_date: startedAt.slice(0, 10),
      });
      if (error) throw error;
      setAddOpen(false); setNewForm((current) => ({ ...current, reasonId: "", reasonCode: "", reason: "", notes: "", startedAt: localDateTimeValue() }));
      setMessage(`Parada aberta na Prensa ${newForm.machine}. A manutenção foi avisada e o tempo já está sendo contado.`);
      await load();
    } catch (cause) { setMessage(errorMessage(cause)); }
    finally { setSavingNew(false); }
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(
      (row) =>
        (status === "all" || row.status === status) &&
        (!term ||
          [
            row.machine_code,
            row.plan_code,
            row.order_number,
            row.tool_code,
            row.product_code,
            row.customer_name,
            row.reason,
          ]
            .join(" ")
            .toLowerCase()
            .includes(term)),
    );
  }, [rows, search, status]);

  function startClosing(row: Stoppage) {
    setClosingRow(row);
    setClosingEndedAt(localDateTimeValue());
    setClosingError("");
    setClosingObservation("");
  }

  async function closeStoppage() {
    if (!closingRow) return;
    const endedAt = new Date(closingEndedAt);
    const startedAt = new Date(closingRow.started_at);
    if (Number.isNaN(endedAt.getTime())) { setClosingError("Informe um horário de término válido."); return; }
    if (endedAt.getTime() < startedAt.getTime()) { setClosingError("O término não pode ser anterior ao início da parada."); return; }
    if (endedAt.getTime() > Date.now() + 60_000) { setClosingError("O término não pode estar no futuro."); return; }
    const duration = Math.max(
      0,
      (endedAt.getTime() - startedAt.getTime()) / 60000,
    );
    setSavingId(closingRow.id);
    setMessage("");
    try {
      const response = await fetch(`/api/stoppages/${closingRow.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close", endedAt: endedAt.toISOString(), closingObservation }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível encerrar a parada.");
      setRows((current) =>
        current.map((item) =>
          item.id === closingRow.id
            ? {
                ...item,
                status: "closed",
                ended_at: endedAt.toISOString(),
                duration_minutes: duration,
                closed_by_name: operatorName,
                closing_observation: closingObservation.trim() || null,
              }
            : item,
        ),
      );
      setMessage(
        `Parada da P${closingRow.machine_code} encerrada. A produção pode ser retomada pelo operador.`,
      );
      setClosingRow(null);
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setSavingId("");
    }
  }

  async function viewStoppage(row: Stoppage) {
    setViewingRow(row); setHistory([]); setHistoryLoading(true); setActionRowId(null);
    try {
      const response = await fetch(`/api/stoppages/${row.id}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o histórico.");
      setHistory((payload?.history ?? []) as StoppageHistory[]);
    } catch (cause) { setMessage(errorMessage(cause)); }
    finally { setHistoryLoading(false); }
  }

  function startEditing(row: Stoppage) {
    setActionRowId(null); setEditError(""); setEditingRow(row);
    setEditForm({ machine: row.machine_code, reason: row.reason, startedAt: toLocalDateTimeValue(row.started_at), endedAt: row.ended_at ? toLocalDateTimeValue(row.ended_at) : "", initialObservation: row.initial_observation || row.notes || "", closingObservation: row.closing_observation || "", department: row.responsible_department || "", shift: row.shift || "" });
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRow) return;
    const startedAt = new Date(editForm.startedAt); const endedAt = editForm.endedAt ? new Date(editForm.endedAt) : null;
    if (Number.isNaN(startedAt.getTime()) || (endedAt && Number.isNaN(endedAt.getTime()))) { setEditError("Informe datas e horários válidos."); return; }
    if (endedAt && endedAt < startedAt) { setEditError("O término não pode ser anterior ao início da parada."); return; }
    setSavingId(editingRow.id); setEditError("");
    try {
      const response = await fetch(`/api/stoppages/${editingRow.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "edit", machineCode: editForm.machine, reason: editForm.reason, startedAt: startedAt.toISOString(), endedAt: endedAt?.toISOString() ?? null, initialObservation: editForm.initialObservation, closingObservation: editForm.closingObservation, responsibleDepartment: editForm.department, shift: editForm.shift }) });
      const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error || "Não foi possível salvar a alteração.");
      setEditingRow(null); setMessage("Parada atualizada e registrada no histórico de auditoria."); await load();
    } catch (cause) { setEditError(errorMessage(cause)); }
    finally { setSavingId(""); }
  }

  async function deleteStoppage() {
    if (!deletingRow || !deletionReason.trim()) return;
    setSavingId(deletingRow.id);
    try {
      const response = await fetch(`/api/stoppages/${deletingRow.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "delete", reason: deletionReason }) });
      const payload = await response.json().catch(() => null); if (!response.ok) throw new Error(payload?.error || "Não foi possível excluir a parada.");
      setRows((current) => current.filter((item) => item.id !== deletingRow.id)); setDeletingRow(null); setDeletionReason(""); setMessage("Parada excluída logicamente. O registro permanece disponível para auditoria administrativa.");
    } catch (cause) { setMessage(errorMessage(cause)); }
    finally { setSavingId(""); }
  }

  const openCount = rows.filter((row) => row.status === "open").length;
  const routedCount = rows.filter(
    (row) => row.status === "open" && row.maintenance_required,
  ).length;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = rows.filter((row) =>
    row.started_at.startsWith(today),
  ).length;

  return (
    <div className="space-y-4">
      <div className="grid overflow-hidden rounded-2xl bg-slate-950 text-white md:grid-cols-3">
        <Summary
          icon={<ShieldAlert />}
          label="Paradas abertas"
          value={openCount}
          accent
        />
        <Summary
          icon={<Wrench />}
          label="Para manutenção"
          value={routedCount}
        />
        <Summary icon={<Clock3 />} label="Apontadas hoje" value={todayCount} />
      </div>

      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div><h2 className="font-heading font-bold text-slate-900">Registro de paradas</h2><p className="text-xs text-slate-500">Aponte uma quebra de prensa mesmo sem uma ordem em produção.</p></div>
          <Button onClick={() => setAddOpen(true)} className="shrink-0 bg-orange-500 font-bold hover:bg-orange-600"><Plus /> Adicionar parada</Button>
        </div>
        <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar prensa, Plano, ordem, ferramenta ou motivo..."
              className="pl-9"
            />
          </div>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 rounded-lg border bg-white px-3 text-sm font-semibold"
          >
            <option value="open">Paradas abertas</option>
            <option value="closed">Paradas encerradas</option>
            <option value="all">Todas</option>
          </select>
        </div>
        {message && (
          <div className="m-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {message}
          </div>
        )}
        <div className="divide-y">
          {loading ? (
            <div className="grid place-items-center p-16">
              <Loader2 className="size-6 animate-spin text-orange-500" />
            </div>
          ) : visible.length === 0 ? (
            <div className="p-16 text-center text-sm text-slate-500">
              Nenhuma parada encontrada neste filtro.
            </div>
          ) : (
            visible.map((row) => (
              <article
                key={row.id}
                className="grid gap-4 p-4 hover:bg-slate-50/70 lg:grid-cols-[100px_1.2fr_1fr_1fr_auto] lg:items-center"
              >
                <div>
                  <p className="text-[9px] font-bold uppercase text-slate-400">
                    Prensa
                  </p>
                  <p className="font-heading text-xl font-black text-orange-600">
                    P{row.machine_code}
                  </p>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <strong className="truncate">
                      {row.reason_code ? `${row.reason_code} · ` : ""}
                      {row.reason}
                    </strong>
                    <span className="rounded-full bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-800">
                      {categories[row.category] || row.category}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    {row.responsible_department ||
                      (row.maintenance_required ? "Manutenção" : "Produção")}
                    {row.initial_observation || row.notes ? ` · ${row.initial_observation || row.notes}` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-slate-400">
                    Programação
                  </p>
                  <p className="text-sm font-bold">
                    {row.production_order_id ? `Plano ${row.plan_code || "—"}` : "Parada avulsa"}
                  </p>
                  <p className="text-xs text-slate-500">{row.order_number || "Sem ordem vinculada"}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-slate-400">
                    Contexto
                  </p>
                  <p className="text-sm font-bold">{row.tool_code || "Sem ferramenta"}</p>
                  <p className="text-xs text-slate-500">
                    {formatDateTime(row.started_at)} · {row.reported_by_name}
                  </p>
                </div>
                <div className="relative flex items-center justify-end gap-2">
                  <span
                    className={
                      row.status === "open"
                        ? "rounded-full bg-red-50 px-2.5 py-1.5 text-[10px] font-black text-red-700"
                        : "rounded-full bg-emerald-50 px-2.5 py-1.5 text-[10px] font-black text-emerald-700"
                    }
                  >
                    {row.status === "open"
                      ? row.maintenance_required
                        ? "NA MANUTENÇÃO"
                        : "PARADA ABERTA"
                      : `${formatDuration(row.duration_minutes)} · ENCERRADA`}
                  </span>
                  {row.status === "open" && (
                    <Button
                      size="sm"
                      onClick={() => startClosing(row)}
                      disabled={savingId === row.id}
                      className="bg-emerald-600 font-bold hover:bg-emerald-700"
                    >
                      {savingId === row.id ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <CheckCircle2 />
                      )}
                      Encerrar parada
                    </Button>
                  )}
                  <Button type="button" variant="outline" size="icon-sm" aria-label={`Ações da parada ${row.reason}`} onClick={() => setActionRowId((current) => current === row.id ? null : row.id)}>
                    <MoreHorizontal />
                  </Button>
                  {actionRowId === row.id && (
                    <div className="absolute right-0 top-full z-20 mt-2 w-40 overflow-hidden rounded-xl border bg-white p-1 shadow-lg">
                      <button type="button" onClick={() => void viewStoppage(row)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"><Eye className="size-4" />Visualizar</button>
                      <button type="button" onClick={() => { setActionRowId(null); router.push(`/diario-bordo?stoppageId=${encodeURIComponent(row.id)}`); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-orange-700 hover:bg-orange-50"><CalendarClock className="size-4" />Registrar ocorrência</button>
                      {canManageStoppages && <>
                        <button type="button" onClick={() => startEditing(row)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-50"><Pencil className="size-4" />Editar</button>
                        <button type="button" onClick={() => { setActionRowId(null); setDeletingRow(row); setDeletionReason(""); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-50"><Trash2 className="size-4" />Excluir</button>
                      </>}
                    </div>
                  )}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="size-5 text-orange-500" />Adicionar parada de máquina</DialogTitle><DialogDescription>Use para quebras ou ocorrências fora de uma produção. A parada ficará aberta até ser encerrada.</DialogDescription></DialogHeader>
          <form onSubmit={addStoppage} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">Prensa<select required value={newForm.machine} onChange={(event) => setNewForm({ ...newForm, machine: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3">{machines.map((code) => <option key={code} value={code}>Prensa {code === "18" ? "1.8" : code === "19" ? "1.9" : code}</option>)}</select></label>
            <label className="text-sm font-semibold">Tipo de parada<select required value={newForm.typeCode} onChange={(event) => setNewForm({ ...newForm, typeCode: event.target.value, reasonId: "" })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3">{(catalogTypes.length ? catalogTypes : [{ id: "fallback-e", code: "E", label: "EQUIPAMENTO", group_code: null, metadata: { internal_category: "mechanical" }, responsible_department: "Manutenção", routes_to_maintenance: true }]).map((type) => <option key={type.id} value={type.code}>{type.label} · {type.code}</option>)}</select></label>
            <label className="text-sm font-semibold">Motivo catalogado<select required value={newForm.reasonId} onChange={(event) => setNewForm({ ...newForm, reasonId: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3"><option value="" disabled>Selecione o motivo</option>{catalogReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.code} · {reason.label}</option>)}</select></label>
            <label className="text-sm font-semibold sm:col-span-2">Descrição complementar<Input required value={newForm.reason} onChange={(event) => setNewForm({ ...newForm, reason: event.target.value })} className="mt-1" placeholder="Descreva o que foi observado ou a ação necessária" /></label>
            <label className="text-sm font-semibold">Código manual (opcional)<Input value={newForm.reasonCode} onChange={(event) => setNewForm({ ...newForm, reasonCode: event.target.value })} className="mt-1" placeholder="Ex.: E-014" /></label>
            <label className="text-sm font-semibold">Turno<select required value={newForm.shift} onChange={(event) => setNewForm({ ...newForm, shift: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3"><option value="" disabled>Selecione o turno</option>{shifts.map((shift) => <option key={shift.id} value={shift.code}>{shift.code} · {shift.name}</option>)}</select></label>
            <label className="text-sm font-semibold">Início da parada<input type="datetime-local" required value={newForm.startedAt} onChange={(event) => setNewForm({ ...newForm, startedAt: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
            <label className="text-sm font-semibold">Responsável / área<Input required value={newForm.department} onChange={(event) => setNewForm({ ...newForm, department: event.target.value })} className="mt-1" /></label>
            <label className="text-sm font-semibold sm:col-span-2">Observação inicial<textarea required value={newForm.notes} onChange={(event) => setNewForm({ ...newForm, notes: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Sintomas, impacto ou orientação para a manutenção..." /></label>
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 sm:col-span-2"><CalendarClock className="mt-0.5 size-4 shrink-0" />O tempo total será calculado automaticamente quando a parada for encerrada.</div>
            <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button><Button type="submit" disabled={savingNew || !canOpenStoppage} className="bg-orange-500 hover:bg-orange-600">{savingNew ? <Loader2 className="animate-spin" /> : <Wrench />} Abrir parada</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(viewingRow)} onOpenChange={(open) => { if (!open) setViewingRow(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Eye className="size-5 text-slate-600" />Detalhes da parada</DialogTitle><DialogDescription>Registro operacional preservado, incluindo as observações e alterações realizadas.</DialogDescription></DialogHeader>
          {viewingRow && <div className="space-y-5">
            <div className="grid gap-3 rounded-xl bg-slate-50 p-4 text-sm sm:grid-cols-2"><Detail label="Máquina" value={`Prensa ${viewingRow.machine_code}`} /><Detail label="Motivo" value={viewingRow.reason} /><Detail label="Início" value={formatDateTime(viewingRow.started_at)} /><Detail label="Fim" value={viewingRow.ended_at ? formatDateTime(viewingRow.ended_at) : "Em andamento"} /><Detail label="Aberta por" value={viewingRow.reported_by_name} /><Detail label="Encerrada por" value={viewingRow.closed_by_name || "—"} /></div>
            <div className="grid gap-3 sm:grid-cols-2"><Observation label="Observação inicial" value={viewingRow.initial_observation || viewingRow.notes} /><Observation label="Observação de encerramento" value={viewingRow.closing_observation} /></div>
            <div><h3 className="font-heading font-bold text-slate-900">Histórico</h3>{historyLoading ? <div className="mt-3 grid place-items-center rounded-xl border p-6"><Loader2 className="animate-spin text-orange-500" /></div> : history.length ? <ol className="mt-3 space-y-3 border-l-2 border-slate-200 pl-4">{history.map((item) => <li key={item.id} className="relative text-sm"><span className="absolute -left-[22px] top-1.5 size-2.5 rounded-full bg-orange-500 ring-4 ring-white" /><p className="font-semibold text-slate-900">{historyLabel(item)}</p><p className="text-xs text-slate-500">{formatDateTime(item.occurred_at)} · {item.actor_name}</p>{item.field_name && <p className="mt-1 text-xs text-slate-600">{fieldLabel(item.field_name)}: <span className="line-through">{formatAuditValue(item.old_value)}</span> → {formatAuditValue(item.new_value)}</p>}</li>)}</ol> : <p className="mt-3 rounded-xl border border-dashed p-4 text-sm text-slate-500">Ainda não há alterações administrativas registradas.</p>}</div>
          </div>}
          <DialogFooter><Button type="button" variant="outline" onClick={() => setViewingRow(null)}>Fechar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(editingRow)} onOpenChange={(open) => { if (!open && !savingId) setEditingRow(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Pencil className="size-5 text-orange-600" />Editar parada</DialogTitle><DialogDescription>As mudanças recalculam a duração quando necessário e ficam registradas no histórico.</DialogDescription></DialogHeader>
          <form onSubmit={saveEdit} className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold">Máquina<select required value={editForm.machine} onChange={(event) => setEditForm({ ...editForm, machine: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3">{machines.map((code) => <option key={code} value={code}>Prensa {code === "18" ? "1.8" : code === "19" ? "1.9" : code}</option>)}</select></label>
            <label className="text-sm font-semibold">Motivo<Input required value={editForm.reason} onChange={(event) => setEditForm({ ...editForm, reason: event.target.value })} className="mt-1" /></label>
            <label className="text-sm font-semibold">Início<input type="datetime-local" required value={editForm.startedAt} onChange={(event) => setEditForm({ ...editForm, startedAt: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
            {editingRow?.status !== "open" && <label className="text-sm font-semibold">Fim<input type="datetime-local" required value={editForm.endedAt} onChange={(event) => setEditForm({ ...editForm, endedAt: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>}
            <label className="text-sm font-semibold">Responsável / área<Input value={editForm.department} onChange={(event) => setEditForm({ ...editForm, department: event.target.value })} className="mt-1" /></label>
            <label className="text-sm font-semibold">Turno<select value={editForm.shift} onChange={(event) => setEditForm({ ...editForm, shift: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3"><option value="">Sem turno</option>{shifts.map((shift) => <option key={shift.id} value={shift.code}>{shift.code} · {shift.name}</option>)}</select></label>
            <label className="text-sm font-semibold sm:col-span-2">Observação inicial<textarea required value={editForm.initialObservation} onChange={(event) => setEditForm({ ...editForm, initialObservation: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2 text-sm" /></label>
            <label className="text-sm font-semibold sm:col-span-2">Observação de encerramento <span className="font-normal text-slate-500">(opcional)</span><textarea value={editForm.closingObservation} onChange={(event) => setEditForm({ ...editForm, closingObservation: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2 text-sm" /></label>
            {editError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 sm:col-span-2">{editError}</p>}
            <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" disabled={Boolean(savingId)} onClick={() => setEditingRow(null)}>Cancelar</Button><Button type="submit" disabled={Boolean(savingId)} className="bg-orange-500 hover:bg-orange-600">{savingId ? <Loader2 className="animate-spin" /> : <Pencil />} Salvar alterações</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(deletingRow)} onOpenChange={(open) => { if (!open && !savingId) setDeletingRow(null); }}>
        <DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle className="flex items-center gap-2 text-red-700"><Trash2 className="size-5" />Excluir parada</DialogTitle><DialogDescription>Esta exclusão é lógica: ela retira a parada dos indicadores e relatórios operacionais, mas preserva o registro para auditoria.</DialogDescription></DialogHeader>{deletingRow && <div className="space-y-4"><div className="rounded-xl bg-red-50 p-3 text-sm"><p><b>Máquina:</b> Prensa {deletingRow.machine_code}</p><p><b>Motivo:</b> {deletingRow.reason}</p><p><b>Início:</b> {formatDateTime(deletingRow.started_at)}</p><p><b>Fim:</b> {deletingRow.ended_at ? formatDateTime(deletingRow.ended_at) : "Em andamento"}</p><p><b>Duração:</b> {deletingRow.ended_at ? formatDuration(deletingRow.duration_minutes) : formatLiveDuration(deletingRow.started_at)}</p></div><label className="block text-sm font-semibold">Motivo da exclusão<textarea required value={deletionReason} onChange={(event) => setDeletionReason(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Explique por que este apontamento deve ser excluído..." /></label></div>}<DialogFooter><Button type="button" variant="outline" disabled={Boolean(savingId)} onClick={() => setDeletingRow(null)}>Cancelar</Button><Button type="button" disabled={Boolean(savingId) || deletionReason.trim().length < 3} onClick={() => void deleteStoppage()} variant="destructive">{savingId ? <Loader2 className="animate-spin" /> : <Trash2 />} Excluir parada</Button></DialogFooter></DialogContent>
      </Dialog>
      <Dialog open={Boolean(closingRow)} onOpenChange={(open) => { if (!open && !savingId) setClosingRow(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="size-5 text-emerald-600" />Confirmar encerramento da parada</DialogTitle>
            <DialogDescription>Confira o horário antes de encerrar. Se o apontamento foi esquecido, corrija o término para o horário real.</DialogDescription>
          </DialogHeader>
          {closingRow && <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 p-3 text-sm"><strong>P{closingRow.machine_code} · {closingRow.reason}</strong><p className="mt-1 text-xs text-slate-500">Início registrado: {formatDateTime(closingRow.started_at)}</p></div>
            <div className="rounded-xl bg-slate-50 p-3 text-sm">
              <dl className="grid gap-2 sm:grid-cols-2"><div><dt className="text-[10px] font-bold uppercase text-slate-400">Motivo</dt><dd className="font-semibold">{closingRow.reason}</dd></div><div><dt className="text-[10px] font-bold uppercase text-slate-400">Aberta por</dt><dd>{closingRow.reported_by_name}</dd></div><div><dt className="text-[10px] font-bold uppercase text-slate-400">Tempo atual</dt><dd>{formatLiveDuration(closingRow.started_at)}</dd></div><div><dt className="text-[10px] font-bold uppercase text-slate-400">Observação inicial</dt><dd className="whitespace-pre-wrap">{closingRow.initial_observation || closingRow.notes || "—"}</dd></div></dl>
            </div>
            <label className="block text-sm font-semibold">Término da parada<input autoFocus type="datetime-local" required value={closingEndedAt} onChange={(event) => { setClosingEndedAt(event.target.value); setClosingError(""); }} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
            <label className="block text-sm font-semibold">Observação de encerramento <span className="font-normal text-slate-500">(opcional)</span><textarea value={closingObservation} onChange={(event) => setClosingObservation(event.target.value)} className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Informe a causa identificada, intervenção realizada e a condição de liberação..." /></label>
            {closingError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{closingError}</p>}
          </div>}
          <DialogFooter><Button type="button" variant="outline" disabled={Boolean(savingId)} onClick={() => setClosingRow(null)}>Voltar</Button><Button disabled={Boolean(savingId)} onClick={() => void closeStoppage()} className="bg-emerald-600 hover:bg-emerald-700">{savingId ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Confirmar encerramento</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function localDateTimeValue() {
  const date = new Date();
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function toLocalDateTimeValue(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 16);
}

function formatLiveDuration(startedAt: string) {
  return formatDuration(Math.max(0, (Date.now() - new Date(startedAt).getTime()) / 60000));
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div><p className="text-[10px] font-bold uppercase text-slate-400">{label}</p><p className="mt-0.5 font-semibold text-slate-800">{value}</p></div>;
}

function Observation({ label, value }: { label: string; value: string | null }) {
  return <div className="rounded-xl border p-3"><p className="text-xs font-bold text-slate-700">{label}</p><p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{value || "Não informada."}</p></div>;
}

function fieldLabel(value: string) {
  return ({ machine_code: "Máquina", reason: "Motivo", started_at: "Início", ended_at: "Fim", initial_observation: "Observação inicial", closing_observation: "Observação de encerramento", responsible_department: "Responsável / área", shift: "Turno", status: "Status", is_deleted: "Exclusão", deletion_reason: "Motivo da exclusão" } as Record<string, string>)[value] || value;
}

function formatAuditValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string") return value.replace(/^"|"$/g, "");
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  return JSON.stringify(value);
}

function historyLabel(item: StoppageHistory) {
  if (item.action === "created") return "Parada criada";
  if (item.action === "closed") return "Parada encerrada";
  if (item.action === "deleted") return "Parada excluída logicamente";
  return "Parada editada";
}

function Summary({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-white/10 p-5 md:border-r last:border-r-0">
      <span className="grid size-10 place-items-center rounded-xl bg-white/10 text-orange-400 [&_svg]:size-5">
        {icon}
      </span>
      <span>
        <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        <strong className={accent ? "text-2xl text-orange-400" : "text-2xl"}>
          {value}
        </strong>
      </span>
    </div>
  );
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(value: number | null) {
  const minutes = Math.round(value ?? 0);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

function errorMessage(cause: unknown) {
  if (cause && typeof cause === "object") {
    const problem = cause as {
      message?: string;
      details?: string;
      hint?: string;
    };
    return [problem.message, problem.details, problem.hint]
      .filter(Boolean)
      .join(" · ");
  }
  return cause instanceof Error
    ? cause.message
    : "Não foi possível concluir a operação.";
}
