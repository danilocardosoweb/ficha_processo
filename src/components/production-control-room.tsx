"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { AgentWorkspaceCanvas } from "@/components/agent-workspace-canvas";
import { useControlRoomWindow } from "@/components/use-control-room-window";
import { PlanningOverview } from "@/components/planning-overview";
import { AgentDecisionHistory } from "@/components/agent-decision-history";
import { ClipboardList, Users, Wrench, Factory, ClipboardCheck, Expand } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from "@/components/ui/dialog";
import { OperationalFlow } from "@/components/operational-flow";
import { AgentProviderPicker, AgentRoundProgress, PlanningAgentTeam, usePlanningAgentTeam } from "@/components/planning-agent-team";
import type { AgentRole } from "@/modules/planning/agents/contracts";
import { overviewFlags } from "@/modules/planning/decision-system/overview";
import type { DecisionCandidate, DecisionContext } from "@/modules/planning/decision-system/optimizer";
import type { DecisionProfile } from "@/modules/planning/decision-system/schema";

type Props = { context: DecisionContext; profile: DecisionProfile; current: DecisionCandidate; canAdjust: boolean; onApply: (candidate: DecisionCandidate) => void };
const date = (value: Date) => value.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const roles = [
  { name: "PCP", task: "Planejar a carga", icon: ClipboardList, route: "/planejamento", action: "Abrir planejamento", steps: ["Confira a ordem, a prensa e o prazo do pedido.", "Teste uma troca se houver atraso ou impedimento.", "Compare os novos horários antes de aplicar na simulação."] },
  { name: "Líder de produção", task: "Coordenar as prioridades", icon: Users, route: "/prensas", action: "Abrir prensas", steps: ["Confira as pendências com o montador e o operador.", "Se houver imprevisto, combine uma nova prioridade.", "Teste a troca e registre o motivo antes de aplicar."] },
  { name: "Montador", task: "Preparar ferramenta e acessórios", icon: Wrench, route: "/forno", action: "Abrir forno", steps: ["Confira a ferramenta física, a carcaça e o BO exigidos.", "Verifique estoque, reservas e condições de uso; cadastro não significa peça livre.", "Registre a preparação no forno e siga o procedimento de liberação da fábrica."] },
  { name: "Operador da prensa", task: "Conferir antes de produzir", icon: Factory, route: "/producao", action: "Abrir produção", steps: ["Confira a ordem que será produzida com o líder.", "Confirme a liberação da ferramenta e dos acessórios; previsão não substitui conferência.", "Registre início ou parada na tela de produção. Não inicie com impedimento pendente."] },
  { name: "Apontamento / Qualidade", task: "Registrar e conferir o resultado", icon: ClipboardCheck, route: "/qualidade", action: "Abrir qualidade", steps: ["Registre quantidade produzida, perdas e motivo das ocorrências em Produção.", "Faça as verificações de qualidade conforme o procedimento da fábrica.", "Confira as pendências antes de encerrar. Apontamento não equivale a aprovação de qualidade."] },
] as const;

