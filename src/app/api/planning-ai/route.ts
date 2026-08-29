import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const packetSchema = z.object({
  generatedAt: z.string().datetime(), mode: z.string().max(30), score: z.record(z.string(), z.unknown()),
  machines: z.array(z.record(z.string(), z.unknown())).max(10), materials: z.array(z.record(z.string(), z.unknown())).max(50),
  resources: z.record(z.string(), z.unknown()), deterministicRecommendations: z.array(z.record(z.string(), z.unknown())).max(100),
});

const aiResultSchema = z.object({
  executiveSummary: z.string().min(20).max(1800),
  decision: z.enum(["approve","approve_with_adjustments","replan","blocked"]),
  confidence: z.number().min(0).max(100),
  recommendations: z.array(z.object({
    priority: z.enum(["critical","high","medium","opportunity"]), title: z.string().min(3).max(140),
    evidence: z.array(z.string().max(280)).min(1).max(5), impact: z.string().min(3).max(500), action: z.string().min(3).max(500),
    affectedTools: z.array(z.string().max(50)).max(20),
  })).max(12),
  assumptions: z.array(z.string().max(300)).max(10), missingData: z.array(z.string().max(300)).max(10),
});

const outputSchema = {
  type:"object",additionalProperties:false,required:["executiveSummary","decision","confidence","recommendations","assumptions","missingData"],
  properties:{
    executiveSummary:{type:"string"},decision:{type:"string",enum:["approve","approve_with_adjustments","replan","blocked"]},confidence:{type:"number",minimum:0,maximum:100},
    recommendations:{type:"array",items:{type:"object",additionalProperties:false,required:["priority","title","evidence","impact","action","affectedTools"],properties:{priority:{type:"string",enum:["critical","high","medium","opportunity"]},title:{type:"string"},evidence:{type:"array",items:{type:"string"}},impact:{type:"string"},action:{type:"string"},affectedTools:{type:"array",items:{type:"string"}}}}},
    assumptions:{type:"array",items:{type:"string"}},missingData:{type:"array",items:{type:"string"}},
  },
} as const;

async function context(){const token=await getSessionToken();return token?{token,supabase:await createClient()}:null;}

export async function GET(){
  const ctx=await context();if(!ctx)return NextResponse.json({error:"Sessão encerrada."},{status:401});
  const key=process.env.OPENROUTER_API_KEY;
  try{
    const response=await fetch("https://openrouter.ai/api/v1/models?output_modalities=text&sort=latency-low-to-high",{headers:key?{Authorization:`Bearer ${key}`}:{},next:{revalidate:3600}});
    if(!response.ok)throw new Error("Catálogo indisponível.");
    const body=await response.json() as {data?:Array<{id:string;name:string;supported_parameters?:string[];context_length?:number;pricing?:{prompt?:string;completion?:string}}>};
    const models=(body.data??[]).filter(item=>item.supported_parameters?.some(parameter=>parameter==="structured_outputs"||parameter==="response_format")).slice(0,80).map(item=>({id:item.id,name:item.name,contextLength:item.context_length??null,pricing:item.pricing??null}));
    return NextResponse.json({configured:Boolean(key),models:[{id:"openrouter/auto",name:"Automático · melhor modelo para a análise",contextLength:null,pricing:null},...models.filter(item=>item.id!=="openrouter/auto")]});
  }catch{return NextResponse.json({configured:Boolean(key),models:[{id:"openrouter/auto",name:"Automático · melhor modelo para a análise",contextLength:null,pricing:null}]});}
}

