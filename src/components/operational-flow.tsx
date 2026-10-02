"use client";
import { useState } from "react";
import { ArrowDown, ArrowRight, Flame, Layers, Factory, ListOrdered, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { runCandidate, type DecisionCandidate, type DecisionContext } from "@/modules/planning/decision-system/optimizer";
import type { DecisionProfile } from "@/modules/planning/decision-system/schema";
import { movePlannedOrder } from "@/modules/planning/decision-system/sequence-change";

const date = (value: Date | null) => value ? value.toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "Não informado";
const minutes = (value:number) => {const v=Math.round(value);return `${Math.floor(v/60)}h ${v%60}min`;};
const field = "mt-1 w-full rounded-xl border bg-white px-3 py-2 text-sm";
type Props = { context:DecisionContext; profile:DecisionProfile; current:DecisionCandidate; canAdjust:boolean; onApply:(candidate:DecisionCandidate)=>void; initialOrderId?:string };

export function OperationalFlow({context,profile,current,canAdjust,onApply,initialOrderId}:Props) {
  const [machine,setMachine] = useState(current.simulation.machines.find(m=>m.items.some(i=>i.id===initialOrderId))?.machineCode ?? current.simulation.machines[0]?.machineCode ?? "");
  const [selected,setSelected] = useState(initialOrderId ?? "");
  const [stage,setStage] = useState("thermal");
  const [sequenceOpen,setSequenceOpen] = useState(false);
  const [position,setPosition] = useState(1);
  const [reason,setReason] = useState("");
  const [preview,setPreview] = useState<DecisionCandidate|null>(null);
  const [error,setError] = useState("");
  const items = current.simulation.machines.find(row=>row.machineCode===machine)?.items ?? [];
  const item = items.find(row=>row.id===selected) ?? items[0];
  if (!item) return <p>Não há ordens nesta prensa para montar o fluxo.</p>;
  const itemIndex = items.findIndex(row=>row.id===item.id);
  const resourceProblems = item.resourceConflicts.filter(row=>row.type!=="tool-conflict");
  const thermalWaiting = item.thermalWaitMinutes>0 || item.toolHeatingState!=="released";
  const nodes = [
    {id:"thermal",icon:Flame,title:"1. Conferir aquecimento",value:thermalWaiting ? "Aquecimento a conferir" : "Liberação cadastrada",detail:`Pronta na previsão: ${date(item.calculatedToolReadyAt)}`,attention:thermalWaiting},
    {id:"carcass",icon:Layers,title:"2. Separar carcaça",value:item.carcassCode ?? "Falta informar a carcaça",detail:"Conferir modelo, estoque e reservas",attention:item.resourceConflicts.some(c=>c.type.includes("carcass"))},
    {id:"bo",icon:Layers,title:"3. Separar BO",value:item.boCode ? `BO ${item.boCode}` : "Falta informar o BO",detail:"Conferir disponibilidade calculada",attention:item.resourceConflicts.some(c=>c.type.includes("bo"))},
    {id:"press",icon:Factory,title:"4. Preparar e produzir",value:`Prensa ${machine}`,detail:`Entrada prevista: ${date(item.extrusionStartAt)}`,attention:item.resourceConflicts.some(c=>c.severity==="blocking")},
  ];
  function choose(id:string) {setSelected(id);setPreview(null);setError("");setReason("");}
  function test() {
    try {
      const changed=movePlannedOrder(context.orders,item.id,position,reason);
      const result=runCandidate(context,profile,changed.orders,"Ajuste por imprevisto");
      result.sequenceChange=changed.change;
      setPreview(result);setError("");
    } catch(cause) {setPreview(null);setError(cause instanceof Error?cause.message:"Não foi possível calcular a troca.");}
  }
  const changedItem=preview?.simulation.machines.flatMap(m=>m.items).find(row=>row.id===item.id);
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-xl font-bold text-slate-950">Caminho da ferramenta até a prensa</h3><p className="mt-1 text-sm text-slate-600">Escolha uma ordem e toque em uma etapa para saber o que conferir.</p></div>
      <Button variant="outline" onClick={()=>setSequenceOpen(!sequenceOpen)}><ListOrdered className="size-4"/>{sequenceOpen?"Recolher sequenciamento":"Abrir sequenciamento"}</Button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold">Prensa<select className={field} value={machine} onChange={e=>{setMachine(e.target.value);choose("");}}>{current.simulation.machines.map(m=><option key={m.machineCode}>{m.machineCode}</option>)}</select></label>
      <label className="text-sm font-semibold">Ferramenta e ordem<select className={field} value={item.id} onChange={e=>choose(e.target.value)}>{items.map((row,index)=><option value={row.id} key={row.id}>{index+1}. {row.toolCode} · ordem {row.orderNumber}</option>)}</select></label>
    </div>
    <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">Este fluxo mostra a previsão da simulação, não uma autorização para operar. Temperatura medida e limite de liberação não estão disponíveis neste cálculo. Não use 450 °C como regra automática.</div>
    <div className="grid gap-3 lg:grid-cols-4">{nodes.map(node=><button key={node.id} type="button" aria-pressed={stage===node.id} onClick={()=>setStage(node.id)} className={`relative rounded-2xl border-2 p-4 text-left transition hover:shadow-md focus-visible:outline-2 focus-visible:outline-blue-600 ${stage===node.id?"border-blue-600 bg-blue-50":node.attention?"border-amber-200 bg-amber-50":"border-slate-200 bg-white"}`}>
      <node.icon className="mb-3 size-6 text-blue-700"/><span className="block text-xs font-semibold text-slate-600">{node.title}</span><strong className="mt-1 block text-base text-slate-950">{node.value}</strong><span className="mt-2 block text-xs text-slate-600">{node.detail}</span>
      <ArrowRight aria-hidden="true" className="absolute right-3 top-4 size-4 text-slate-400"/>
    </button>)}</div>
    <section className="rounded-2xl border bg-slate-50 p-4" aria-live="polite">
      {stage==="thermal" ? <>
        <h4 className="font-bold">A ferramenta está liberada conforme o procedimento da fábrica?</h4>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-emerald-200 bg-white p-3"><strong className="text-emerald-800">Se sim → conferir carcaça e BO</strong><p className="mt-2 text-sm">Confirme a liberação registrada e as condições de uso com o responsável. O horário calculado não substitui a medição.</p><Button className="mt-3" variant="outline" onClick={()=>setStage("carcass")}>Ver carcaça exigida</Button></div>
          <div className="rounded-xl border border-amber-200 bg-white p-3"><strong className="text-amber-900">Se não ou se houver dúvida → conferir com o forno</strong><p className="mt-2 text-sm">Não inicie com esta ferramenta. O responsável deve verificar o aquecimento e definir se ela precisa voltar ao forno. Você pode testar outra ordem na sequência.</p><Button className="mt-3" variant="outline" onClick={()=>{setSequenceOpen(true);setReason("Ferramenta aguardando conferência de aquecimento.");setPreview(null);}}>Testar outra posição</Button></div>
        </div><p className="mt-3 text-xs text-slate-600">Entrada prevista no forno: {date(item.toolHeatingStartAt)} · pronta na previsão: {date(item.calculatedToolReadyAt)} · espera da prensa: {minutes(item.thermalWaitMinutes)}.</p>
      </> : stage==="press" ? <>
        <h4 className="font-bold">Horários previstos para {item.toolCode}</h4><p className="mt-2 text-sm">Preparação: {date(item.startAt)} · entrada em produção: {date(item.extrusionStartAt)} · saída: {date(item.endAt)}.</p><p className="mt-2 text-sm">{item.remainingKg.toLocaleString("pt-BR")} kg restantes, a {item.productivityKgH.toLocaleString("pt-BR")} kg/h: {minutes(item.theoreticalMinutes)} de produção líquida.</p><Button className="mt-3" variant="outline" onClick={()=>setSequenceOpen(true)}>Conferir a sequência e testar ajuste</Button>
      </> : <>
        <h4 className="font-bold">{stage==="carcass" ? `Carcaça exigida: ${item.carcassCode ?? "não informada"}` : `BO exigido: ${item.boCode ?? "não informado"}`}</h4>
        <p className="mt-2 text-sm">O cadastro do modelo não confirma que há uma peça livre. Confira as reservas antes de separar o recurso.</p>
        {resourceProblems.filter(c=>stage==="carcass"?c.type.includes("carcass"):c.type.includes("bo")).map(c=><p key={c.id} className="mt-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-950">{c.message}</p>)}
        <p className="mt-2 text-sm">Uso previsto: {date(item.startAt)} até {date(item.endAt)}. Se houver indisponibilidade, confira o cadastro e recalcule ou teste uma troca de posição.</p>
        <Button className="mt-3" variant="outline" onClick={()=>setStage(stage==="carcass"?"bo":"press")}>Próxima etapa <ArrowRight className="size-4"/></Button>
      </>}
    </section>
    {sequenceOpen && <section className="space-y-4 rounded-2xl border p-4">
      <h3 className="flex items-center gap-2 text-lg font-bold"><Clock3 className="size-5"/>Sequenciamento da prensa {machine}</h3>
      <p className="text-sm text-slate-600">A ordem dos cartões é a ordem de produção. Selecione um cartão para testar uma troca. Horários são previsões, não apontamentos reais.</p>
      <ol className="flex gap-3 overflow-x-auto pb-3">{items.map((row,index)=><li key={row.id} className="w-64 shrink-0"><button type="button" onClick={()=>choose(row.id)} aria-pressed={row.id===item.id} className={`h-full w-full rounded-xl border-2 p-3 text-left ${row.id===item.id?"border-blue-600 bg-blue-50":"border-slate-200 bg-white"}`}><span className="text-xs font-bold text-blue-700">POSIÇÃO {index+1}</span><strong className="mt-1 block">{row.toolCode}</strong><span className="block text-xs">Ordem {row.orderNumber}</span><span className="mt-3 block text-sm">Entrada: {date(row.extrusionStartAt)}</span><ArrowDown className="my-1 size-4 text-slate-400"/><span className="block text-sm">Saída: {date(row.endAt)}</span><span className="mt-2 block text-xs">{minutes(row.theoreticalMinutes)} · {row.productivityKgH.toLocaleString("pt-BR")} kg/h</span>{row.resourceConflicts.some(c=>c.severity==="blocking")&&<span className="mt-2 block text-xs font-semibold text-red-700">Tem impedimento: confira antes de iniciar</span>}</button></li>)}</ol>
      <div className="rounded-xl bg-slate-50 p-4"><h4 className="font-bold">Ajustar {item.toolCode}, atualmente na posição {itemIndex+1}</h4>
        {!canAdjust && <p className="mt-2 text-sm">Seu acesso permite consultar. Peça ao PCP para aplicar uma mudança.</p>}
        <div className="mt-3 grid gap-3 sm:grid-cols-[150px_1fr]"><label className="text-sm">Nova posição<input className={field} type="number" min={1} max={items.length} value={position} onChange={e=>{setPosition(Number(e.target.value));setPreview(null);}}/></label><label className="text-sm">Motivo da troca (obrigatório)<textarea className={field} maxLength={1000} rows={2} value={reason} placeholder="Ex.: ferramenta aguardando liberação do forno" onChange={e=>{setReason(e.target.value);setPreview(null);}}/></label></div>
        <Button className="mt-3" variant="outline" onClick={test}>Calcular impacto antes de aplicar</Button>
        {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {preview&&changedItem&&<div className="mt-4 rounded-xl border border-blue-200 bg-white p-4"><h4 className="font-bold">Resultado da troca</h4><p className="mt-2 text-sm">Entrada desta ordem: {date(item.extrusionStartAt)} → {date(changedItem.extrusionStartAt)}.</p><p className="mt-2 text-sm">Espera térmica total: {minutes(current.evaluation.metrics.thermalMinutes)} → {minutes(preview.evaluation.metrics.thermalMinutes)}. Atraso total: {minutes(current.evaluation.metrics.lateMinutes)} → {minutes(preview.evaluation.metrics.lateMinutes)}.</p><p className="mt-2 text-sm">Impedimentos: {current.evaluation.hardViolations} → {preview.evaluation.hardViolations}. Dados a confirmar: {preview.evaluation.missingData.length}.</p><p className="mt-2 text-xs text-slate-600">Todas as ordens foram recalculadas na própria prensa. A troca não remove impedimentos nem libera aquecimento.</p><Button className="mt-3" disabled={!canAdjust} onClick={()=>onApply(preview)}>Aplicar à simulação com este motivo</Button></div>}
        <p className="mt-3 text-xs text-slate-600">O motivo acompanha a mudança nesta sessão. Salve o cenário para guardar esse registro no histórico. Ordens já iniciadas não podem ser movidas.</p>
      </div>
    </section>}
  </div>;
}
