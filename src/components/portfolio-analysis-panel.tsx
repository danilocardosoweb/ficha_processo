"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, CircleCheck, Clock3, LockKeyhole, Sparkles } from "lucide-react";
import type { AttentionGroup, PortfolioAnalysis, PortfolioAnalysisRow } from "@/modules/portfolio-intelligence/portfolio-priority-engine";

type PanelFilter = AttentionGroup | "INCONSISTENCIES" | null;

const formatKg = (value: number) => `${value.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg`;
const levelMeta = {
  CRITICAL: ["Crítica", "bg-red-100 text-red-800"],
  HIGH: ["Alta", "bg-orange-100 text-orange-800"],
  NORMAL: ["Normal", "bg-amber-100 text-amber-800"],
  MONITOR: ["Acompanhar", "bg-slate-100 text-slate-700"],
} as const;

export function PortfolioAnalysisPanel({ analysis, activeFilter, onFilter, onSelectTool }: { analysis: PortfolioAnalysis; activeFilter: PanelFilter; onFilter: (filter: PanelFilter) => void; onSelectTool: (tool: string) => void }) {
  const [explaining, setExplaining] = useState<string | number | null>(null);
  const groups: { id: Exclude<PanelFilter, null>; title: string; count: number; description: string; icon: typeof AlertTriangle; className: string; rows: PortfolioAnalysisRow[] }[] = [
    { id: "IMMEDIATE", title: "Ação imediata", count: analysis.immediate.length, description: "Pode ser programado agora", icon: AlertTriangle, className: "border-red-200 bg-red-50", rows: analysis.immediate },
    { id: "BLOCKED", title: "Aguardando / bloqueados", count: analysis.blocked.length, description: "Importante, mas depende da ferramenta", icon: LockKeyhole, className: "border-amber-200 bg-amber-50", rows: analysis.blocked },
    { id: "FOLLOW_UP", title: "Acompanhar", count: analysis.followUp.length, description: "Já possui plano e prazo próximo", icon: Clock3, className: "border-blue-200 bg-blue-50", rows: analysis.followUp },
    { id: "INCONSISTENCIES", title: "Dados para conferir", count: analysis.inconsistencies.length, description: "Não entram na fila até serem validados", icon: Sparkles, className: "border-violet-200 bg-violet-50", rows: [] },
  ];
  return <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
    <div className="flex flex-col gap-2 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-orange-600">Leitura determinística</p><h2 className="font-heading text-lg font-bold text-slate-900">Análise da carteira</h2><p className="text-xs text-slate-500">Mostra onde o PCP deve olhar primeiro; não altera planos nem prioridades.</p></div>
      <div className="flex items-center gap-2 text-xs text-slate-500"><CircleCheck className="size-4 text-emerald-600" />{analysis.summary.openOrders} pedido(s) com saldo aberto</div>
    </div>
    <div className="grid gap-px bg-slate-100 lg:grid-cols-4">
      {groups.map((group) => { const Icon = group.icon; const active = activeFilter === group.id; return <button type="button" key={group.id} onClick={() => onFilter(active ? null : group.id)} className={`min-h-28 p-4 text-left transition hover:brightness-[.98] ${group.className} ${active ? "ring-2 ring-inset ring-orange-500" : ""}`}><div className="flex items-start justify-between gap-2"><span className="grid size-8 place-items-center rounded-lg bg-white/80 text-slate-700"><Icon className="size-4" /></span><strong className="text-2xl tabular-nums text-slate-900">{group.count}</strong></div><p className="mt-3 text-xs font-bold text-slate-900">{group.title}</p><p className="mt-0.5 text-[11px] text-slate-600">{group.description}</p></button>; })}
    </div>
    <div className="grid gap-4 p-4 xl:grid-cols-[1.4fr_.6fr]">
      <div>
        <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-bold text-slate-900">{activeFilter === "IMMEDIATE" ? "O que pode ser programado agora" : activeFilter === "BLOCKED" ? "O que está aguardando ferramenta" : activeFilter === "FOLLOW_UP" ? "Itens para acompanhar" : activeFilter === "INCONSISTENCIES" ? "Inconsistências encontradas" : "Principais itens que precisam de atenção"}</h3>{activeFilter && <button type="button" onClick={() => onFilter(null)} className="text-xs font-semibold text-orange-700 hover:underline">Limpar filtro</button>}</div>
        {activeFilter === "INCONSISTENCIES" ? <div className="space-y-2">{analysis.inconsistencies.slice(0, 5).map((item, index) => <div key={`${item.orderId}-${index}`} className="rounded-xl border border-violet-100 bg-violet-50/40 px-3 py-2 text-xs"><strong className="font-mono text-violet-800">{item.toolCode || "Sem ferramenta"} · {item.orderNumber}</strong><p className="mt-1 text-slate-600">{item.message}</p></div>)}{!analysis.inconsistencies.length && <Empty text="Nenhuma inconsistência foi encontrada nesta leitura." />}</div> : <PriorityList rows={(activeFilter === "IMMEDIATE" ? analysis.immediate : activeFilter === "BLOCKED" ? analysis.blocked : activeFilter === "FOLLOW_UP" ? analysis.followUp : [...analysis.immediate, ...analysis.blocked, ...analysis.followUp]).slice(0, 5)} explaining={explaining} onExplain={setExplaining} onSelectTool={onSelectTool} />}
      </div>
      <div className="rounded-xl border bg-slate-50/60 p-3"><p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Ferramentas com maior impacto</p><div className="mt-2 space-y-2">{analysis.tools.slice(0, 4).map((tool) => <button key={tool.toolCode} type="button" onClick={() => onSelectTool(tool.toolCode)} className="flex w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 py-2 text-left hover:border-orange-200"><div><strong className="font-mono text-xs text-orange-700">{tool.toolCode}</strong><p className="mt-0.5 text-[10px] text-slate-500">{tool.overdueOrders} atrasado(s) · {tool.notPlannedOrders} sem plano</p></div><span className="text-right text-[10px] font-bold text-slate-700">{formatKg(tool.unplannedBalanceKg)}</span></button>)}{!analysis.tools.length && <Empty text="Não há ferramentas com saldo aberto." />}</div></div>
    </div>
  </section>;
}

