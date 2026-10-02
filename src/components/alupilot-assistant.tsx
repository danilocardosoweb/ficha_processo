"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
import { useChat } from "@ai-sdk/react";
import { Bot, LoaderCircle, RotateCcw, Send, Sparkles, Wrench } from "lucide-react";
import { usePathname } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useCurrentUser } from "@/components/current-user-provider";

const historyKey = "alupilot-assistant-history-v1";

function screenLabel(pathname: string) {
  if (pathname.includes("carga-maquina")) return "Carga Máquina";
  if (pathname.includes("producao")) return "Produção";
  if (pathname.includes("forno")) return "Forno de ferramentas";
  if (pathname.includes("paradas")) return "Paradas de máquina";
  if (pathname.includes("diario-bordo")) return "Report da Produção";
  if (pathname.includes("relatorios")) return "Relatórios";
  if (pathname.includes("carteira")) return "Carteira e planejamento";
  return "AluPilot";
}

function partsOf(message: UIMessage) {
  return message.parts as Array<{ type?: string; text?: string; toolName?: string; state?: string }>;
}

function toolLabel(part: { type?: string; toolName?: string }) {
  const name = part.toolName || part.type?.replace(/^tool-/, "") || "consulta";
  const labels: Record<string, string> = {
    consultar_programacao: "Programação consultada",
    consultar_producao: "Produção consultada",
    consultar_status_prensa: "Status da prensa consultado",
    consultar_forno: "Forno consultado",
    consultar_paradas: "Paradas consultadas",
    consultar_diario_bordo: "Report da Produção consultado",
  };
  return labels[name] ?? "Fonte operacional consultada";
}

export function AluPilotAssistant() {
  const user = useCurrentUser();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userHistoryKey = `${historyKey}:${user.organization_id}:${user.user_id}`;
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/alupilot-assistant" }), []);
  const { messages, sendMessage, status, error, stop, setMessages } = useChat({ transport });

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(userHistoryKey);
      if (stored) setMessages(JSON.parse(stored) as UIMessage[]);
    } catch {
      // O histórico local é apenas uma conveniência; não impede o uso do assistente.
    } finally {
      setHydrated(true);
    }
  }, [setMessages, userHistoryKey]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(userHistoryKey, JSON.stringify(messages.slice(-30)));
    } catch {
      // O armazenamento pode estar bloqueado pelo navegador.
    }
  }, [hydrated, messages, userHistoryKey]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, open]);

  function submit(text = input) {
    const value = text.trim();
    if (!value || status !== "ready") return;
    sendMessage(
      { text: value },
      {
        body: {
          context: {
            route: pathname,
            screen: screenLabel(pathname),
            scenario: "current",
          },
        },
      },
    );
    setInput("");
  }

  function clearHistory() {
    setMessages([]);
    try {
      window.localStorage.removeItem(userHistoryKey);
    } catch {
      // Sem efeito para a conversa atual.
    }
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 text-slate-600 hover:bg-violet-50 hover:text-violet-700"
            aria-label="Abrir Assistente AluPilot"
          />
        }
      >
        <Sparkles className="size-4 text-violet-600" />
        <span className="hidden lg:inline">Assistente</span>
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-none gap-0 border-l border-violet-100 p-0 sm:max-w-[460px]" showCloseButton>
        <SheetHeader className="border-b border-slate-100 bg-gradient-to-br from-violet-50 via-white to-white pr-14">
          <div className="flex items-center gap-2">
            <div className="grid size-9 place-items-center rounded-xl bg-violet-100 text-violet-700"><Sparkles className="size-5" /></div>
            <div>
              <SheetTitle className="text-base font-bold text-slate-950">Assistente AluPilot</SheetTitle>
              <SheetDescription className="text-xs">Consulta operacional segura · somente leitura</SheetDescription>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500">
            <Badge variant="outline" className="border-violet-200 bg-white text-violet-700">{screenLabel(pathname)}</Badge>
            <span>Fontes são consultadas no servidor</span>
          </div>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {!messages.length && (
              <div className="rounded-2xl border border-violet-100 bg-violet-50/60 p-4">
                <div className="flex items-start gap-3">
                  <Bot className="mt-0.5 size-5 shrink-0 text-violet-700" />
                  <div>
                    <p className="text-sm font-semibold text-slate-900">Posso investigar a operação com você.</p>
                    <p className="mt-1 text-xs leading-5 text-slate-600">Pergunte sobre produção, programação, forno, paradas ou passagem de turno. Quando necessário, consultarei os registros autorizados.</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["O que está acontecendo na produção?", "Quais paradas ocorreram recentemente?", "Quais ferramentas ainda estão no forno?"] .map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => submit(suggestion)} className="rounded-full border border-violet-200 bg-white px-3 py-1.5 text-left text-[11px] font-semibold text-violet-800 transition hover:bg-violet-100">{suggestion}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message) => {
              const parts = partsOf(message);
              const text = parts.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
              const toolParts = parts.filter((part) => part.type?.startsWith("tool-") || part.type === "dynamic-tool");
              return (
                <div key={message.id} className={message.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div className={message.role === "user" ? "max-w-[88%] rounded-2xl rounded-br-md bg-slate-900 px-3.5 py-2.5 text-sm text-white" : "max-w-[94%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3 text-sm text-slate-800 shadow-sm"}>
                    {message.role !== "user" && <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-violet-700"><Sparkles className="size-3" />AluPilot</div>}
                    {text && <p className="whitespace-pre-wrap leading-5">{text}</p>}
                    {toolParts.length > 0 && (
                      <div className="mt-2 space-y-1.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
                        {toolParts.map((part, index) => <div key={`${message.id}-tool-${index}`} className="flex items-center gap-1.5"><Wrench className="size-3 text-violet-500" />{toolLabel(part)} · {part.state === "output-available" ? "concluída" : "em andamento"}</div>)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {(status === "submitted" || status === "streaming") && <div className="flex items-center gap-2 text-xs text-slate-500"><LoaderCircle className="size-4 animate-spin text-violet-600" />Consultando fontes autorizadas…<button type="button" onClick={() => stop()} className="font-semibold text-violet-700 hover:underline">Parar</button></div>}
            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-700">{error.message || "O assistente não conseguiu responder."}</div>}
            <div ref={bottomRef} />
          </div>

          <SheetFooter className="border-t border-slate-100 bg-white p-3">
            <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="flex items-center gap-2">
              <Input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Pergunte sobre a operação…" disabled={status !== "ready"} className="h-10 rounded-xl" aria-label="Pergunta para o Assistente AluPilot" />
              <Button type="submit" size="icon" className="size-10 rounded-xl bg-violet-600 hover:bg-violet-700" disabled={!input.trim() || status !== "ready"} aria-label="Enviar pergunta"><Send className="size-4" /></Button>
            </form>
            <div className="flex items-center justify-between px-1 pt-1 text-[10px] text-slate-400">
              <span>Não executa alterações</span>
              <button type="button" onClick={clearHistory} className="inline-flex items-center gap-1 font-semibold text-slate-500 hover:text-violet-700"><RotateCcw className="size-3" />Limpar conversa</button>
            </div>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}
