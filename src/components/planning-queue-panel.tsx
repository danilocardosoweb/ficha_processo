"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, Clock3, HardDrive, ListOrdered, LoaderCircle, LockKeyhole, RefreshCw, ShieldCheck, UserRound } from "lucide-react";
import type { LocalRole } from "@/lib/local-auth/types";

type ActiveReservation = {
  requestId: string;
  displayName: string;
  machineName: string;
  acquiredAt: string;
  lastHeartbeatAt: string;
  heartbeatAgeMs: number;
  mine: boolean;
};

type QueueRequest = {
  id: string;
  ticket: number;
  displayName: string;
  machineName: string;
  requestedAt: string;
  mine: boolean;
};

type QueueStatus = {
  available: boolean;
  sharedRoot: string;
  machineName: string;
  active: ActiveReservation | null;
  waiting: QueueRequest[];
  mine: { requestId: string; status: "waiting" | "active"; ticket: number; position: number | null; token?: string } | null;
  recoverable: boolean;
};

type ApiError = { error?: string };

let pendingAutomaticExitTimer: number | null = null;

function sendAutomaticExit(mine: NonNullable<QueueStatus["mine"]>) {
  void fetch("/api/local/planning-queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "auto-release", requestId: mine.requestId, ...(mine.token ? { token: mine.token } : {}) }),
    keepalive: true,
  }).catch(() => {
    // Se a rede cair durante a saída, a reserva fica protegida e pode ser recuperada pelo administrador.
  });
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function formatWait(milliseconds: number) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60_000));
  if (minutes < 1) return "há menos de 1 min";
  return `há ${minutes} min`;
}

