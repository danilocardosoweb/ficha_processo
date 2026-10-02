import type { ModelMessage, ModelResponse } from "./runner";

type Env = Record<string,string|undefined>;
export function localBaseUrl(env:Env) {
  const url=new URL(env.LM_STUDIO_BASE_URL||"http://127.0.0.1:1234/v1");
  if(!["http:","https:"].includes(url.protocol)||url.username||url.password||url.search||url.hash) throw new Error("LM_STUDIO_BASE_URL inválida no servidor.");
  // This URL is administrator-controlled environment configuration, never a browser parameter.
  return url.toString().replace(/\/$/,"");
}
export type AgentProvider = "openrouter" | "lmstudio" | "openai" | "openclaw";
export function resolveAgentProvider(provider:AgentProvider,localModel:string|undefined,settings:Record<string,unknown>,env:Env) {
  if(provider==="lmstudio") {
    if(!localModel?.trim()) throw new Error("Selecione um modelo do LM Studio antes de iniciar.");
    return {provider,baseUrl:localBaseUrl(env),model:localModel.trim(),key:env.LM_STUDIO_API_KEY||"",timeoutMs:120000,totalMs:300000};
  }
  if(provider==="openai") {
    if(!env.OPENAI_API_KEY) throw new Error("Configure OPENAI_API_KEY no servidor ou escolha outro provedor.");
    const model=String(settings.aiModel||localModel||"").trim();
    if(!model) throw new Error("Informe o modelo da OpenAI antes de iniciar.");
    return {provider,baseUrl:"https://api.openai.com/v1",model,key:env.OPENAI_API_KEY,timeoutMs:40000,totalMs:105000};
  }
  if(provider==="openclaw") {
    if(!env.OPENCLAW_API_KEY||!env.OPENCLAW_BASE_URL) throw new Error("Configure OPENCLAW_BASE_URL e OPENCLAW_API_KEY no servidor ou escolha outro provedor.");
    const model=String(settings.aiModel||localModel||"").trim();
    if(!model) throw new Error("Informe o modelo do OpenClaw antes de iniciar.");
    return {provider,baseUrl:localBaseUrl({...env,LM_STUDIO_BASE_URL:env.OPENCLAW_BASE_URL}),model,key:env.OPENCLAW_API_KEY,timeoutMs:50000,totalMs:120000};
  }
  if(!env.OPENROUTER_API_KEY) throw new Error("Configure a chave do OpenRouter ou selecione LM Studio local.");
  return {provider,baseUrl:"https://openrouter.ai/api/v1",model:settings.aiModelMode==="auto"?"openrouter/auto":String(settings.aiModel||"openrouter/auto"),key:env.OPENROUTER_API_KEY,timeoutMs:40000,totalMs:105000};
}
export type ProviderConfig=ReturnType<typeof resolveAgentProvider>;
export function canonicalLocalModel(requested:string,ids:string[]) {
  if(ids.includes(requested))return requested;
  const matches=ids.filter(id=>id.split("/").at(-1)===requested);
  if(matches.length===1)return matches[0];
  throw new Error(matches.length>1?"Modelo não encontrado de forma única. Selecione o identificador completo na lista do LM Studio.":"Modelo não encontrado na lista do LM Studio. Teste a conexão e escolha o identificador completo.");
}
export async function prepareLocalModel(config:ProviderConfig,signal:AbortSignal) {
  if(config.provider!=="lmstudio")return;
  const response=await fetch(config.baseUrl+"/models",{redirect:"error",signal:AbortSignal.any([signal,AbortSignal.timeout(8000)]),headers:config.key?{Authorization:`Bearer ${config.key}`}:{}});
  if(!response.ok)throw new Error("Não foi possível validar o modelo no LM Studio. Confira a conexão e a autenticação.");
  const body=await response.json() as {data?:Array<{id?:unknown}>};
  config.model=canonicalLocalModel(config.model,(body.data??[]).flatMap(model=>typeof model.id==="string"?[model.id]:[]));
}
export function localProviderFailure(status:number,body:unknown) {
  const error = body && typeof body === "object" ? (body as {error?:unknown}).error : undefined;
  const message = typeof error === "string" ? error : error && typeof error === "object" && typeof (error as {message?:unknown}).message === "string" ? (error as {message:string}).message : "";
  if(/insufficient system resources|out of memory|not enough memory|requires approximately.*memory|would likely overload/i.test(message)) {
    const required=message.match(/requires approximately\s+([\d.]+)\s*(GB|GiB)/i);
    return `Memória insuficiente para carregar o modelo no LM Studio.${required?` O provedor estima ${required[1].replace(".",",")} ${required[2]}.`:""} Carregue um modelo menor e selecione seu identificador completo. Mantenha a proteção de memória ativada.`;
  }
  if(/context length|context window|context size|too many tokens|exceeds.*context/i.test(message)) return "Contexto insuficiente no LM Studio para esta análise. Reduza a carga enviada ou ajuste o contexto dentro da memória disponível.";
  if(/model.*not found|unknown model|no model.*loaded|model.*does not exist/i.test(message)) return "Modelo não encontrado ou não carregado no LM Studio. Use Testar conexão / listar modelos e copie o identificador completo.";
  if(/tool|function.call/i.test(message)) return "O modelo ou sua configuração no LM Studio recusou o uso de ferramentas. Confira a compatibilidade do modelo antes de iniciar outra rodada.";
  return `LM Studio recusou a análise (HTTP ${status}). Consulte o log do servidor para identificar a causa. Nenhuma operação foi aplicada.`;
}
export function completionRequest(config:ProviderConfig,messages:ModelMessage[],tools:unknown[]) {
  if(config.provider==="lmstudio")messages=messages.map(message=>message.role==="system"?{...message,content:(message.content??"")+"\nEntrega concisa para o modelo local: resumo de até 300 caracteres, no máximo uma proposta prioritária com até três passos curtos. Mantenha as limitações e cite apenas fontes consultadas. Use chamadas de ferramentas, não texto solto."}:message);
  // Qwen3's documented soft switch keeps its limited output budget for tool calls.
  // Applies only to the original Qwen3 family, not later thinking-only variants.
  if(config.provider==="lmstudio"&&/^qwen3-(?:0\.6|1\.7|4|8|14|30|32|235)b(?:-|$)/i.test(config.model.split("/").at(-1)??""))
    messages=messages.map(message=>message.role==="user"?{...message,content:(message.content??"")+"\n/no_think"}:message);
  return {url:`${config.baseUrl}/chat/completions`,headers:{"Content-Type":"application/json",...(config.key?{Authorization:`Bearer ${config.key}`}:{})},body:{model:config.model,messages,tools,tool_choice:"required",max_tokens:config.provider==="lmstudio"?1200:2200,temperature:0.2,...(config.provider==="openrouter"?{provider:{require_parameters:true,allow_fallbacks:true,data_collection:"deny",...(/:free$|^openrouter\/free$/.test(config.model)?{max_price:{prompt:0,completion:0}}:{})}}:{})}};
}
export function cloudProviderFailure(status:number,body:unknown) {
  const error=body&&typeof body==="object"?(body as {error?:unknown}).error:undefined;
  const message=error&&typeof error==="object"&&typeof (error as {message?:unknown}).message==="string"?(error as {message:string}).message:"";
  if(/data policy|data collection|privacy/i.test(message))return "OpenRouter não encontrou um provedor compatível com a política de privacidade. Escolha outro modelo ou revise conscientemente as permissões de dados da conta. O aplicativo não altera essa proteção automaticamente.";
  if(status===404)return "OpenRouter não encontrou um endpoint disponível para este modelo com as ferramentas e proteções exigidas. Atualize o catálogo e teste outro modelo gratuito.";
  if(status===402)return "OpenRouter recusou por limite de créditos. Confira a conta e confirme que o modelo selecionado continua gratuito; nenhum modelo pago foi escolhido automaticamente.";
  return `OpenRouter recusou a análise (HTTP ${status}). Teste outro modelo compatível ou tente novamente mais tarde. Nenhuma operação foi aplicada.`;
}
export async function callAgentModel(config:ProviderConfig,messages:ModelMessage[],tools:unknown[],signal:AbortSignal):Promise<ModelResponse> {
  const req=completionRequest(config,messages,tools);
  let response:Response;
  try {response=await fetch(req.url,{method:"POST",redirect:"error",signal:AbortSignal.any([signal,AbortSignal.timeout(config.timeoutMs)]),headers:req.headers,body:JSON.stringify(req.body)});}
  catch(cause) {
    if(signal.aborted||cause instanceof Error&&/timeout|abort/i.test(cause.name)) throw new Error("A IA excedeu o tempo de resposta. No LM Studio, confira se o modelo cabe na memória e está carregado.");
    throw new Error(config.provider==="lmstudio"?"Não foi possível conectar ao LM Studio. Inicie o servidor na aba Developer e confira o endereço configurado no servidor do aplicativo.":config.provider==="openai"?"Não foi possível conectar à OpenAI.":config.provider==="openclaw"?"Não foi possível conectar ao OpenClaw.":"Não foi possível conectar ao OpenRouter.");
  }
  if(!response.ok) {
    if(response.status===401||response.status===403)throw new Error(config.provider==="lmstudio"?"LM Studio exige autenticação. Configure LM_STUDIO_API_KEY no servidor.":config.provider==="openai"?"OpenAI recusou a autenticação. Confira OPENAI_API_KEY no servidor.":config.provider==="openclaw"?"OpenClaw recusou a autenticação. Confira a chave configurada no servidor.":"OpenRouter recusou a autenticação. Confira a chave configurada.");
    if(response.status===429)throw new Error("O provedor atingiu o limite de uso. Aguarde antes de tentar novamente.");
    if(config.provider==="lmstudio") throw new Error(localProviderFailure(response.status,await response.json().catch(()=>null)));
    throw new Error(cloudProviderFailure(response.status,await response.json().catch(()=>null)));
  }
  return await response.json() as ModelResponse;
}
