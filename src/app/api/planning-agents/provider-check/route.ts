import { NextResponse } from "next/server";
import { sameRequestOrigin } from "@/modules/planning/agents/request-origin";
import { z } from "zod";
import { getCurrentUser } from "@/lib/local-auth/server";
import { canAccess } from "@/lib/access-control";
import { fetchFreeModels, probeProvider } from "@/modules/planning/agents/catalog";
import { resolveAgentProvider } from "@/modules/planning/agents/provider";
export const maxDuration=150;
const active=new Set<string>();
const last=new Map<string,number>();
async function authorized(){const user=await getCurrentUser();return user&&canAccess(user.role,"simulation")?user:null;}
export async function GET(){
  if(!await authorized())return NextResponse.json({error:"Entre com um usuário autorizado."},{status:403});
  try{return NextResponse.json({models:await fetchFreeModels(AbortSignal.timeout(12000))},{headers:{"Cache-Control":"no-store"}});}
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Catálogo indisponível."},{status:502});}
}
export async function POST(request:Request){
  const user=await authorized();
  if(!user)return NextResponse.json({error:"Entre com um usuário autorizado."},{status:403});
  if(!sameRequestOrigin(request))return NextResponse.json({error:"Origem não permitida."},{status:403});
  const raw=await request.text();if(raw.length>2000)return NextResponse.json({error:"Solicitação muito grande."},{status:413});
  const input=z.object({provider:z.enum(["openrouter","lmstudio","openai","openclaw"]),model:z.string().trim().min(1).max(200)}).safeParse(await Promise.resolve().then(()=>JSON.parse(raw)).catch(()=>null));
  if(!input.success)return NextResponse.json({error:"Selecione um modelo antes de testar."},{status:400});
  const now=Date.now();for(const [id,time] of last)if(now-time>60000)last.delete(id);
  if(active.has(user.user_id)||now-(last.get(user.user_id)??0)<10000)return NextResponse.json({error:"Aguarde o teste atual ou alguns segundos antes de repetir."},{status:429});
  active.add(user.user_id);last.set(user.user_id,now);
  try{
    const signal=AbortSignal.any([request.signal,AbortSignal.timeout(130000)]);
    if(input.data.provider==="openrouter"){
      const models=await fetchFreeModels(signal);
      if(!models.some(m=>m.id===input.data.model))throw new Error("Escolha um modelo gratuito com ferramentas no catálogo atualizado.");
    }
    const config=resolveAgentProvider(input.data.provider,input.data.model,{aiModelMode:"manual",aiModel:input.data.model},process.env);
    return NextResponse.json(await probeProvider(config,signal),{headers:{"Cache-Control":"no-store"}});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Teste não concluído."},{status:502});}
  finally{active.delete(user.user_id);}
}
