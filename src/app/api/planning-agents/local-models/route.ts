import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local-auth/server";
import { canAccess } from "@/lib/access-control";
import { localBaseUrl } from "@/modules/planning/agents/provider";

export async function GET() {
  const user=await getCurrentUser();
  if(!user) return NextResponse.json({error:"Entre novamente para testar a conexão."},{status:401});
  if(!canAccess(user.role,"simulation"))return NextResponse.json({error:"Acesso não permitido."},{status:403});
  try {
    const baseUrl=localBaseUrl(process.env);
    const response=await fetch(`${baseUrl}/models`,{cache:"no-store",redirect:"error",signal:AbortSignal.timeout(8000),headers:process.env.LM_STUDIO_API_KEY?{Authorization:`Bearer ${process.env.LM_STUDIO_API_KEY}`}:{}});
    if(!response.ok)return NextResponse.json({error:response.status===401||response.status===403?"LM Studio exige uma chave. Configure LM_STUDIO_API_KEY no servidor.":"LM Studio não retornou a lista de modelos. Confira a aba Developer."},{status:502});
    const body=await response.json() as {data?:Array<{id?:unknown}>};
    const models=(Array.isArray(body.data)?body.data:[]).map(item=>item.id).filter((id):id is string=>typeof id==="string"&&id.length>0&&id.length<=200).slice(0,100);
    return NextResponse.json({baseUrl,models:[...new Set(models)],message:models.length?"Conexão disponível. A lista não garante compatibilidade com ferramentas; carregue um modelo de chat adequado.":"Conectado, mas nenhum modelo disponível. Carregue um modelo no LM Studio."},{headers:{"Cache-Control":"no-store"}});
  }catch{return NextResponse.json({error:"LM Studio não respondeu. Abra Developer, carregue um modelo e inicie o servidor. O endereço padrão é http://127.0.0.1:1234/v1 no computador que executa o aplicativo."},{status:502});}
}
