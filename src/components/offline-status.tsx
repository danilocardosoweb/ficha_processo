"use client";

import { Cloud, CloudOff, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getOfflineSnapshot, syncOperationalData } from "@/lib/offline-store";

type State = "syncing" | "online" | "offline" | "error";

export function OfflineStatus() {
  const [state, setState] = useState<State>("syncing");
  const [lastSync, setLastSync] = useState<string | null>(null);

  const sync = useCallback(async () => {
    if (!navigator.onLine) {
      setState("offline");
      return;
    }
    setState("syncing");
    try {
      await syncOperationalData();
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
    const online = () => void sync();
    const offline = () => setState("offline");
    const requested = () => void sync();
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    window.addEventListener("alummes-request-sync", requested);
    const initialSync = window.setTimeout(() => void sync(), 0);
    const interval = window.setInterval(
      () => {
        if (navigator.onLine) void sync();
      },
      15 * 60 * 1000,
    );
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      window.removeEventListener("alummes-request-sync", requested);
      window.clearTimeout(initialSync);
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
