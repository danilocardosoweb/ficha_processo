"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Bell, Check, CheckCheck, CircleAlert, Info, Megaphone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OperationalMessage } from "@/lib/operational-messages/types";

type MessagesContextValue = {
  messages: OperationalMessage[];
  unreadCount: number;
  open: boolean;
  setOpen: (value: boolean) => void;
  refresh: () => Promise<void>;
};

const MessagesContext = createContext<MessagesContextValue | null>(null);

const priorityStyle = {
  info: { icon: Info, label: "Informação", tone: "border-blue-200 bg-blue-50 text-blue-800", accent: "text-blue-600" },
  attention: { icon: CircleAlert, label: "Atenção", tone: "border-amber-200 bg-amber-50 text-amber-900", accent: "text-amber-600" },
  urgent: { icon: AlertTriangle, label: "Urgente", tone: "border-orange-200 bg-orange-50 text-orange-900", accent: "text-orange-600" },
  critical: { icon: Megaphone, label: "Crítico", tone: "border-red-200 bg-red-50 text-red-900", accent: "text-red-600" },
};

export function useOperationalMessages() {
  const value = useContext(MessagesContext);
  if (!value) throw new Error("useOperationalMessages deve ser usado dentro do provider.");
  return value;
}

export function OperationalMessagesProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<OperationalMessage[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/messages", { cache: "no-store" });
      if (!response.ok) throw new Error("Falha ao carregar");
      const result = await response.json();
      setMessages(result.messages ?? []);
      setError("");
    } catch {
      setError("Avisos temporariamente indisponíveis.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(interval); };
  }, [refresh]);

  async function mark(id: string, action: "read" | "acknowledge" | "dismiss") {
    const response = await fetch("/api/messages", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operation: "mark", id, action }),
    });
    if (response.ok) await refresh();
  }

  const unreadCount = useMemo(() => messages.filter((message) => !message.read_at).length, [messages]);
  const featured = messages.find((message) => !message.acknowledged_at && (message.priority === "critical" || message.priority === "urgent"));

  return (
    <MessagesContext.Provider value={{ messages, unreadCount, open, setOpen, refresh }}>
      {children}
      {featured && <div className={cn("fixed bottom-4 left-4 right-4 z-30 flex items-center gap-3 rounded-2xl border p-3 shadow-xl lg:left-auto lg:right-6 lg:max-w-xl", priorityStyle[featured.priority].tone)}>
        <AlertTriangle className="size-5 shrink-0" />
        <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(true)}><span className="block truncate text-sm font-bold">{featured.title}</span><span className="block truncate text-xs opacity-80">{featured.body}</span></button>
        <Button size="sm" variant="outline" className="shrink-0 bg-white/80" onClick={() => void mark(featured.id, featured.requires_ack ? "acknowledge" : "dismiss")}>{featured.requires_ack ? "Confirmar" : "Dispensar"}</Button>
      </div>}
      {open && <div className="fixed inset-0 z-50 bg-slate-950/35" onMouseDown={() => setOpen(false)}>
        <aside className="ml-auto flex h-full w-full max-w-md flex-col bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
          <div className="flex items-center justify-between border-b px-5 py-4"><div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-orange-50 text-orange-600"><Bell className="size-5" /></span><div><h2 className="font-heading text-lg font-bold">Central de avisos</h2><p className="text-xs text-slate-500">{unreadCount ? `${unreadCount} não lido(s)` : "Tudo em dia"}</p></div></div><Button size="icon" variant="ghost" onClick={() => setOpen(false)} aria-label="Fechar"><X className="size-5" /></Button></div>
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {loading && <p className="py-12 text-center text-sm text-slate-500">Carregando avisos...</p>}
            {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {!loading && !error && messages.length === 0 && <div className="grid place-items-center py-20 text-center"><span className="grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-600"><CheckCheck className="size-7" /></span><h3 className="mt-4 font-bold">Nenhum aviso pendente</h3><p className="mt-1 text-sm text-slate-500">As mensagens destinadas a você ou à sua prensa aparecerão aqui.</p></div>}
            {messages.map((message) => {
              const style = priorityStyle[message.priority];
              const Icon = style.icon;
              return <article key={message.id} className={cn("rounded-2xl border p-4", message.read_at ? "bg-white" : style.tone)} onMouseEnter={() => { if (!message.read_at) void mark(message.id, "read"); }}>
                <div className="flex items-start gap-3"><Icon className={cn("mt-0.5 size-5 shrink-0", style.accent)} /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{message.title}</h3>{!message.read_at && <span className="size-2 rounded-full bg-orange-500" />}</div><p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-slate-700">{message.body}</p><div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500"><span className="font-semibold">{style.label}</span><span>{message.target_label}</span><span>por {message.created_by_name}</span></div></div></div>
                <div className="mt-3 flex justify-end gap-2">{message.requires_ack && !message.acknowledged_at && <Button size="sm" onClick={() => void mark(message.id, "acknowledge")}><Check className="size-4" />Li e estou ciente</Button>}{(!message.requires_ack || message.acknowledged_at) && <Button size="sm" variant="ghost" onClick={() => void mark(message.id, "dismiss")}>Dispensar</Button>}</div>
              </article>;
            })}
          </div>
        </aside>
      </div>}
    </MessagesContext.Provider>
  );
}
