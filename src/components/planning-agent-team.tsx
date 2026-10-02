"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { agentNames, agentRoles, type AgentEvent, type AgentReport, type AgentRole, type AgentFindings } from "@/modules/planning/agents/contracts";
import { runCandidate, type DecisionCandidate, type DecisionContext } from "@/modules/planning/decision-system/optimizer";
import type { DecisionProfile } from "@/modules/planning/decision-system/schema";
import { movePlannedOrder } from "@/modules/planning/decision-system/sequence-change";
import type { AgentProvider } from "@/modules/planning/agents/provider";
import { AgentDecisionActions, reviewLabels } from "@/components/agent-decision-history";
import type { FreeModel } from "@/modules/planning/agents/catalog";

type Props={context:DecisionContext;profile:DecisionProfile;canAdjust:boolean;onApply:(candidate:DecisionCandidate)=>void};
type Progress={state:"waiting"|"running"|"completed"|"failed";message:string;report?:AgentReport};
const initial=()=>Object.fromEntries(agentRoles.map(role=>[role,{state:"waiting",message:"Aguardando início da rodada"}])) as Record<AgentRole,Progress>;
export function usePlanningAgentTeam(props:Props) {
  const [progress,setProgress]=useState(initial);
  const [busy,setBusy]=useState(false);
  const [instruction,setInstruction]=useState("");
  const [startedAt,setStartedAt]=useState("");
  const [error,setError]=useState("");
  const [provider,setProvider]=useState<AgentProvider>("openrouter");
  const [localModel,setLocalModel]=useState("");
  const [models,setModels]=useState<string[]>([]);
  const [connection,setConnection]=useState("");
  const [connecting,setConnecting]=useState(false);
  const [cloudModel,setCloudModel]=useState("");
  const [freeModels,setFreeModels]=useState<FreeModel[]>([]);
  const [testing,setTesting]=useState(false);
  const [probe,setProbe]=useState("");
  const [elapsed,setElapsed]=useState(0);
  const [targetCount,setTargetCount]=useState(5);
  const [activity,setActivity]=useState<string[]>([]);
  const began=useRef(0);
  useEffect(()=>{if(!busy&&!testing)return;const timer=setInterval(()=>setElapsed(Math.floor((Date.now()-began.current)/1000)),1000);return()=>clearInterval(timer);},[busy,testing]);
  const [decisions,setDecisions]=useState<Record<string,string>>({});
  const [preview,setPreview]=useState<{key:string;candidate:DecisionCandidate}|null>(null);
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  async function start(only?:AgentRole) {
    if(controller.current) return;
    if(provider==="lmstudio"&&!localModel.trim()){setError("Selecione ou informe o modelo do LM Studio antes de iniciar.");return;}
    if(provider==="openrouter"&&!cloudModel){setError("Carregue o catálogo e escolha um modelo gratuito antes de iniciar.");return;}
    if((provider==="openai"||provider==="openclaw")&&!cloudModel.trim()){setError("Informe o modelo do provedor antes de iniciar.");return;}
    began.current=Date.now();setElapsed(0);setActivity([]);setTargetCount(only?1:5);
    const abort=new AbortController();controller.current=abort;
    setBusy(true);setError("");setPreview(null);setDecisions({});setProgress(initial());setStartedAt(new Date().toLocaleString("pt-BR"));
    const peers:Array<{role:AgentRole;findings:AgentFindings}>=[];
    const failures:string[]=[];
    let consecutiveFailures=0;
    try {
      for(const role of only?[only]:agentRoles) {
        if(abort.signal.aborted) break;
        setProgress(old=>({...old,[role]:{state:"running",message:"Conectando à IA..."}}));
        let completed=false;
        try {
          const response=await fetch("/api/planning-agents",{method:"POST",headers:{"Content-Type":"application/json"},signal:abort.signal,body:JSON.stringify({provider,localModel,cloudModel,role,context:props.context,profile:props.profile,peers,instruction:`${instruction.slice(0,650)}\nPareceres indisponíveis nesta rodada: ${failures.join(", ")||"nenhum"}.`})});
          if(response.redirected) throw new Error("Sua sessão precisa ser renovada. Entre novamente antes de iniciar a equipe.");
          if(!response.ok) {const body=await response.json().catch(()=>({}));throw new Error(body.error??"Não foi possível iniciar o agente.");}
          if(!response.headers.get("content-type")?.includes("application/x-ndjson")) throw new Error("O servidor não retornou a análise esperada. Atualize a página e entre novamente.");
          if(!response.body) throw new Error("A conexão não trouxe o resultado do agente.");
          const reader=response.body.getReader();const decoder=new TextDecoder();let buffer="";
          const receive=(line:string)=>{
            if(!line.trim())return;
            const event=JSON.parse(line) as AgentEvent;
            if(event.type==="activity")setActivity(old=>[...old,`${agentNames[role]} · ${event.message}`].slice(-40));
            if(event.type==="error")throw new Error(event.message);
            if(event.type==="activity")setProgress(old=>({...old,[role]:{state:"running",message:event.message}}));
            if(event.type==="complete") {completed=true;peers.push({role,findings:event.report.findings});setProgress(old=>({...old,[role]:{state:"completed",message:"Parecer concluído",report:event.report}}));}
          };
          try {while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split("\n");buffer=lines.pop()??"";for(const line of lines)receive(line);}buffer+=decoder.decode();receive(buffer);} finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
          if(!completed)throw new Error("A conexão terminou antes da conclusão. Nenhuma proposta foi aplicada.");
          consecutiveFailures=0;
        } catch(cause) {
          if(abort.signal.aborted) break;
          failures.push(agentNames[role]);
          setProgress(old=>({...old,[role]:{state:"failed",message:cause instanceof Error?cause.message:"Falha na análise"}}));
          consecutiveFailures++;
          if(cause instanceof Error && /memória insuficiente|contexto insuficiente|modelo não encontrado|recusou o uso de ferramentas|autenticação|sessão precisa/i.test(cause.message)){setError(cause.message+" A rodada foi interrompida antes dos próximos agentes.");break;}
          if(consecutiveFailures>=2){setError("Rodada interrompida após duas falhas consecutivas. Confira o provedor antes de tentar novamente. Nenhuma operação foi aplicada.");break;}
        }
      }
    } finally {
      setProgress(old=>Object.fromEntries(Object.entries(old).map(([role,p])=>[role,only&&role!==only?{state:"waiting",message:"Não incluído neste teste individual"}:p.state==="running"||p.state==="waiting"?{state:"waiting",message:"Rodada interrompida; agente não concluiu"}:p])) as Record<AgentRole,Progress>);
      controller.current=null;setBusy(false);
    }
  }
  function test(key:string,proposal:AgentFindings["proposals"][number]) {
    try {
      if(!proposal.move)return;
      const change=movePlannedOrder(props.context.orders,proposal.move.orderId,proposal.move.position,proposal.move.reason);
      const candidate=runCandidate(props.context,props.profile,change.orders,"Proposta da equipe IA");candidate.sequenceChange=change.change;
      setPreview({key,candidate});setError("");
    }catch(cause){setError(cause instanceof Error?cause.message:"Não foi possível testar a proposta.");setPreview(null);}
  }
  function resetProviderResults(){setProgress(initial());setStartedAt("");setPreview(null);setDecisions({});setError("");}
  async function loadFreeModels(){
    setConnecting(true);setConnection("Consultando catálogo gratuito...");
    try{const response=await fetch("/api/planning-agents/provider-check",{cache:"no-store"});if(response.redirected)throw new Error("Entre novamente.");const body=await response.json();if(!response.ok)throw new Error(body.error);setFreeModels(body.models);setConnection(`${body.models.length} modelos com preço de entrada/saída zero e suporte declarado a ferramentas. Disponibilidade e limites variam.`);}
    catch(cause){setConnection(cause instanceof Error?cause.message:"Catálogo indisponível.");}finally{setConnecting(false);}
  }
  async function checkProvider(){
    if(controller.current)return;
    const model=provider==="lmstudio"?localModel:cloudModel;
    if(!model){setProbe("Selecione um modelo primeiro.");return;}
    const abort=new AbortController();controller.current=abort;
    setTesting(true);setProbe("Enviando teste sintético de ferramenta...");began.current=Date.now();setElapsed(0);
    try{const response=await fetch("/api/planning-agents/provider-check",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({provider,model}),signal:abort.signal});if(response.redirected)throw new Error("Entre novamente.");const body=await response.json();if(!response.ok)throw new Error(body.error);setProbe(`${body.model} · ${(body.durationMs/1000).toFixed(1)} s · ${body.message}`);}
    catch(cause){setProbe(abort.signal.aborted?"Teste interrompido.":cause instanceof Error?cause.message:"Teste falhou.");}finally{controller.current=null;setTesting(false);}
  }
  async function connectLocal(){
    setConnecting(true);setConnection("Consultando o servidor local...");
    try {
      const response=await fetch("/api/planning-agents/local-models",{cache:"no-store"});
      if(response.redirected)throw new Error("Entre novamente no aplicativo para testar a conexão.");
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"Não foi possível conectar.");
      setModels(body.models);setConnection(`${body.baseUrl} · ${body.message}`);
    }catch(cause){setModels([]);setConnection(cause instanceof Error?cause.message:"Falha na conexão.");}
    finally{setConnecting(false);}
  }
  return {cloudModel,freeModels,loadFreeModels,testing,probe,checkProvider,elapsed,targetCount,activity,changeCloudModel:(value:string)=>{setCloudModel(value);setProbe("");resetProviderResults();},progress,busy,instruction,setInstruction,startedAt,error,decisions,setDecisions,preview,setPreview,start,cancel:()=>controller.current?.abort(),test,provider,localModel,models,connection,connecting,connectLocal,changeProvider:(value:AgentProvider)=>{setProvider(value);setProbe("");setConnection("");resetProviderResults();},changeLocalModel:(value:string)=>{setLocalModel(value);setProbe("");resetProviderResults();}};
}
export function AgentProviderPicker({team}:{team:ReturnType<typeof usePlanningAgentTeam>}) {
  const locked=team.busy||team.testing;
  return <section className="space-y-3 rounded-xl border bg-white p-4">
    <h4 className="font-bold">Conexão e modelo dos agentes</h4>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-sm">Provedor<select disabled={locked} value={team.provider} onChange={e=>team.changeProvider(e.target.value as AgentProvider)} className="mt-1 block rounded-lg border p-2"><option value="openrouter">OpenRouter · modelos gratuitos</option><option value="lmstudio">LM Studio · local</option><option value="openai">OpenAI API</option><option value="openclaw">OpenClaw</option></select></label>
      {team.provider==="openrouter"?<><label className="min-w-0 flex-1 text-sm">Modelo gratuito<select disabled={locked} value={team.cloudModel} onChange={e=>team.changeCloudModel(e.target.value)} className="mt-1 block w-full max-w-xl rounded-lg border p-2"><option value="">Carregue o catálogo e escolha...</option>{team.freeModels.map(m=><option key={m.id} value={m.id}>{m.name} · {Math.round(m.contextLength/1000)}k contexto</option>)}</select></label><Button variant="outline" disabled={locked||team.connecting} onClick={()=>void team.loadFreeModels()}>Atualizar modelos gratuitos</Button></>:team.provider==="lmstudio"?<><label className="min-w-0 flex-1 text-sm">Modelo local<input disabled={locked} list="lm-studio-models" value={team.localModel} onChange={e=>team.changeLocalModel(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" placeholder="Identificador completo do modelo"/><datalist id="lm-studio-models">{team.models.map(m=><option key={m} value={m}/>)}</datalist></label><Button variant="outline" disabled={locked||team.connecting} onClick={()=>void team.connectLocal()}>Listar modelos locais</Button></>:<label className="min-w-0 flex-1 text-sm">Modelo configurado<input disabled={locked} value={team.cloudModel} onChange={e=>team.changeCloudModel(e.target.value)} className="mt-1 block w-full rounded-lg border p-2" placeholder="Identificador do modelo"/></label>}
      <Button disabled={locked||team.connecting} onClick={()=>void team.checkProvider()}>Testar conexão e ferramentas</Button>
      {team.testing&&<Button variant="outline" onClick={team.cancel}>Cancelar teste · {team.elapsed}s</Button>}
    </div>
    {team.connection&&<p className="text-xs text-slate-600">{team.connection}</p>}
    {team.probe&&<p role="status" className="rounded-lg bg-blue-50 p-3 text-sm">{team.probe}</p>}
    <p className="text-xs text-slate-600">Teste sem dados de produção. A chave e o endpoint ficam no servidor. O modo local usa o LM Studio acessível pelo servidor do app; provedores externos só funcionam quando a política de envio de dados permitir. As análises continuam sujeitas a aprovação humana.</p>
  </section>;
}
export function AgentRoundProgress({team}:{team:ReturnType<typeof usePlanningAgentTeam>}) {
  const completed=Object.values(team.progress).filter(p=>p.state==="completed").length;
  const failed=Object.values(team.progress).filter(p=>p.state==="failed").length;
  const active=agentRoles.find(role=>team.progress[role].state==="running");
  return <section className="space-y-2 rounded-xl border bg-white p-3" aria-label="Progresso da rodada">
    <div className="flex flex-wrap justify-between gap-2 text-sm"><strong>{team.busy?"Rodada em andamento":team.startedAt?"Rodada encerrada":"Pronto para iniciar"} · {completed}/{team.targetCount} pareceres concluídos</strong><span>{failed} falhas · {team.elapsed}s</span></div>
    <progress className="h-3 w-full accent-violet-600" aria-label="Pareceres concluídos, não estimativa de tempo" max={team.targetCount} value={completed}/>
    <p role="status" className="text-sm">{active?`${agentNames[active]}: ${team.progress[active].message}`:"Nenhuma operação de produção é executada pela rodada."}</p>
    <details><summary className="cursor-pointer text-xs">Atividade real das consultas</summary><ol className="mt-2 max-h-36 space-y-1 overflow-auto text-xs">{team.activity.map((line,i)=><li key={i}>{line}</li>)}</ol></details>
  </section>;
}
export function PlanningAgentTeam({team,role,...props}:Props&{team:ReturnType<typeof usePlanningAgentTeam>;role:AgentRole}) {
  const entry=team.progress[role];
  const report=entry.report;
  const before=team.preview?runCandidate(props.context,props.profile):null;
  return <section className="space-y-4 rounded-2xl border border-violet-300 bg-violet-50/60 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-lg font-bold">Equipe de IA · análise com ferramentas</h4><p className="text-sm text-slate-600">PCP → montador → operador → qualidade → líder. Cada agente usa sua skill e o líder reúne os pareceres disponíveis.</p></div><Button disabled={team.busy||!props.context.orders.length} onClick={()=>void team.start()}>{team.startedAt?"Analisar novamente com a equipe":"Analisar com a equipe"}</Button>{team.busy&&<Button variant="outline" onClick={team.cancel}>Interromper rodada</Button>}</div>
    <label className="block text-sm font-semibold">O que a equipe deve investigar?<input className="mt-1 w-full rounded-lg border bg-white p-2 font-normal" maxLength={650} disabled={team.busy} value={team.instruction} onChange={e=>team.setInstruction(e.target.value)} placeholder="Ex.: como reduzir a espera por ferramenta sem aumentar os atrasos?"/></label>
    <p className="text-xs text-slate-600">Ao iniciar, a cópia compacta da carga é enviada ao {team.provider==="lmstudio"?"LM Studio local":team.provider==="openai"?"modelo configurado da OpenAI":team.provider==="openclaw"?"servidor OpenClaw aprovado":"modelo gratuito selecionado no OpenRouter"}. Até 40 chamadas por rodada manual. Pareceres concluídos e motivos das decisões ficam no histórico pessoal do servidor local. Para manter uma sequência, ainda é necessário salvar o cenário. Não há monitoramento em segundo plano.</p>
    {team.startedAt&&<p className="text-xs">Rodada iniciada em {team.startedAt}. Mudar a carga invalida esta rodada. Enquanto analisa, você pode consultar os painéis.</p>}
    {team.error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{team.error}</p>}
    <div aria-live="polite" className="rounded-xl border bg-white p-4"><p className="font-bold">{agentNames[role]} · {entry.state==="completed"?"IA concluiu":entry.state==="running"?"IA trabalhando":entry.state==="failed"?"Análise não concluída":"Aguardando"}</p><p className="mt-1 text-sm">{entry.message}</p>
      {report&&<>{report.operationalRead&&<div className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm"><strong>Consulta operacional · {report.operationalRead.status==="available"?"respondida":report.operationalRead.status==="partial"?"parcial":"indisponível"}</strong><p>{new Date(report.operationalRead.queriedAt).toLocaleString("pt-BR")} · {report.operationalRead.productionCount} ordens · {report.operationalRead.cycleCount} ciclos</p><ul className="mt-2 list-disc pl-4">{report.operationalRead.limitations.map((line,i)=><li key={i}>{line}</li>)}</ul></div>}<p className="mt-3 whitespace-pre-line text-sm">{report.findings.summary}</p><p className="mt-2 text-xs text-slate-500">Modelo: {report.model} · skill {report.skillVersion} · {(report.durationMs/1000).toFixed(0)} segundos</p><p className="mt-2 text-sm"><strong>Para a equipe:</strong> {report.findings.handoff}</p>{report.findings.limitations.length>0&&<div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm"><strong>O que falta confirmar</strong><ul className="mt-2 list-disc space-y-1 pl-4">{report.findings.limitations.map((line,index)=><li key={index}>{line}</li>)}</ul></div>}</>}
    </div>
    {report?.findings.proposals.map((proposal,index)=>{
      const key=`${role}-${index}`;const decision=team.decisions[key];const preview=team.preview?.key===key?team.preview.candidate:null;
      return <article key={key} className="rounded-xl border bg-white p-4"><h5 className="font-bold">{proposal.title}</h5><p className="mt-2 text-sm">{proposal.explanation}</p><ol className="mt-3 list-decimal space-y-2 pl-5 text-sm">{proposal.steps.map((step,i)=><li key={i}>{step}</li>)}</ol><p className="mt-3 text-xs text-slate-500">Fontes consultadas: {proposal.evidence.join(", ")}. Orientação da IA, sujeita à conferência.</p>
        {preview&&before&&<div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm"><strong>Comparação calculada · antes → depois</strong><p>Atraso total: {Math.round(before.evaluation.metrics.lateMinutes)} → {Math.round(preview.evaluation.metrics.lateMinutes)} min</p><p>Espera térmica: {Math.round(before.evaluation.metrics.thermalMinutes)} → {Math.round(preview.evaluation.metrics.thermalMinutes)} min</p><p>Impedimentos: {before.evaluation.hardViolations} → {preview.evaluation.hardViolations}</p><p>Confirmações pendentes: {before.evaluation.missingData.length} → {preview.evaluation.missingData.length}</p><p className="mt-2">Apenas a simulação será alterada. Isso não libera recursos nem inicia produção. Depois, salve o cenário se quiser manter a sequência.</p>{!props.canAdjust&&<p>Seu perfil não pode aplicar sequências.</p>}</div>}
        {proposal.move&&<Button className="mt-3" variant="outline" disabled={team.busy||Boolean(decision)} onClick={()=>team.test(key,proposal)}>Recalcular e avaliar troca</Button>}
        <AgentDecisionActions key={report.archiveId ?? key} archiveId={report.archiveId} index={index} move={Boolean(proposal.move)} disabled={team.busy||Boolean(decision)} canApply={Boolean(preview)&&props.canAdjust} onDecision={choice=>{team.setDecisions(old=>({...old,[key]:reviewLabels[choice]}));if(choice==="simulation_requested"&&preview&&props.canAdjust)props.onApply(preview);team.setPreview(null);}}/>
        {decision&&<p role="status" className="mt-2 text-sm font-semibold text-violet-800">{decision}</p>}
      </article>;
    })}
    {report?.findings.proposals.length===0&&<p className="text-sm">Este agente não propôs alteração. Confira o parecer e as limitações acima.</p>}
  </section>;
}
