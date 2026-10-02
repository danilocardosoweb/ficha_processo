"use client";
import { useState } from "react";
import { ChevronLeft, ChevronRight, Expand, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { OperationalFlow } from "@/components/operational-flow";
import { intervalOnWindow, overviewFlags, resourceHotspots } from "@/modules/planning/decision-system/overview";
import type { DecisionCandidate, DecisionContext } from "@/modules/planning/decision-system/optimizer";
import type { DecisionProfile } from "@/modules/planning/decision-system/schema";
const date=(value:number)=>new Date(value).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
const duration=(minutes:number)=>{const n=Math.round(minutes);return `${Math.floor(n/60)}h ${n%60}min`;};
type Props={context:DecisionContext;profile:DecisionProfile;current:DecisionCandidate;canAdjust:boolean;onApply:(candidate:DecisionCandidate)=>void;selectedOrderId?:string;onSelectOrder?:(id:string)=>void};
export function PlanningOverview(props:Props) {
  const {current,context}=props;
  const items=current.simulation.machines.flatMap(m=>m.items);
  const [hours,setHours]=useState(0);
  const [offset,setOffset]=useState(0);
  const [localSelected,setLocalSelected]=useState("");
  const selected=props.selectedOrderId ?? localSelected;
  const setSelected=(id:string)=>{setLocalSelected(id);props.onSelectOrder?.(id);};
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState("all");
  const [resource,setResource]=useState("");
  const [details,setDetails]=useState(false);
  const [wide,setWide]=useState(false);
  const beginning=context.start.getTime();
  const end=Math.max(beginning+3600000,...items.map(i=>i.endAt.getTime()));
  const span=hours?Math.min(hours*3600000,end-beginning):end-beginning;
  const from=Math.max(beginning,Math.min(beginning+offset,end-span));
  const to=from+span;
  const focus=items.find(i=>i.id===selected);
  const hotspots=resourceHotspots(items);
  const matches=(item:typeof items[number])=>{
    const flags=overviewFlags(item);
    return (filter==="all" || flags[filter as keyof typeof flags]) &&
      (!resource || item.resourceConflicts.some(c=>c.severity==="blocking"&&c.resourceCode===resource)) &&
      `${item.toolCode} ${item.orderNumber} ${item.machineCode}`.toLowerCase().includes(query.trim().toLowerCase());
  };
  const found=items.filter(matches).sort((a,b)=>a.startAt.getTime()-b.startAt.getTime());
  function locate(item:typeof items[number]) {setSelected(item.id);if(hours)setOffset(Math.max(0,item.startAt.getTime()-beginning-span/4));}
  const body=<div className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="text-xl font-bold text-slate-950">Visão geral da programação</h3><p className="text-sm text-slate-600">Todas as prensas no mesmo relógio. Veja o conjunto primeiro; selecione uma ordem para conferir ou ajustar.</p></div>
      <Button variant="outline" onClick={()=>setWide(!wide)}><Expand className="size-4"/>{wide?"Sair da tela ampla":"Tela ampla"}</Button>
    </header>
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{[
      ["all","Ordens na carga",items.length],["blocked","Com impedimento",items.filter(i=>overviewFlags(i).blocked).length],
      ["late","Com atraso",items.filter(i=>overviewFlags(i).late).length],["thermal","Com espera térmica",items.filter(i=>overviewFlags(i).thermal).length],
    ].map(([key,label,count])=><button key={key} onClick={()=>{setFilter(String(key));setResource("");}} aria-pressed={filter===key} className={`rounded-xl border p-3 text-left ${filter===key?"border-blue-600 bg-blue-50":"bg-white"}`}><span className="block text-xs text-slate-600">{label}</span><strong className="text-xl">{count}</strong></button>)}</div>
    <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-slate-50 p-3">
      <span className="text-xs font-semibold">Período:</span>{[0,24,8].map(value=><Button key={value} size="sm" variant={hours===value?"default":"outline"} onClick={()=>{setHours(value);setOffset(0);}}>{value?`${value} horas`:"Toda a carga"}</Button>)}
      <Button size="sm" variant="outline" aria-label="Período anterior" disabled={!hours||from<=beginning} onClick={()=>setOffset(Math.max(0,from-beginning-span))}><ChevronLeft className="size-4"/></Button>
      <Button size="sm" variant="outline" aria-label="Próximo período" disabled={!hours||to>=end} onClick={()=>setOffset(Math.min(end-beginning-span,from-beginning+span))}><ChevronRight className="size-4"/></Button>
      <span className="text-xs text-slate-600">{date(from)} até {date(to)}</span>
    </div>
    <div className="overflow-x-auto rounded-xl border"><div className="min-w-[700px]">
      <div className="flex border-b bg-slate-50"><div className="w-36 shrink-0 p-3 text-xs font-bold">Prensas / previsão</div><div className="relative mr-4 h-12 flex-1">{Array.from({length:5},(_,index)=><span key={index} className="absolute top-3 whitespace-nowrap text-[10px] text-slate-500" style={{left:`${index*25}%`,transform:index===4?"translateX(-100%)":index===0?"none":"translateX(-50%)"}}>{date(from+span*index/4)}</span>)}</div></div>
      {current.simulation.machines.map(machine=><div className="flex border-b last:border-b-0" key={machine.machineCode}>
        <div className="w-36 shrink-0 bg-slate-50 p-3"><strong className="block text-sm">Prensa {machine.machineCode}</strong><span className="block text-xs text-slate-600">{machine.items.length} ordens</span><span className="mt-2 block text-[10px] text-slate-600">Fim: {machine.endsAt?date(machine.endsAt.getTime()):"sem carga"}</span></div>
        <div className="relative mr-4 min-h-28 flex-1 bg-white">
          {Array.from({length:5},(_,index)=><div key={index} className="pointer-events-none absolute inset-y-0 border-l border-slate-100" style={{left:`${index*25}%`}}/>)}
          {machine.items.map(item=>{const range=intervalOnWindow(item.startAt.getTime(),item.endAt.getTime(),from,to);if(!range)return null;const flags=overviewFlags(item);
            return <button key={item.id} type="button" title={`${item.toolCode} · ${date(item.startAt.getTime())} → ${date(item.endAt.getTime())}`} aria-label={`Prensa ${machine.machineCode}, ${item.toolCode}, ordem ${item.orderNumber}, ${flags.blocked?"com impedimento":flags.late?"com atraso":"prevista"}`} onClick={()=>setSelected(item.id)} className={`absolute top-5 h-12 overflow-hidden rounded border text-left text-[10px] font-bold text-white focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-blue-950 ${flags.blocked?"border-red-800 bg-red-600":flags.late?"border-orange-700 bg-orange-500":flags.thermal?"border-amber-600 bg-amber-500":"border-blue-800 bg-blue-600"} ${selected===item.id?"z-10 ring-2 ring-slate-950 ring-offset-2":""}`} style={{left:`${range.left}%`,width:`${range.width}%`,minWidth:2,opacity:matches(item)?1:0.18}}><span className="whitespace-nowrap px-1">{item.toolCode}</span>{flags.late&&<span className="absolute inset-x-0 bottom-0 h-1 bg-orange-300"/>}</button>;
          })}
          <span className="absolute bottom-2 left-1 text-[10px] text-slate-500">Intervalo de preparação até saída, incluindo eventuais pausas de calendário</span>
        </div>
      </div>)}
    </div></div>
    <p className="text-xs text-slate-600">Vermelho: impedimento · laranja: atraso · amarelo: espera térmica · azul: previsão sem esses alertas. Faixa laranja na barra vermelha: também há atraso. Azul não significa autorização. Espaços vazios não provam capacidade livre.</p>
    <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold">Recursos que mais afetam ordens:</span>{hotspots.slice(0,6).map(row=><button key={row.resource} aria-pressed={resource===row.resource} onClick={()=>setResource(resource===row.resource?"":row.resource)} className={`rounded-full border px-3 py-1.5 text-xs ${resource===row.resource?"bg-slate-900 text-white":"bg-white"}`}>{row.resource} · {row.ids.length}</button>)}{(resource||filter!=="all"||query)&&<Button size="sm" variant="ghost" onClick={()=>{setResource("");setFilter("all");setQuery("");}}>Limpar filtros</Button>}</div>
    {focus?<div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-blue-600 bg-blue-50 p-4"><div><strong>{focus.toolCode} · prensa {focus.machineCode} · ordem {focus.orderNumber}</strong><p className="mt-1 text-sm">Entrada em produção: {date(focus.extrusionStartAt.getTime())} · saída: {date(focus.endAt.getTime())}</p><p className="text-xs">Produção líquida: {duration(focus.theoreticalMinutes)} · espera térmica: {duration(focus.thermalWaitMinutes)} · espera de recursos: {duration(focus.resourceWaitMinutes)}</p></div><Button onClick={()=>setDetails(true)}>Conferir ordem / testar troca</Button></div>:<p className="rounded-xl border border-dashed p-3 text-sm text-slate-600">Selecione uma barra ou uma linha abaixo. Para ordens muito curtas, use a lista ou aproxime para 8 horas.</p>}
    <div className="rounded-xl border"><div className="flex flex-wrap items-center justify-between gap-2 border-b p-3"><strong className="text-sm">Ordens em foco ({found.length} de {items.length})</strong><label className="flex items-center gap-2 text-sm"><Search className="size-4"/><input aria-label="Buscar ferramenta ou ordem" placeholder="Ferramenta ou ordem..." value={query} onChange={e=>setQuery(e.target.value)} className="rounded-lg border px-3 py-2"/></label></div>
      <div className="max-h-64 overflow-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="sticky top-0 bg-slate-100"><tr>{["Prensa","Ferramenta / ordem","Entrada prevista","Saída prevista","Atenção",""].map((label,i)=><th className="p-2" key={i}>{label}</th>)}</tr></thead><tbody>{found.map(item=>{const f=overviewFlags(item);return <tr key={item.id} className={`border-t ${selected===item.id?"bg-blue-50":""}`}><td className="p-2">{item.machineCode}</td><td className="p-2"><strong>{item.toolCode}</strong><span className="block text-slate-500">{item.orderNumber}</span></td><td className="p-2">{date(item.extrusionStartAt.getTime())}</td><td className="p-2">{date(item.endAt.getTime())}</td><td className="p-2">{[f.blocked?"Impedimento":"",f.late?"Atraso":"",f.thermal?"Espera térmica":""].filter(Boolean).join(" · ")||"Previsão"}</td><td className="p-2"><Button size="sm" variant="outline" onClick={()=>locate(item)}>Localizar</Button></td></tr>;})}</tbody></table>{!found.length&&<p className="p-4 text-sm">Nenhuma ordem atende a esses filtros.</p>}</div>
    </div>
    <p className="text-xs text-slate-500">Filtros destacam as barras sem esconder a programação das outras prensas. A lista usa toda a carga, mesmo fora do período aproximado. A simulação continua sujeita aos dados cadastrados.</p>
  </div>;
  return <>
    {wide?<Dialog open onOpenChange={setWide}><DialogContent showCloseButton={false} className="h-[94dvh] overflow-y-auto sm:max-w-[96vw]"><DialogTitle className="sr-only">Programação em tela ampla</DialogTitle><DialogDescription className="sr-only">Linha do tempo das prensas e ordens.</DialogDescription>{body}<DialogClose className="rounded-lg border p-2">Voltar à página</DialogClose></DialogContent></Dialog>:body}
    <Dialog open={details} onOpenChange={setDetails}><DialogContent showCloseButton={false} className="max-h-[92dvh] overflow-y-auto sm:max-w-[90vw]"><DialogTitle>Conferir ordem e testar mudança</DialogTitle><DialogDescription>Ao fechar, você volta à visão geral. Alterações só entram na simulação após calcular e aplicar.</DialogDescription>{focus&&<OperationalFlow key={focus.id} {...props} initialOrderId={focus.id} onApply={candidate=>{props.onApply(candidate);setDetails(false);}}/>}<DialogClose className="rounded-lg border p-2">Voltar à visão geral</DialogClose></DialogContent></Dialog>
  </>;
}
