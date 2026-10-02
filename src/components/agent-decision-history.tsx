"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { agentNames } from "@/modules/planning/agents/contracts";
import type { JournalEntry, Review } from "@/modules/planning/agents/journal";

export const reviewLabels = { accepted_guidance: "Orientação aceita para conferência", rejected: "Recusada", simulation_requested: "Solicitada aplicação somente na simulação" };
export function AgentDecisionActions({ archiveId, index, move, disabled, canApply, onDecision }: {
  archiveId?: string; index: number; move: boolean; disabled: boolean; canApply: boolean;
  onDecision: (choice: Review["choice"]) => void;
}) {
  const [reason, setReason] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function decide(choice: Review["choice"]) {
    if (busy || disabled || !archiveId || reason.trim().length < 10) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/planning-agents/history", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archiveId, proposalIndex: index, choice, reason }) });
      if (response.redirected) throw new Error("Entre novamente antes de registrar a decisão.");
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      onDecision(choice);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Falha ao registrar. Nenhuma alteração solicitada."); }
    finally { setBusy(false); }
  }
  return <div className="mt-4 space-y-2 border-t pt-3">
    <label className="block text-sm font-semibold">Motivo da decisão<textarea maxLength={500} value={reason} disabled={disabled || busy} onChange={e => setReason(e.target.value)} placeholder="Explique por que aceita ou recusa (mínimo 10 caracteres)." className="mt-1 block min-h-20 w-full rounded-lg border bg-white p-2 font-normal"/></label>
    <div className="flex flex-wrap gap-2"><Button disabled={disabled || busy || !archiveId || reason.trim().length < 10 || (move && !canApply)} onClick={() => void decide(move ? "simulation_requested" : "accepted_guidance")}>{busy ? "Registrando..." : move ? "Confirmar troca na simulação" : "Aceitar para conferência"}</Button><Button variant="outline" disabled={disabled || busy || !archiveId || reason.trim().length < 10} onClick={() => void decide("rejected")}>Recusar com motivo</Button></div>
    <p className="text-xs text-slate-600">Registro pessoal no servidor local. Não autoriza nem registra produção. {move && !canApply && "Recalcule a proposta e confira sua permissão antes de confirmar."}</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}

export function AgentDecisionHistory() {
  const [entries, setEntries] = useState<JournalEntry[]>([]); const [busy,setBusy] = useState(false); const [message,setMessage] = useState("Carregue seus últimos 50 pareceres e decisões.");
  async function refresh() {
    setBusy(true);
    try {
      const response = await fetch("/api/planning-agents/history", { cache: "no-store" });
      if (response.redirected) throw new Error("Entre novamente para consultar o histórico.");
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setEntries(body.entries); setMessage(body.entries.length ? "Histórico somente para consulta: dados antigos não representam a operação atual." : "Ainda não há pareceres salvos para seu usuário.");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "Não foi possível carregar."); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3 rounded-2xl border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-bold">Memória de decisões · seu histórico</h4><Button variant="outline" disabled={busy} onClick={() => void refresh()}>{busy ? "Carregando..." : "Carregar / atualizar histórico"}</Button></div><p role="status" className="text-sm text-slate-600">{message}</p><div className="max-h-96 space-y-2 overflow-auto">{entries.map(entry => <details key={entry.id} className="rounded-xl border p-3"><summary className="cursor-pointer font-semibold">{agentNames[entry.report.role]} · {new Date(entry.report.createdAt).toLocaleString("pt-BR")} · {entry.reviews.length} decisões</summary><p className="mt-2 text-sm">{entry.report.findings.summary}</p>{entry.report.findings.proposals.map((proposal,index) => { const review = entry.reviews.find(r => r.proposalIndex === index); return <div key={index} className="mt-3 border-t pt-2 text-sm"><strong>{proposal.title}</strong><p>{proposal.explanation}</p><p className="mt-1 font-semibold">{review ? reviewLabels[review.choice] : "Sem decisão registrada"}</p>{review && <p>Motivo: {review.reason}</p>}</div>; })}<p className="mt-2 text-xs text-slate-500">{entry.report.model} · skill {entry.report.skillVersion}</p></details>)}</div></section>;
}
