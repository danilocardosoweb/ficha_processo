"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Megaphone, Plus, Send, UsersRound, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { roleLabels } from "@/lib/local-auth/types";
import type { MessageAudience, MessagePriority, MessageTarget, SentOperationalMessage } from "@/lib/operational-messages/types";
import { cn } from "@/lib/utils";

const priorityOptions: { value: MessagePriority; label: string; description: string }[] = [
  { value: "info", label: "Informação", description: "Comunicado geral" },
  { value: "attention", label: "Atenção", description: "Exige cuidado" },
  { value: "urgent", label: "Urgente", description: "Alta prioridade" },
  { value: "critical", label: "Crítico", description: "Ação imediata" },
];
const audienceOptions: { value: MessageAudience; label: string }[] = [
  { value: "all", label: "Toda a operação" }, { value: "press", label: "Uma prensa" }, { value: "user", label: "Um usuário" }, { value: "role", label: "Um perfil" },
];

function formatDate(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }

export function MessagesManager() {
  const [messages, setMessages] = useState<SentOperationalMessage[]>([]);
  const [targets, setTargets] = useState<MessageTarget[]>([]);
  const [composer, setComposer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<MessagePriority>("attention");
  const [audienceType, setAudienceType] = useState<MessageAudience>("all");
  const [target, setTarget] = useState("");
  const [duration, setDuration] = useState("8");
  const [requiresAck, setRequiresAck] = useState(false);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/messages?view=admin", { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) { setError(result.error || "Não foi possível carregar."); return; }
    setMessages(result.messages ?? []); setTargets(result.targets ?? []); setError("");
  }
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, []);

  const activeCount = useMemo(() => messages.filter((message) => message.is_active && (!message.expires_at || new Date(message.expires_at) > new Date())).length, [messages]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(""); setSuccess("");
    const expiresAt = duration === "none" ? null : new Date(Date.now() + Number(duration) * 60 * 60 * 1000).toISOString();
    const response = await fetch("/api/messages", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, body, priority, audienceType, targetUserId: audienceType === "user" ? target : null, targetRole: audienceType === "role" ? target : null, targetMachineCode: audienceType === "press" ? target : null, expiresAt, requiresAck }) });
    const result = await response.json().catch(() => ({})); setSaving(false);
    if (!response.ok) { setError(result.error || "Não foi possível enviar a mensagem."); return; }
    setTitle(""); setBody(""); setPriority("attention"); setAudienceType("all"); setTarget(""); setDuration("8"); setRequiresAck(false); setComposer(false); setSuccess("Mensagem publicada e entregue ao destino selecionado."); await load();
  }

  async function deactivate(id: string) {
    if (!window.confirm("Encerrar este aviso? Ele deixará de aparecer imediatamente para os destinatários.")) return;
    const response = await fetch("/api/messages", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "deactivate", id }) });
    if (!response.ok) { setError("Não foi possível encerrar o aviso."); return; }
    await load();
  }

  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border bg-white p-4 shadow-sm"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Avisos ativos</span><p className="mt-1 text-2xl font-black text-slate-900">{activeCount}</p></div>
      <div className="rounded-2xl border bg-white p-4 shadow-sm"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Pessoas disponíveis</span><p className="mt-1 text-2xl font-black text-slate-900">{targets.length}</p></div>
      <Button className="h-full min-h-20 rounded-2xl text-base shadow-sm" onClick={() => setComposer((current) => !current)}>{composer ? <X /> : <Plus />}{composer ? "Fechar mensagem" : "Nova mensagem"}</Button>
    </section>

    {composer && <form onSubmit={submit} className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex items-center gap-3 border-b px-5 py-4"><span className="grid size-10 place-items-center rounded-xl bg-orange-50 text-orange-600"><Megaphone className="size-5" /></span><div><h2 className="font-heading text-lg font-bold">Publicar aviso operacional</h2><p className="text-sm text-slate-500">Direcione a mensagem; o sino e os alertas serão atualizados automaticamente.</p></div></div>
      <div className="grid gap-4 p-5 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-4"><label className="block text-sm font-semibold">Título<Input className="mt-1 h-11" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ex.: Prioridade do Plano 17250" maxLength={100} required /></label><label className="block text-sm font-semibold">Mensagem<textarea className="mt-1 min-h-28 w-full resize-y rounded-xl border bg-transparent px-3 py-2 text-sm outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-500/15" value={body} onChange={(event) => setBody(event.target.value)} placeholder="Informe o que precisa ser feito, o motivo e o prazo." maxLength={1000} required /></label></div>
        <div className="space-y-4"><fieldset><legend className="text-sm font-semibold">Prioridade</legend><div className="mt-1 grid grid-cols-2 gap-2">{priorityOptions.map((option) => <button type="button" key={option.value} onClick={() => setPriority(option.value)} className={cn("rounded-xl border p-2.5 text-left transition", priority === option.value ? "border-orange-400 bg-orange-50 ring-2 ring-orange-500/10" : "hover:bg-slate-50")}><span className="block text-sm font-bold">{option.label}</span><span className="text-[11px] text-slate-500">{option.description}</span></button>)}</div></fieldset><label className="block text-sm font-semibold">Destino<select className="mt-1 h-11 w-full rounded-xl border bg-white px-3 text-sm" value={audienceType} onChange={(event) => { setAudienceType(event.target.value as MessageAudience); setTarget(""); }}>{audienceOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          {audienceType === "press" && <label className="block text-sm font-semibold">Prensa<select className="mt-1 h-11 w-full rounded-xl border bg-white px-3 text-sm" value={target} onChange={(event) => setTarget(event.target.value)} required><option value="">Selecione</option><option value="18">Prensa 1.8</option><option value="19">Prensa 1.9</option></select></label>}
          {audienceType === "user" && <label className="block text-sm font-semibold">Usuário<select className="mt-1 h-11 w-full rounded-xl border bg-white px-3 text-sm" value={target} onChange={(event) => setTarget(event.target.value)} required><option value="">Selecione</option>{targets.map((item) => <option key={item.id} value={item.id}>{item.display_name} · {item.username}</option>)}</select></label>}
          {audienceType === "role" && <label className="block text-sm font-semibold">Perfil<select className="mt-1 h-11 w-full rounded-xl border bg-white px-3 text-sm" value={target} onChange={(event) => setTarget(event.target.value)} required><option value="">Selecione</option>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          <div className="grid grid-cols-2 gap-3"><label className="block text-sm font-semibold">Validade<select className="mt-1 h-11 w-full rounded-xl border bg-white px-3 text-sm" value={duration} onChange={(event) => setDuration(event.target.value)}><option value="2">2 horas</option><option value="8">8 horas</option><option value="24">24 horas</option><option value="72">3 dias</option><option value="168">7 dias</option><option value="none">Até encerrar</option></select></label><label className="flex items-end"><span className="flex h-11 w-full items-center gap-2 rounded-xl border bg-slate-50 px-3 text-sm font-semibold"><input type="checkbox" checked={requiresAck} onChange={(event) => setRequiresAck(event.target.checked)} className="size-4 accent-orange-600" />Exigir confirmação</span></label></div>
        </div>
      </div><div className="flex justify-end border-t bg-slate-50 px-5 py-3"><Button disabled={saving}><Send />{saving ? "Publicando..." : "Publicar aviso"}</Button></div>
    </form>}

    {(error || success) && <div className={cn("flex items-center gap-2 rounded-xl border p-3 text-sm font-medium", error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>{error ? <AlertTriangle className="size-4" /> : <CheckCircle2 className="size-4" />}{error || success}</div>}

    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-heading text-lg font-bold">Mensagens publicadas</h2><p className="text-sm text-slate-500">Histórico e confirmações de leitura.</p></div><UsersRound className="size-5 text-slate-400" /></div>{loading ? <p className="p-10 text-center text-sm text-slate-500">Carregando...</p> : messages.length === 0 ? <p className="p-10 text-center text-sm text-slate-500">Nenhuma mensagem publicada.</p> : <div className="divide-y">{messages.map((message) => <article key={message.id} className={cn("flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center", !message.is_active && "opacity-55")}><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", message.priority === "critical" ? "bg-red-100 text-red-700" : message.priority === "urgent" ? "bg-orange-100 text-orange-700" : message.priority === "attention" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700")}>{priorityOptions.find((item) => item.value === message.priority)?.label}</span><span className="text-xs font-semibold text-slate-500">{message.target_label}</span>{!message.is_active && <span className="text-xs font-bold text-slate-400">Encerrada</span>}</div><h3 className="mt-1 font-bold text-slate-900">{message.title}</h3><p className="mt-0.5 truncate text-sm text-slate-600">{message.body}</p></div><div className="flex shrink-0 items-center gap-4 text-xs text-slate-500"><span><Clock3 className="mr-1 inline size-3.5" />{formatDate(message.created_at)}</span><span><strong className="text-slate-900">{message.read_count}</strong> leitura(s)</span>{message.requires_ack && <span><strong className="text-slate-900">{message.acknowledged_count}</strong> confirmação(ões)</span>}{message.is_active && <Button size="sm" variant="outline" onClick={() => void deactivate(message.id)}>Encerrar</Button>}</div></article>)}</div>}</section>
  </div>;
}
