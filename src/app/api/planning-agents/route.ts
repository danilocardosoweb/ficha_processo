import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { sameRequestOrigin } from "@/modules/planning/agents/request-origin";
import { getCurrentUser, getSessionToken } from "@/lib/local-auth/server";
import { canAccess } from "@/lib/access-control";
import { createClient } from "@/lib/supabase/server";
import { agentRequestSchema, type AgentEvent } from "@/modules/planning/agents/contracts";
import { runAgent } from "@/modules/planning/agents/runner";
import { callAgentModel, resolveAgentProvider, prepareLocalModel } from "@/modules/planning/agents/provider";
import { loadOperationalSnapshot } from "@/modules/planning/agents/operations";
import { fetchFreeModels } from "@/modules/planning/agents/catalog";
import { createAgentJournal } from "@/modules/planning/agents/journal";

export const runtime="nodejs";
// Vercel Hobby allows no more than 300 seconds for a Serverless Function.
// Keeping this within the platform limit is required for production deploys.
export const maxDuration=300;
// Local-process guard for the initial, manually requested round. No background jobs.
const gates=new Map<string,{active:boolean;count:number;until:number}>();
export async function POST(request:Request) {
  if(!sameRequestOrigin(request)) return NextResponse.json({error:"Origem não permitida."},{status:403});
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Entre novamente para analisar com a equipe."},{status:401});
  if(!canAccess(user.role,"simulation")) return NextResponse.json({error:"Seu perfil não pode analisar esta carga."},{status:403});
  const raw=await request.text();
  if(raw.length>750000) return NextResponse.json({error:"Carga muito grande para esta versão. Use até 200 ordens."},{status:413});
  let parsed;
  try {parsed=agentRequestSchema.safeParse(JSON.parse(raw));} catch {return NextResponse.json({error:"Dados inválidos."},{status:400});}
  if(!parsed.success) return NextResponse.json({error:"A carga tem dados incompletos ou excede os limites desta versão (200 ordens). Atualize a simulação."},{status:400});
  const supabase=await createClient();
  const {data,error}=await supabase.rpc("local_get_planning_intelligence",{p_token:await getSessionToken()});
  if(error) return NextResponse.json({error:"Não foi possível verificar os critérios de IA."},{status:503});
  const settings=(data as {settings?:Record<string,unknown>}|null)?.settings;
  if(!settings?.aiEnabled) return NextResponse.json({error:"Ative a IA nos critérios antes de iniciar a equipe."},{status:409});
  if(parsed.data.provider!=="lmstudio"&&settings.aiExternalDataEnabled===false) return NextResponse.json({error:"O envio para provedores externos está desativado nos Critérios e analista IA. Escolha LM Studio local ou autorize o envio do pacote compacto."},{status:409});
  let providerConfig;
  try {providerConfig=resolveAgentProvider(parsed.data.provider,parsed.data.localModel,{...settings,aiModel:parsed.data.cloudModel||settings?.aiModel},process.env);} catch(cause){return NextResponse.json({error:cause instanceof Error?cause.message:"Configuração de IA inválida."},{status:400});}
  const now=Date.now();
  for(const [id,gate] of gates) if(!gate.active && gate.until<now) gates.delete(id);
  const gate=gates.get(user.user_id)??{active:false,count:0,until:now+600000};
  if(gate.active||gate.count>=15) return NextResponse.json({error:"Já existe uma análise ativa ou o limite de rodadas foi atingido. Aguarde alguns minutos."},{status:429});
  gate.active=true;gate.count++;gates.set(user.user_id,gate);
  const abort=new AbortController();
  const signal=AbortSignal.any([request.signal,abort.signal,AbortSignal.timeout(providerConfig.totalMs)]);
  const stream=new ReadableStream({
    async start(controller) {
      const emit=(event:AgentEvent)=>{if(!signal.aborted) controller.enqueue(new TextEncoder().encode(JSON.stringify(event)+"\n"));};
      try {
        if(parsed.data.provider==="openrouter"&&parsed.data.cloudModel){
          const models=await fetchFreeModels(AbortSignal.any([signal,AbortSignal.timeout(12000)]));
          if(!models.some(model=>model.id===parsed.data.cloudModel))throw new Error("O modelo selecionado não consta como gratuito com ferramentas. Atualize o catálogo.");
          providerConfig.model=parsed.data.cloudModel;
        }
        await prepareLocalModel(providerConfig,signal);
        const skill=await readFile(path.join(process.cwd(),"src/modules/planning/agents/skills",parsed.data.role,"SKILL.md"),"utf8");
        emit({type:"activity",message:`Skill carregada; consultando ${providerConfig.provider==="lmstudio"?"LM Studio local":providerConfig.provider==="openai"?"OpenAI":providerConfig.provider==="openclaw"?"OpenClaw":"OpenRouter"}`});
        emit({type:"activity",message:"Consultando produção e ciclos dos fornos no servidor..."});
        const operational=await loadOperationalSnapshot(supabase,user,parsed.data,AbortSignal.any([signal,AbortSignal.timeout(8000)]));
        const report=await runAgent(parsed.data,skill,(messages,tools,outerSignal)=>callAgentModel(providerConfig,messages,tools,outerSignal),signal,emit,operational);
        report.model=`${providerConfig.provider==="lmstudio"?"LM Studio":providerConfig.provider==="openai"?"OpenAI":providerConfig.provider==="openclaw"?"OpenClaw":"OpenRouter"} · ${report.model}`;
        const saved = await createAgentJournal().archive(user.user_id, report);
        emit({type:"complete",report:saved});
      } catch(cause) {
        if(!request.signal.aborted && !abort.signal.aborted) {
          const message=signal.aborted||cause instanceof Error&&/timeout|abort/i.test(cause.name)?"A análise excedeu o tempo disponível. Nenhuma operação foi aplicada.":cause instanceof Error?cause.message:"Não foi possível concluir a análise.";
          // Timeout errors also need to reach the client, unlike caller cancellations.
          controller.enqueue(new TextEncoder().encode(JSON.stringify({type:"error",message})+"\n"));
        }
      } finally {gate.active=false;try{controller.close();}catch{ /* Reader cancelled. */ }}
    },
    cancel(){abort.abort();},
  });
  return new Response(stream,{headers:{"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-store","X-Accel-Buffering":"no"}});
}
