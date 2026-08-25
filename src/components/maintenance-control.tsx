"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  Loader2,
  Search,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
                    Plano {row.plan_code || "—"}
                  </p>
                  <p className="text-xs text-slate-500">{row.order_number}</p>
                </div>
                <div>
                  <p className="text-[9px] font-bold uppercase text-slate-400">
                    Contexto
                  </p>
                  <p className="text-sm font-bold">{row.tool_code}</p>
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
    </div>
  );
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
