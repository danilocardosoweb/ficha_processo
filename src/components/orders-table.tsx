"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Factory,
  FileSpreadsheet,
  Filter,
  Layers3,
  Loader2,
  Search,
  Square,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/status-badge";
import { createClient } from "@/lib/supabase/client";
import type { ProductionOrder, SimplifiedQueue } from "@/types/database";
import { useCurrentUser } from "@/components/current-user-provider";

const pendingStatuses = new Set([
  "planned",
  "released",
  "in_progress",
  "paused",
]);

type QueueAction =
  | { kind: "complete_item" | "stop_item"; queue: SimplifiedQueue; order: ProductionOrder }
  | { kind: "finish_plan" | "delete_plan"; queue: SimplifiedQueue };

export function OrdersTable({ queues }: { queues: SimplifiedQueue[] }) {
  const { display_name: actor } = useCurrentUser();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [queueView, setQueueView] = useState("active");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<QueueAction | null>(null);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [producedKg, setProducedKg] = useState("");
  const [producedQuantity, setProducedQuantity] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState("");
  const normalizedSearch = search.trim().toLowerCase();

  const visible = useMemo(
    () =>
      queues
        .filter((queue) => queueView === "all" || (queueView === "history" ? ["completed", "cancelled"].includes(queue.production_status ?? "") : !["completed", "cancelled"].includes(queue.production_status ?? "")))
        .map((queue) => {
          const metadataMatch = [
            queue.plan_code,
            queue.machine_code,
            queue.file_name,
          ]
            .join(" ")
            .toLowerCase()
            .includes(normalizedSearch);
          const matchingOrders = queue.production_orders.filter(
            (order) =>
              (status === "all" || order.status === status) &&
              (!normalizedSearch ||
                metadataMatch ||
                matchesOrder(order, normalizedSearch)),
          );
          return { queue, orders: matchingOrders, metadataMatch };
        })
        .filter(
          ({ orders, metadataMatch }) =>
            orders.length > 0 ||
            (status === "all" && (!normalizedSearch || metadataMatch)),
        ),
    [normalizedSearch, queueView, queues, status],
  );

  const totalPending = queues.reduce(
    (sum, queue) =>
      sum +
      queue.production_orders.filter((order) =>
        pendingStatuses.has(order.status),
      ).length,
    0,
  );
  const activeQueues = queues.filter(
    (queue) =>
      queue.is_active &&
      queue.production_orders.some((order) =>
        pendingStatuses.has(order.status),
      ),
  );
  const nextFifoId = activeQueues[0]?.id;

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openAction(next: QueueAction) {
    setAction(next);
    setReason("");
    setConfirmText("");
    setActionError("");
    setProducedKg(next.kind === "complete_item" ? String(next.order.target_kg ?? "") : "");
    setProducedQuantity(next.kind === "complete_item" ? String(next.order.target_quantity ?? "") : "");
  }

  async function confirmAction() {
    if (!action) return;
    setSaving(true);
    setActionError("");
    try {
      const supabase = createClient();
      if (action.kind === "complete_item") {
        const { error } = await supabase.from("production_orders").update({
          status: "completed",
          is_active: false,
          completed_by_name: actor,
          produced_kg: Number(producedKg.replace(",", ".")) || 0,
          produced_quantity: Number(producedQuantity.replace(",", ".")) || 0,
          last_status_reason: `Produção confirmada manualmente por ${actor}`,
        }).eq("id", action.order.id);
        if (error) throw error;
      } else if (action.kind === "stop_item") {
        if (reason.trim().length < 3) throw new Error("Informe por que o item foi encerrado sem produção.");
        const { error } = await supabase.from("production_orders").update({
          status: "cancelled",
          is_active: false,
          completed_by_name: actor,
          last_status_reason: `Item encerrado sem produção por ${actor}: ${reason.trim()}`,
        }).eq("id", action.order.id);
        if (error) throw error;
      } else if (action.kind === "finish_plan") {
        const { error } = await supabase.rpc("finish_simplified_plan", { p_import_id: action.queue.id, p_actor: actor, p_reason: reason.trim() || "Plano finalizado manualmente" });
        if (error) throw error;
      } else {
        if (confirmText.trim().toUpperCase() !== String(action.queue.plan_code ?? "").trim().toUpperCase()) throw new Error("Digite exatamente o número do Plano para confirmar.");
        if (reason.trim().length < 5) throw new Error("Informe o motivo da exclusão.");
        const { error } = await supabase.rpc("archive_simplified_plan", { p_import_id: action.queue.id, p_actor: actor, p_reason: reason.trim() });
        if (error) throw error;
      }
      setAction(null);
      router.refresh();
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível concluir a operação.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="grid border-b bg-slate-950 text-white md:grid-cols-3">
        <QueueSummary
          icon={<Layers3 />}
          label="Simplificadas registradas"
          value={String(queues.length)}
        />
        <QueueSummary
          icon={<FileSpreadsheet />}
          label="Itens ainda na fila"
          value={String(totalPending)}
        />
        <QueueSummary
          icon={<Factory />}
          label="Próximo Plano FIFO"
          value={activeQueues[0]?.plan_code || "Fila concluída"}
          accent
        />
      </div>

      <div className="flex flex-col gap-3 border-b bg-slate-50/70 p-4 lg:flex-row lg:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar Plano, prensa, ferramenta, cliente ou ordem..."
            className="bg-white pl-9"
          />
        </div>
        <Select value={queueView} onValueChange={(value) => setQueueView(value ?? "active")}>
          <SelectTrigger className="w-full bg-white lg:w-44"><Layers3 className="size-3.5" /><SelectValue placeholder="Fila ativa" /></SelectTrigger>
          <SelectContent><SelectItem value="active">Fila ativa</SelectItem><SelectItem value="history">Histórico</SelectItem><SelectItem value="all">Todos os Planos</SelectItem></SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value ?? "all")}
        >
          <SelectTrigger className="w-full bg-white lg:w-48">
            <Filter className="size-3.5" />
            <SelectValue placeholder="Todos os status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            <SelectItem value="planned">Planejada</SelectItem>
            <SelectItem value="released">Liberada</SelectItem>
            <SelectItem value="in_progress">Em produção</SelectItem>
            <SelectItem value="paused">Pausada</SelectItem>
            <SelectItem value="completed">Concluída</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="divide-y">
        {visible.map(({ queue, orders }, index) => {
          const allOrders = queue.production_orders;
          const pending = allOrders.filter((order) =>
            pendingStatuses.has(order.status),
          ).length;
          const completed = allOrders.filter(
            (order) => order.status === "completed",
          ).length;
          const completion = allOrders.length
            ? Math.round((completed / allOrders.length) * 100)
            : 0;
          const isExpanded =
            expanded.has(queue.id) ||
            Boolean(normalizedSearch) ||
            status !== "all";
          const isNext = queue.id === nextFifoId;
          return (
            <section
              key={queue.id}
              className={isNext ? "bg-orange-50/30" : "bg-white"}
            >
              <button
                type="button"
                onClick={() => toggle(queue.id)}
                className="grid w-full items-center gap-3 px-4 py-4 text-left transition hover:bg-slate-50 md:grid-cols-[70px_1.1fr_.8fr_.8fr_1fr_44px]"
                aria-expanded={isExpanded}
              >
                <span className="font-mono text-xs font-black text-slate-400">
                  FIFO #{String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <strong className="font-heading text-lg text-slate-950">
                      Plano {queue.plan_code || "Não informado"}
                    </strong>
                    {isNext && (
                      <span className="rounded-full bg-orange-500 px-2 py-1 text-[9px] font-black text-white">
                        PRÓXIMA DO FIFO
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block truncate text-xs text-slate-500">
                    {queue.file_name}
                  </span>
                </span>
                <span>
                  <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-slate-400">
                    <CalendarDays className="size-3.5" /> Importada em
                  </span>
                  <strong className="mt-1 block text-sm">
                    {formatDateTime(queue.created_at)}
                  </strong>
                </span>
                <span>
                  <span className="text-[10px] font-bold uppercase text-slate-400">
                    Prensa
                  </span>
                  <strong className="mt-1 block text-sm">
                    {displayMachine(queue.machine_code)}
                  </strong>
                </span>
                <span className="min-w-0">
                  <span className="flex justify-between text-[10px] font-bold text-slate-500">
                    <span>{pending} pendentes</span>
                    <span>
                      {completed}/{allOrders.length} concluídas
                    </span>
                  </span>
                  <Progress value={completion} className="mt-2 h-1.5" />
                  <span className="mt-1 block text-[10px] font-semibold text-slate-400">
                    {queue.production_status === "completed"
                      ? `PLANO CONCLUÍDO${queue.production_completed_by_name ? ` · ${queue.production_completed_by_name}` : ""}`
                      : queue.production_status === "in_progress"
                        ? "PLANO EM PRODUÇÃO"
                        : queue.is_active
                          ? "PROGRAMAÇÃO ATIVA"
                          : "HISTÓRICO"}
                  </span>
                </span>
                <span className="grid size-9 place-items-center rounded-xl border bg-white text-slate-600 shadow-sm">
                  {isExpanded ? (
                    <ChevronDown className="size-4" />
                  ) : (
                    <ChevronRight className="size-4" />
                  )}
                </span>
              </button>

              {isExpanded && (
                <div className="border-t bg-white">
                  <OrderRows queue={queue} orders={orders} onAction={openAction} />
                </div>
              )}
            </section>
          );
        })}
        {visible.length === 0 && (
          <div className="p-12 text-center text-sm text-slate-500">
            Nenhuma Simplificada encontrada para os filtros informados.
          </div>
        )}
      </div>
      <ActionDialog action={action} saving={saving} error={actionError} reason={reason} confirmText={confirmText} producedKg={producedKg} producedQuantity={producedQuantity} onReasonChange={setReason} onConfirmTextChange={setConfirmText} onProducedKgChange={setProducedKg} onProducedQuantityChange={setProducedQuantity} onClose={() => !saving && setAction(null)} onConfirm={() => void confirmAction()} />
    </div>
  );
}

function OrderRows({ queue, orders, onAction }: { queue: SimplifiedQueue; orders: ProductionOrder[]; onAction: (action: QueueAction) => void }) {
  const pending = queue.production_orders.filter((order) => pendingStatuses.has(order.status)).length;
  return (
    <div className="overflow-x-auto">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-slate-50/60 px-5 py-2.5"><span className="text-xs text-slate-500">{pending ? `${pending} item(ns) ainda precisam de decisão.` : "Todos os itens deste plano foram encerrados."}</span><div className="flex gap-2">{queue.production_status !== "completed" && <Button size="sm" variant="outline" onClick={() => onAction({ kind: "finish_plan", queue })}><CheckCircle2 />Finalizar Simplificada</Button>}<Button size="sm" variant="destructive" onClick={() => onAction({ kind: "delete_plan", queue })}><Trash2 />Excluir Simplificada</Button></div></div>
      <table className="w-full min-w-[1000px] text-left text-xs">
        <thead className="bg-slate-50 text-[9px] uppercase tracking-wider text-slate-400">
          <tr>
            <th className="px-5 py-2.5">Seq.</th>
            <th className="px-5 py-2.5">Ordem / item</th>
            <th className="px-5 py-2.5">Ferramenta / perfil</th>
            <th className="px-5 py-2.5">Cliente</th>
            <th className="px-5 py-2.5">Liga</th>
            <th className="px-5 py-2.5">Kg</th>
            <th className="px-5 py-2.5">Pcs</th>
            <th className="px-5 py-2.5">Prazo entrega</th>
            <th className="px-5 py-2.5">Status</th>
            <th className="px-5 py-2.5 text-right">Ações</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="border-t hover:bg-slate-50/70">
              <td className="px-5 py-3 font-mono font-bold text-slate-400">
                {String(order.sequence).padStart(2, "0")}
              </td>
              <td className="px-5 py-3 font-mono font-semibold">
                {order.order_number}
              </td>
              <td className="px-5 py-3">
                <strong className="font-mono text-orange-600">
                  {order.tool_code}
                </strong>
                {order.product_code && (
                  <span className="ml-2 text-slate-400">
                    {order.product_code}
                  </span>
                )}
              </td>
              <td className="px-5 py-3">{order.customer_name || "—"}</td>
              <td className="px-5 py-3 font-mono">
                {order.alloy_code} {order.temper}
              </td>
              <td className="px-5 py-3 font-bold">
                {order.target_kg
                  ? order.target_kg.toLocaleString("pt-BR", {
                      maximumFractionDigits: 3,
                    })
                  : "—"}
              </td>
              <td className="px-5 py-3 font-bold">
                {order.target_quantity?.toLocaleString("pt-BR") || "—"}
              </td>
              <td className="px-5 py-3">{formatDueDate(order.due_date)}</td>
              <td className="px-5 py-3">
                <StatusBadge status={order.status} />
              </td>
              <td className="px-5 py-3"><div className="flex justify-end gap-1.5">{pendingStatuses.has(order.status) ? <><Button size="xs" className="bg-emerald-600 hover:bg-emerald-700" onClick={() => onAction({ kind: "complete_item", queue, order })}><CheckCircle2 />Produzido</Button><Button size="xs" variant="outline" onClick={() => onAction({ kind: "stop_item", queue, order })}><Square />Não produzido</Button></> : <span className="text-[10px] text-slate-400">Encerrado</span>}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
      {orders.length === 0 && (
        <p className="p-8 text-center text-sm text-slate-500">
          Nenhuma ordem deste Plano corresponde aos filtros.
        </p>
      )}
    </div>
  );
}

function QueueSummary({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-white/10 px-5 py-4 md:border-r last:border-r-0">
      <span className="grid size-9 place-items-center rounded-xl bg-white/10 text-orange-400 [&_svg]:size-4">
        {icon}
      </span>
      <span>
        <span className="block text-[9px] font-bold uppercase tracking-wider text-slate-400">
          {label}
        </span>
        <strong
          className={accent ? "text-lg text-orange-400" : "text-lg text-white"}
        >
          {value}
        </strong>
      </span>
    </div>
  );
}

function matchesOrder(order: ProductionOrder, search: string) {
  return [
    order.order_number,
    order.plan_code,
    order.tool_code,
    order.product_code,
    order.customer_name,
  ]
    .join(" ")
    .toLowerCase()
    .includes(search);
}

function displayMachine(code: string | null) {
  if (code === "18") return "Prensa 1.8";
  if (code === "19") return "Prensa 1.9";
  return code ? `Prensa ${code}` : "Não identificada";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDueDate(value: string | null) {
  return value
    ? new Date(`${value}T12:00`).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
      })
    : "—";
}