function PriorityList({ rows, explaining, onExplain, onSelectTool }: { rows: PortfolioAnalysisRow[]; explaining: string | number | null; onExplain: (id: string | number | null) => void; onSelectTool: (tool: string) => void }) {
  if (!rows.length) return <Empty text="Nenhum item nesta fila agora." />;
  return <div className="space-y-2">{rows.map((row) => { const [label, levelClass] = levelMeta[row.priorityLevel]; const expanded = explaining === row.id; return <article key={row.id} className="rounded-xl border bg-white px-3 py-2.5"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><button type="button" onClick={() => row.toolCode && onSelectTool(row.toolCode)} className="font-mono text-xs font-black text-orange-700 hover:underline">{row.toolCode || "Sem ferramenta"}</button><strong className="text-xs text-slate-900">Pedido {row.orderNumber}</strong><span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${levelClass}`}>{label}</span><span className="ml-auto text-xs font-black tabular-nums text-slate-700">{row.priorityScore}</span></div><p className="mt-1 text-[11px] text-slate-600">{row.customerName || "Sem cliente"} · {formatKg(row.unplannedUnit && row.serviceUnit !== "pieces" ? row.unplannedUnit : Math.max(row.balanceKg - row.plannedKg, 0))} ainda sem plano</p><div className="mt-2 flex items-center justify-between gap-3"><span className="text-[10px] text-slate-500">{row.toolStatusLabel}</span><button type="button" onClick={() => onExplain(expanded ? null : row.id)} className="inline-flex items-center gap-1 text-[10px] font-bold text-orange-700 hover:underline">Por que? <ArrowRight className="size-3" /></button></div>{expanded && <div className="mt-2 rounded-lg bg-slate-50 p-2 text-[10px] text-slate-600"><p className="font-bold text-slate-700">Motivos</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{row.priorityReasons.length ? row.priorityReasons.map((reason) => <li key={reason}>{reason}</li>) : <li>Sem urgência operacional calculada.</li>}</ul>{row.priorityPenalties.length ? <><p className="mt-2 font-bold text-slate-700">Restrições</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{row.priorityPenalties.map((penalty) => <li key={penalty}>{penalty}</li>)}</ul></> : null}</div>}</article>; })}</div>;
}
function Empty({ text }: { text: string }) { return <div className="grid min-h-24 place-items-center rounded-xl border border-dashed bg-slate-50 px-4 text-center text-xs text-slate-500">{text}</div>; }
