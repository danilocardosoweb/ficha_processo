import { callAgentModel, prepareLocalModel, type ProviderConfig } from "./provider";
export type FreeModel = { id:string; name:string; contextLength:number };
export function freeToolModels(raw:unknown):FreeModel[] {
  const rows=(raw as {data?:unknown[]})?.data;
  if(!Array.isArray(rows))return [];
  return rows.flatMap(value=>{
    const row=value as {id?:unknown;name?:unknown;pricing?:Record<string,unknown>;supported_parameters?:string[];context_length?:number};
    if(typeof row.id!=="string"||!row.supported_parameters?.includes("tools")||!row.supported_parameters.includes("tool_choice"))return [];
    const price=row.pricing;
    if(!price || !["prompt","completion"].every(k=>price[k]!==undefined&&price[k]!==null&&String(price[k]).trim()!==""&&Number(price[k])===0))return [];
    if(price.request!==undefined&&Number(price.request)!==0)return [];
    return [{id:row.id,name:typeof row.name==="string"?row.name:row.id,contextLength:row.context_length??0}];
  }).sort((a,b)=>a.name.localeCompare(b.name));
}
export async function fetchFreeModels(signal:AbortSignal) {
  const response=await fetch("https://openrouter.ai/api/v1/models",{signal,cache:"no-store"});
  if(!response.ok)throw new Error("Não foi possível consultar o catálogo do OpenRouter.");
  return freeToolModels(await response.json());
}
export async function probeProvider(config:ProviderConfig,signal:AbortSignal) {
  await prepareLocalModel(config,signal);
  const started=Date.now();
  const tool={type:"function",function:{name:"confirmar_conexao",description:"Confirmar teste sintético, sem dados de produção.",parameters:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"],additionalProperties:false}}};
  const response=await callAgentModel(config,[{role:"user",content:"Chame confirmar_conexao com ok true. Não explique."}],[tool],signal);
  const calls=response.choices?.[0]?.message.tool_calls??[];
  const valid=calls.some(call=>{try{return call.function.name==="confirmar_conexao"&&JSON.parse(call.function.arguments).ok===true;}catch{return false;}});
  if(!valid)throw new Error("O modelo respondeu, mas não executou corretamente o teste de ferramentas. A conexão sozinha não basta para os agentes.");
  return {model:response.model??config.model,durationMs:Date.now()-started,message:"Modelo respondeu e solicitou a ferramenta corretamente. Teste curto aprovado; não garante uma rodada completa."};
}