function ActionDialog({ action, saving, error, reason, confirmText, producedKg, producedQuantity, onReasonChange, onConfirmTextChange, onProducedKgChange, onProducedQuantityChange, onClose, onConfirm }: {
  action: QueueAction | null;
  saving: boolean;
  error: string;
  reason: string;
  confirmText: string;
  producedKg: string;
  producedQuantity: string;
  onReasonChange: (value: string) => void;
  onConfirmTextChange: (value: string) => void;
  onProducedKgChange: (value: string) => void;
  onProducedQuantityChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!action) return null;
  const isComplete = action.kind === "complete_item";
  const isStop = action.kind === "stop_item";
  const isFinish = action.kind === "finish_plan";
  const queue = action.queue;
  const pending = queue.production_orders.filter((order) => pendingStatuses.has(order.status)).length;
  const title = isComplete ? "Confirmar item produzido" : isStop ? "Encerrar item sem produção" : isFinish ? "Finalizar Simplificada" : "Excluir Simplificada";
  const description = isComplete
    ? `Registre o resultado produzido da ordem ${action.order.order_number}.`
    : isStop
      ? `O item ${action.order.order_number} sairá da fila, mas continuará no histórico.`
      : isFinish
        ? pending ? `${pending} item(ns) pendente(s) serão encerrados como não produzidos.` : "O Plano será retirado da fila ativa."
        : `O Plano ${queue.plan_code} será retirado da fila. Os registros serão preservados para auditoria.`;
  const destructive = action.kind === "delete_plan";

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
    {isComplete && <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="produced-kg">Kg produzido</Label><Input id="produced-kg" inputMode="decimal" value={producedKg} onChange={(event) => onProducedKgChange(event.target.value)} className="mt-1" /></div><div><Label htmlFor="produced-quantity">Peças produzidas</Label><Input id="produced-quantity" inputMode="numeric" value={producedQuantity} onChange={(event) => onProducedQuantityChange(event.target.value)} className="mt-1" /></div></div>}
    {(isStop || isFinish || destructive) && <div><Label htmlFor="action-reason">{destructive ? "Motivo da exclusão" : "Observação"}</Label><Input id="action-reason" value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder={destructive ? "Ex.: arquivo importado incorretamente" : "Informe o motivo, quando necessário"} className="mt-1" /></div>}
    {destructive && <div className="rounded-xl border border-red-200 bg-red-50 p-3"><Label htmlFor="confirm-plan" className="text-red-800">Digite o Plano <strong>{queue.plan_code}</strong> para confirmar</Label><Input id="confirm-plan" value={confirmText} onChange={(event) => onConfirmTextChange(event.target.value)} className="mt-1 border-red-200 bg-white font-mono font-bold" autoComplete="off" /></div>}
    {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={saving} onClick={onClose}>Cancelar</Button><Button variant={destructive ? "destructive" : "default"} disabled={saving || (destructive && confirmText.trim().toUpperCase() !== String(queue.plan_code ?? "").trim().toUpperCase())} onClick={onConfirm} className={!destructive ? "bg-orange-500 hover:bg-orange-600" : undefined}>{saving ? <><Loader2 className="animate-spin" />Salvando...</> : destructive ? <><Trash2 />Excluir com segurança</> : <><CheckCircle2 />Confirmar</>}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