export function ProductionControlRoom(props:Props) {
  const team=usePlanningAgentTeam(props);const popup=useControlRoomWindow();
  const panelRoles:AgentRole[]=["pcp","lider","montador","operador","qualidade"];
  const items=props.current.simulation.machines.flatMap(m=>m.items);
  const [selected,setSelected]=useState("");const [role,setRole]=useState(0);const [search,setSearch]=useState("");const [wide,updateWide]=useState(false);const [detail,setDetail]=useState(false);
  const setWide=(value:boolean)=>{if(popup.container){void popup.expand();return;}updateWide(value);};
  const focus=items.find(i=>i.id===selected)??items[0];
  const counts=[items.filter(i=>overviewFlags(i).late).length+" atrasos previstos",items.filter(i=>overviewFlags(i).blocked).length+" impedimentos na simulação",items.filter(i=>i.toolHeatingState!=="released").length+" preparações a conferir",items.filter(i=>i.status==="in_progress").length+" ordens registradas em produção","Qualidade: medições não consultadas"];
  const matching=items.filter(i=>(i.toolCode+" "+i.orderNumber).toLowerCase().includes(search.toLowerCase()));
  const content=<div className="space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase text-violet-700">Workspace v3 · execução supervisionada</p><h3 className="text-2xl font-bold">Sala de controle</h3><p className="text-sm text-slate-600">Programação → preparação → execução → conferência. A IA propõe; você decide.</p></div><div className="flex gap-2">{popup.container?<Button variant="outline" onClick={popup.close}>Voltar à aba principal</Button>:<Button variant="outline" onClick={popup.open}>Abrir janela exclusiva</Button>}<Button variant="outline" onClick={()=>setWide(!wide)}><Expand className="size-4"/>Tela ampla</Button></div></header>
    {popup.error&&<p role="alert">{popup.error}</p>}
    {popup.container&&<p className="text-xs text-slate-600">Mantenha a aba principal aberta para preservar a rodada. Fechar esta janela retorna à aba, sem iniciar produção.</p>}
    <AgentProviderPicker team={team}/>
    <div className="sticky top-0 z-20 space-y-2 rounded-xl bg-slate-100 py-2">
      <div className="flex flex-wrap gap-2"><Button disabled={team.busy||team.testing||!items.length} onClick={()=>void team.start()}>Iniciar equipe · 5 agentes</Button><Button variant="outline" disabled={team.busy||team.testing||!items.length} onClick={()=>void team.start(panelRoles[role])}>Testar somente {roles[role].name}</Button>{team.busy&&<Button variant="outline" onClick={team.cancel}>Interromper rodada</Button>}</div>
      <AgentRoundProgress team={team}/>
      {team.error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{team.error}</p>}
    </div>
    <AgentWorkspaceCanvas panes={[...roles.map((entry,index)=>{const agent=team.progress[panelRoles[index]];return {title:entry.name,status:counts[index],active:role===index,onSelect:()=>setRole(index),content:<><p className={`text-sm font-semibold ${agent.state==="failed"?"text-red-700":agent.state==="completed"?"text-emerald-700":"text-violet-700"}`}>{agent.message}</p>{agent.report&&<p className="line-clamp-3 text-sm">{agent.report.findings.summary}</p>}<p className="text-xs text-slate-500">{entry.task}</p></>};}),{title:"Programação · ordem em foco",status:items.length+" ordens na simulação",content:<><label className="block text-xs">Buscar ordem<input value={search} onChange={e=>setSearch(e.target.value)} className="mt-1 w-full rounded-lg border p-2" placeholder="Ferramenta ou ordem"/></label>{matching.map(item=><button key={item.id} aria-pressed={focus?.id===item.id} onClick={()=>setSelected(item.id)} className={`block w-full rounded-lg border p-2 text-left text-xs ${focus?.id===item.id?"border-violet-500 bg-violet-50":"bg-slate-50"}`}><strong>{item.toolCode} · prensa {item.machineCode}</strong><span className="block">{date(item.extrusionStartAt)} → {date(item.endAt)}</span><span className="block">{overviewFlags(item).blocked?"Impedimento na simulação":"Conferir liberação física"}</span></button>)}{!matching.length&&<p>Nenhuma ordem encontrada.</p>}</>}]}/>
    <div className="rounded-xl border bg-white p-3 text-sm">{focus?<><strong>Ordem em foco: {focus.toolCode} · {focus.orderNumber}</strong><p>Carcaça: {focus.carcassCode??"não informada"} · BO: {focus.boCode??"não informado"} · previsão não autoriza operação.</p><Button variant="outline" size="sm" onClick={()=>setDetail(true)}>Conferir recursos / simular troca</Button></>:<p>Carregue uma programação para analisar.</p>}</div>
    <PlanningAgentTeam {...props} team={team} role={panelRoles[role]}/>
    {detail&&<section aria-label="Conferir ordem" className="rounded-xl border bg-white p-4"><div className="flex items-center justify-between"><h4 className="font-bold">Conferir ordem · simulação, não autorização</h4><Button variant="outline" onClick={()=>setDetail(false)}>Fechar conferência</Button></div>{focus&&<OperationalFlow {...props} initialOrderId={focus.id} onApply={candidate=>{props.onApply(candidate);setDetail(false);}}/>}</section>}
    <details className="rounded-xl border bg-white p-3"><summary className="cursor-pointer font-semibold">Ver programação completa e previsões</summary><div className="mt-3"><PlanningOverview {...props} selectedOrderId={selected} onSelectOrder={setSelected}/></div></details>
    <details className="rounded-xl border bg-white p-3"><summary className="cursor-pointer font-semibold">Memória de decisões</summary><div className="mt-3"><AgentDecisionHistory/></div></details>
    <details className="rounded-xl border bg-white p-3"><summary className="cursor-pointer font-semibold">Guia operacional · não é parecer da IA</summary><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">{roles[role].steps.map(step=><li key={step}>{step}</li>)}</ol><a href={roles[role].route} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-sm underline">{roles[role].action}</a></details>
  </div>;
  const display=wide?<Dialog open onOpenChange={setWide}><DialogContent showCloseButton={false} className="max-h-[96dvh] overflow-auto sm:max-w-[98vw]"><DialogTitle className="sr-only">Sala de controle</DialogTitle><DialogDescription className="sr-only">Equipe e processos operacionais.</DialogDescription>{content}<DialogClose>Reduzir</DialogClose></DialogContent></Dialog>:content;
  return <>{popup.container?<><p className="rounded-xl border p-4">Sala aberta em janela exclusiva. Mantenha esta aba aberta. <Button variant="outline" onClick={popup.open}>Mostrar janela</Button> <Button variant="outline" onClick={popup.close}>Trazer de volta</Button></p>{createPortal(content,popup.container)}</>:display}</>;
}