export async function POST(request:Request){
  const ctx=await context();if(!ctx)return NextResponse.json({error:"Sessão encerrada."},{status:401});
  const raw=await request.text();if(raw.length>500_000)return NextResponse.json({error:"Pacote de análise excede o limite seguro."},{status:413});
  let decoded:unknown;try{decoded=JSON.parse(raw||"null");}catch{return NextResponse.json({error:"Dados da simulação inválidos."},{status:400});}
  const parsed=packetSchema.safeParse(decoded);if(!parsed.success)return NextResponse.json({error:"Dados da simulação inválidos."},{status:400});
  const key=process.env.OPENROUTER_API_KEY;if(!key)return NextResponse.json({error:"Integração com IA ainda não configurada no servidor. Cadastre uma nova OPENROUTER_API_KEY."},{status:503});
  const settingsResult=await ctx.supabase.rpc("local_get_planning_intelligence",{p_token:ctx.token});
  if(settingsResult.error)return NextResponse.json({error:"Não foi possível carregar os critérios de IA."},{status:400});
  const settings=(settingsResult.data as {settings?:Record<string,unknown>}|null)?.settings??{};
  if(!settings.aiEnabled)return NextResponse.json({error:"Ative a análise por IA nos Critérios da nota AluPilot."},{status:409});
  const requestHash=createHash("sha256").update(JSON.stringify({packet:parsed.data,model:settings.aiModel,personality:settings.aiPersonalityPrompt,criteria:settings.aiAnalysisCriteria})).digest("hex");
  const cached=await ctx.supabase.rpc("local_get_cached_planning_ai_analysis",{p_token:ctx.token,p_request_hash:requestHash});
  if(cached.data)return NextResponse.json(cached.data);
  const model=settings.aiModelMode==="auto"?"openrouter/auto":String(settings.aiModel||"openrouter/auto");
  const started=Date.now();
  try{
    const response=await fetch("https://openrouter.ai/api/v1/chat/completions",{method:"POST",signal:AbortSignal.timeout(60_000),headers:{Authorization:`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":process.env.APP_URL||"http://localhost:3000","X-OpenRouter-Title":"AluPilot"},body:JSON.stringify({
      model,messages:[
        {role:"system",content:`${String(settings.aiPersonalityPrompt)}\n\nCRITÉRIOS CONFIGURÁVEIS:\n${String(settings.aiAnalysisCriteria)}\n\nREGRAS DE SEGURANÇA: use somente os dados fornecidos; diferencie fato, inferência e dado ausente; nunca altere cálculos físicos; bloqueios determinísticos são soberanos; não invente estoques, tempos ou capacidades; responda em português do Brasil.`},
        {role:"user",content:`Analise o pacote compacto desta simulação e produza no máximo ${Number(settings.aiMaxRecommendations)||6} recomendações priorizadas. Dê preferência a ações que evitem parada das prensas e possam ser executadas pelo PCP.\n\n${JSON.stringify(parsed.data)}`},
      ],temperature:0.2,max_tokens:1800,provider:{require_parameters:true,allow_fallbacks:true,data_collection:"deny"},response_format:{type:"json_schema",json_schema:{name:"alupilot_planning_analysis",strict:true,schema:outputSchema}},
    })});
    const body=await response.json() as {error?:{message?:string};model?:string;usage?:Record<string,unknown>;choices?:Array<{message?:{content?:string}}>};
    if(!response.ok)throw new Error(body.error?.message||`OpenRouter respondeu ${response.status}.`);
    const result=aiResultSchema.parse(JSON.parse(body.choices?.[0]?.message?.content||"{}"));
    const durationMs=Date.now()-started;
    await ctx.supabase.rpc("local_save_planning_ai_analysis",{p_token:ctx.token,p_request_hash:requestHash,p_model_requested:model,p_model_used:body.model??model,p_status:"completed",p_input_summary:{machines:parsed.data.machines.length,materials:parsed.data.materials.length},p_result:result,p_usage:body.usage??{},p_duration_ms:durationMs,p_error_message:null});
    return NextResponse.json({result,modelUsed:body.model??model,usage:body.usage??{},durationMs,createdAt:new Date().toISOString(),cached:false});
  }catch(cause){
    const message=cause instanceof Error?cause.message:"Falha inesperada na análise.";
    await ctx.supabase.rpc("local_save_planning_ai_analysis",{p_token:ctx.token,p_request_hash:requestHash,p_model_requested:model,p_model_used:null,p_status:"failed",p_input_summary:{machines:parsed.data.machines.length,materials:parsed.data.materials.length},p_result:null,p_usage:{},p_duration_ms:Date.now()-started,p_error_message:message});
    return NextResponse.json({error:`A análise determinística continua válida. A IA não respondeu: ${message}`},{status:502});
  }
}
