"use client";

import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { getOfflineSnapshot, syncOperationalData, type OfflineResource } from "@/lib/offline-store";

type State = "syncing" | "online" | "offline" | "error";

export function OfflineStatus() {
  const [state, setState] = useState<State>("syncing");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const pendingResources = useRef(new Set<OfflineResource>());
  const requestedTimer = useRef<number | null>(null);

  const sync = useCallback(async (resources?: OfflineResource[], foreground = false, force = false) => {
    if (!navigator.onLine) {
      setState("offline");
      return;
    }
    if (foreground) setState("syncing");
    try {
      await syncOperationalData({ resources, force });
      const cached = await getOfflineSnapshot("process_sheets");
      setLastSync(cached?.syncedAt ?? new Date().toISOString());
      setState("online");
    } catch {
      const cached = await getOfflineSnapshot("process_sheets");
      setLastSync(cached?.syncedAt ?? null);
      setState(cached ? "offline" : "error");
    }
  }, []);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production")
      void navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
    let cancelled = false;
    const initialize = async () => {
      const cached = await getOfflineSnapshot("process_sheets").catch(() => null);
      if (cancelled) return;
      setLastSync(cached?.syncedAt ?? null);
      if (!navigator.onLine) {
        setState(cached ? "offline" : "error");
        return;
      }
      if (cached) {
        setState("online");
        void sync();
      } else {
        void sync(undefined, true);
      }
    };
    const online = () => void sync(undefined, false, true);
    const offline = () => setState("offline");
    const requested = (event: Event) => {
      const resources = (event as CustomEvent<{ resources?: OfflineResource[] }>).detail?.resources ?? [];
      resources.forEach((resource) => pendingResources.current.add(resource));
      if (requestedTimer.current) window.clearTimeout(requestedTimer.current);
      requestedTimer.current = window.setTimeout(() => {
        const queued = [...pendingResources.current];
        pendingResources.current.clear();
        void sync(queued.length ? queued : undefined, false, true);
      }, 250);
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("alummes-request-sync", requested);
    const initialSync = window.setTimeout(() => void initialize(), 0);
    const interval = window.setInterval(
      () => {
        if (navigator.onLine) void sync();
      },
      15 * 60 * 1000,
    );
    return () => {
      cancelled = true;
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("alummes-request-sync", requested);
      window.clearTimeout(initialSync);
      if (requestedTimer.current) window.clearTimeout(requestedTimer.current);
      window.clearInterval(interval);
    };
  }, [sync]);

  const label =
    state === "syncing"
      ? "Salvando dados locais..."
      : state === "online"
        ? "Operação online · dados salvos"
        : state === "offline"
          ? "Modo offline · usando dados salvos"
          : "Cache local indisponível";
  const title = lastSync
    ? `Última sincronização: ${new Date(lastSync).toLocaleString("pt-BR")}`
    : label;
  return (
    <div
      role="status"
      title={title}
      className={`hidden items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium sm:flex ${state === "offline" ? "bg-amber-50 text-amber-700" : state === "error" ? "bg-red-50 text-red-700" : "text-slate-500"}`}
    >
      {state === "syncing" ? (
        <Loader2 className="size-3.5 animate-spin text-orange-500" />
      ) : state === "offline" || state === "error" ? (
        <CloudOff className="size-3.5" />
      ) : (
        <Cloud className="size-3.5 text-emerald-500" />
      )}
      {label}
    </div>
  );
}