export function PlanningQueuePanel({ displayName, role }: { displayName: string; role: LocalRole }) {
  const [status, setStatus] = useState<QueueStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const canRecover = role === "admin" || role === "manager";
  const statusRef = useRef<QueueStatus | null>(null);
  const mountedRef = useRef(false);
  const ensuringRef = useRef(false);

  const publishStatus = useCallback((next: QueueStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const refresh = useCallback(async (quiet = false): Promise<QueueStatus | null> => {
    if (!quiet) setLoading(true);
    try {
      const response = await fetch("/api/local/planning-queue", { cache: "no-store" });
      const data = await response.json() as QueueStatus & ApiError;
      if (!response.ok) throw new Error(data.error || "Não foi possível consultar a fila.");
      publishStatus(data);
      setError("");
      return data;
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : "Pasta de rede indisponível.");
      return null;
    } finally {
      if (!quiet && mountedRef.current) setLoading(false);
    }
  }, [publishStatus]);

  const ensureAutomaticTurn = useCallback(async () => {
    if (ensuringRef.current) return null;
    ensuringRef.current = true;
    try {
      const response = await fetch("/api/local/planning-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ensure" }),
      });
      const data = await response.json() as QueueStatus & ApiError;
      if (!response.ok) throw new Error(data.error || "Não foi possível solicitar o acesso automático.");
      if (!mountedRef.current) {
        if (data.mine) sendAutomaticExit(data.mine);
        return null;
      }
      publishStatus(data);
      setError("");
      return data;
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : "Não foi possível solicitar o acesso automático.");
      return null;
    } finally {
      ensuringRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  }, [publishStatus]);

  useEffect(() => {
    mountedRef.current = true;
    if (pendingAutomaticExitTimer !== null) {
      window.clearTimeout(pendingAutomaticExitTimer);
      pendingAutomaticExitTimer = null;
    }
    const initialLoad = window.setTimeout(() => void ensureAutomaticTurn(), 0);
    const interval = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const next = await refresh(true);
      if (next?.mine?.status === "waiting" && next.mine.position === 1 && !next.active) {
        void ensureAutomaticTurn();
      }
    }, 15_000);
    return () => {
      mountedRef.current = false;
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
      const mine = statusRef.current?.mine;
      if (mine) {
        pendingAutomaticExitTimer = window.setTimeout(() => {
          pendingAutomaticExitTimer = null;
          sendAutomaticExit(mine);
        }, 350);
      }
    };
  }, [ensureAutomaticTurn, refresh]);

  const activeRequestId = status?.mine?.status === "active" ? status.mine.requestId : null;
  const activeToken = status?.mine?.status === "active" ? status.mine.token : null;

  useEffect(() => {
    if (!activeRequestId || !activeToken) return;
    const interval = window.setInterval(async () => {
      try {
        const response = await fetch("/api/local/planning-queue", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "heartbeat", requestId: activeRequestId, token: activeToken }),
        });
        const data = await response.json() as ApiError;
        if (!response.ok) throw new Error(data.error || "A reserva não foi renovada.");
      } catch (cause) {
        if (mountedRef.current) setError(cause instanceof Error ? cause.message : "A conexão com a fila foi interrompida.");
      }
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [activeRequestId, activeToken]);

  async function recover(reason: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/local/planning-queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "recover", reason }),
      });
      const data = await response.json() as ApiError;
      if (!response.ok) throw new Error(data.error || "A recuperação não foi concluída.");
      setMessage("A reserva parada foi encerrada; o acesso da próxima estação será liberado automaticamente.");
      await refresh(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível recuperar a reserva.");
      await refresh(true);
    } finally {
      setBusy(false);
    }
  }

  async function refreshAndAdvance() {
    const next = await refresh();
    if (next?.mine?.status === "waiting" && next.mine.position === 1 && !next.active) {
      void ensureAutomaticTurn();
    }
  }

  const mine = status?.mine ?? null;
  const active = status?.active ?? null;

  return <div className="space-y-4">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600"><ListOrdered className="size-5" /></span>
          <div><h2 className="font-heading text-lg font-bold text-slate-950">Acesso à edição da programação</h2><p className="mt-1 text-sm text-slate-600">A entrada, a liberação e o avanço da fila acontecem automaticamente nesta tela.</p></div>
        </div>
        <button type="button" onClick={() => void refreshAndAdvance()} disabled={loading || busy} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />Atualizar</button>
      </div>

      <div className={`mt-5 flex items-start gap-3 rounded-xl border p-4 text-sm leading-6 ${error ? "border-red-200 bg-red-50 text-red-900" : "border-slate-200 bg-slate-50 text-slate-700"}`} role={error ? "alert" : "status"}>
        {error ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600" /> : status ? <HardDrive className="mt-0.5 size-5 shrink-0 text-slate-500" /> : <LoaderCircle className="mt-0.5 size-5 shrink-0 animate-spin text-slate-500" />}
        <div className="min-w-0"><strong className="block">{error ? "Fila indisponível — edição bloqueada" : status ? "Compartilhamento conectado" : "Conectando à pasta compartilhada…"}</strong><span>{error || (status ? `Pasta: ${status.sharedRoot}` : "Verificando a rede e solicitando acesso…")}</span></div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4"><div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><LockKeyhole className="size-4 text-orange-600" />Quem está com a vez</div>
          {active ? <div className="mt-3"><p className="font-semibold text-slate-950">{active.mine ? "Você" : active.displayName}</p><p className="text-sm text-slate-600">Computador {active.machineName} · desde {formatTime(active.acquiredAt)}</p><p className="mt-1 text-xs text-slate-500">Última confirmação {formatWait(active.heartbeatAgeMs)}</p></div> : <p className="mt-3 text-sm text-slate-500">Ninguém está editando agora.</p>}
        </div>
        <div className="rounded-xl border border-slate-200 p-4"><div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><UserRound className="size-4 text-blue-600" />Sua solicitação automática</div>
          {mine?.status === "active" ? <p className="mt-3 font-semibold text-emerald-700">Sua vez está liberada neste computador. A reserva é renovada automaticamente.</p> : mine?.status === "waiting" ? <p className="mt-3 font-semibold text-slate-800">Aguardando automaticamente na posição {mine.position} · senha {mine.ticket}</p> : <p className="mt-3 text-sm text-slate-500">Solicitando acesso automaticamente…</p>}
        </div>
      </div>

      {active && status?.recoverable && canRecover && <div className="mt-5"><button type="button" disabled={busy || Boolean(error)} onClick={() => {
        const confirmed = window.confirm(`A estação ${active.machineName}, de ${active.displayName}, não confirma atividade há mais de 5 minutos. Só recupere se confirmou que o aplicativo/computador foi encerrado. Continuar?`);
        if (!confirmed) return;
        const reason = window.prompt("Registre o motivo da recuperação (mínimo 10 caracteres):") ?? "";
        if (reason.trim().length >= 10) void recover(reason);
        else setError("A recuperação não foi feita. Informe um motivo com pelo menos 10 caracteres.");
      }} className="inline-flex h-11 items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 text-sm font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"><ShieldCheck className="size-4" />Recuperar reserva parada</button></div>}
      {message && <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-emerald-700" role="status"><CheckCircle2 className="size-4" />{message}</p>}
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2"><Clock3 className="size-5 text-slate-500" /><h2 className="font-heading text-lg font-bold text-slate-950">Ordem de atendimento</h2></div>
      {status?.waiting.length ? <ol className="mt-4 divide-y divide-slate-100">{status.waiting.map((item, index) => <li key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><span className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold ${index === 0 ? "bg-orange-100 text-orange-800" : "bg-slate-100 text-slate-700"}`}>{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900">{item.mine ? `${displayName} (você)` : item.displayName}</p><p className="text-xs text-slate-500">Computador {item.machineName} · solicitação {formatTime(item.requestedAt)}</p></div><span className="text-xs font-bold text-slate-500">senha {item.ticket}</span></li>)}</ol> : <p className="mt-3 text-sm text-slate-500">Ainda não há ninguém aguardando.</p>}
    </section>

    <aside className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
      <p className="flex items-center gap-2 font-bold"><CircleHelp className="size-4" />O que esta fila protege</p>
      <p className="mt-1">Ao abrir esta tela, o computador entra na ordem automaticamente; ao chegar a vez, o acesso é liberado sem clique. Ao sair da tela, a espera é cancelada ou a vez é liberada. Se o aplicativo fechar abruptamente ou a rede cair, a reserva pode exigir recuperação administrativa após 5 minutos.</p>
      <p className="mt-2">A fila organiza a vez entre computadores, mas ainda não está conectada ao salvamento/publicação da programação. Até essa integração, ela não deve ser considerada uma proteção de alterações. O SQLite de cada computador permanece local; a pasta compartilhada precisa estar disponível e restrita às estações autorizadas.</p>
    </aside>
  </div>;
}
