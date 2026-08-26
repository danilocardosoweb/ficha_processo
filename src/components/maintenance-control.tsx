"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Plus,
  Loader2,
  Search,
  ShieldAlert,
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
  shift: string | null;
  started_at: string;
  ended_at: string | null;
  duration_minutes: number | null;
  status: "open" | "closed" | "cancelled";
  maintenance_required: boolean;
  reported_by_name: string;
  closed_by_name: string | null;
};
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
  const { display_name: operatorName } = useCurrentUser();
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

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    try {
      const { data, error } = await createClient()
        .from("machine_stoppages")
        .select(
          "id,production_order_id,maintenance_work_order_id,machine_code,plan_code,order_number,tool_code,product_code,customer_name,category,reason_code,reason,responsible_department,notes,shift,started_at,ended_at,duration_minutes,status,maintenance_required,reported_by_name,closed_by_name",
        )
        .eq("organization_id", organizationId)
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
      if (settingsResponse.ok) { const settings = await settingsResponse.json(); setShifts((settings.shifts ?? []).filter((item: { is_active: boolean }) => item.is_active)); }
    })();
  }, []);

  const catalogTypes = catalog.filter((item) => ["E", "F", "O", "PL", "UTL", "NPR"].includes(item.code));
  const selectedCatalogType = catalogTypes.find((item) => item.code === newForm.typeCode);
  const catalogReasons = catalog.filter((item) => item.group_code === newForm.typeCode);

  async function addStoppage(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId || !newForm.machine || (!newForm.reason.trim() && !newForm.reasonId)) return;
    setSavingNew(true); setMessage("");
    try {
      const startedAt = new Date(newForm.startedAt).toISOString();
      const selectedReason = catalogReasons.find((item) => item.id === newForm.reasonId);
      const { error } = await createClient().from("machine_stoppages").insert({
        organization_id: organizationId, production_order_id: null, import_batch_id: null,
        machine_code: newForm.machine, plan_code: null, order_number: "", tool_code: "",
        category: selectedCatalogType?.metadata?.internal_category || "other", reason_catalog_id: selectedReason?.id || null, stoppage_type_catalog_id: selectedCatalogType?.id || null,
        reason_code: selectedReason?.code || newForm.reasonCode.trim() || null,
        reason: [selectedReason?.label, newForm.reason.trim()].filter(Boolean).join(" · "), responsible_department: newForm.department || selectedReason?.responsible_department || null,
        notes: newForm.notes.trim() || null, shift: newForm.shift.trim() || null,
        started_at: startedAt, status: "open", maintenance_required: true, reported_by_name: operatorName,
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

  async function closeStoppage(row: Stoppage) {
    const endedAt = new Date();
    const duration = Math.max(
      0,
      (endedAt.getTime() - new Date(row.started_at).getTime()) / 60000,
    );
    setSavingId(row.id);
    setMessage("");
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("machine_stoppages")
        .update({
          status: "closed",
          ended_at: endedAt.toISOString(),
          duration_minutes: Number(duration.toFixed(2)),
          closed_by_name: operatorName,
        })
        .eq("id", row.id)
        .eq("status", "open");
      if (error) throw error;
      if (row.maintenance_work_order_id) {
        const { error: workOrderError } = await supabase
          .from("maintenance_work_orders")
          .update({
            status: "completed",
            completed_at: endedAt.toISOString(),
          })
          .eq("id", row.maintenance_work_order_id)
          .in("status", ["open", "in_progress", "waiting"]);
        if (workOrderError) throw workOrderError;
      }
      setRows((current) =>
        current.map((item) =>
          item.id === row.id
            ? {
                ...item,
                status: "closed",
                ended_at: endedAt.toISOString(),
                duration_minutes: duration,
                closed_by_name: operatorName,
              }
            : item,
        ),
      );
      setMessage(
        `Parada da P${row.machine_code} encerrada. A produção pode ser retomada pelo operador.`,
      );
    } catch (cause) {
      setMessage(errorMessage(cause));
    } finally {
      setSavingId("");
    }
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
                    {row.notes ? ` · ${row.notes}` : ""}
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
                <div className="flex items-center justify-end gap-2">
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
                      onClick={() => void closeStoppage(row)}
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
            <label className="text-sm font-semibold">Tipo de parada<select value={newForm.typeCode} onChange={(event) => setNewForm({ ...newForm, typeCode: event.target.value, reasonId: "" })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3">{(catalogTypes.length ? catalogTypes : [{ id: "fallback-e", code: "E", label: "EQUIPAMENTO", group_code: null, metadata: { internal_category: "mechanical" }, responsible_department: "Manutenção", routes_to_maintenance: true }]).map((type) => <option key={type.id} value={type.code}>{type.label} · {type.code}</option>)}</select></label>
            <label className="text-sm font-semibold">Motivo catalogado<select value={newForm.reasonId} onChange={(event) => setNewForm({ ...newForm, reasonId: event.target.value, reason: "" })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3"><option value="">Outro motivo (digitar abaixo)</option>{catalogReasons.map((reason) => <option key={reason.id} value={reason.id}>{reason.code} · {reason.label}</option>)}</select></label>
            <label className="text-sm font-semibold sm:col-span-2">Descrição complementar{newForm.reasonId ? <span className="ml-2 text-xs font-normal text-slate-500">opcional</span> : null}<Input required={!newForm.reasonId} value={newForm.reason} onChange={(event) => setNewForm({ ...newForm, reason: event.target.value })} className="mt-1" placeholder={newForm.reasonId ? "Detalhe adicional (opcional)" : "Ex.: Prensa desligada por falha hidráulica"} /></label>
            <label className="text-sm font-semibold">Código manual (opcional)<Input value={newForm.reasonCode} onChange={(event) => setNewForm({ ...newForm, reasonCode: event.target.value })} className="mt-1" placeholder="Ex.: E-014" /></label>
            <label className="text-sm font-semibold">Turno<select value={newForm.shift} onChange={(event) => setNewForm({ ...newForm, shift: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3"><option value="">Sem turno informado</option>{shifts.map((shift) => <option key={shift.id} value={shift.code}>{shift.code} · {shift.name}</option>)}</select></label>
            <label className="text-sm font-semibold">Início da parada<input type="datetime-local" required value={newForm.startedAt} onChange={(event) => setNewForm({ ...newForm, startedAt: event.target.value })} className="mt-1 h-10 w-full rounded-lg border px-3" /></label>
            <label className="text-sm font-semibold">Responsável / área<Input value={newForm.department} onChange={(event) => setNewForm({ ...newForm, department: event.target.value })} className="mt-1" /></label>
            <label className="text-sm font-semibold sm:col-span-2">Observação inicial<textarea value={newForm.notes} onChange={(event) => setNewForm({ ...newForm, notes: event.target.value })} className="mt-1 min-h-20 w-full rounded-lg border px-3 py-2 text-sm" placeholder="Sintomas, impacto ou orientação para a manutenção..." /></label>
            <div className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs text-amber-800 sm:col-span-2"><CalendarClock className="mt-0.5 size-4 shrink-0" />O tempo total será calculado automaticamente quando a parada for encerrada.</div>
            <DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setAddOpen(false)}>Cancelar</Button><Button type="submit" disabled={savingNew || !newForm.machine} className="bg-orange-500 hover:bg-orange-600">{savingNew ? <Loader2 className="animate-spin" /> : <Wrench />} Abrir parada</Button></DialogFooter>
          </form>
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
