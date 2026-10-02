import type { SupabaseClient } from "@supabase/supabase-js";
import type { LocalUser } from "@/lib/local-auth/types";
import type { AgentInput } from "./contracts";

export type OperationalSnapshot = {
  queriedAt: string; status: "available" | "partial" | "unavailable";
  production: Record<string, unknown>[]; ovens: Record<string, unknown>[]; cycles: Record<string, unknown>[];
  limitations: string[];
};
export function operationalScope(user: Pick<LocalUser,"machine_codes">, requested: string[]) {
  return [...new Set(requested)].filter(code => !user.machine_codes.length || user.machine_codes.includes(code));
}
const fields = {
  production: "id,order_number,machine_code,tool_code,status,sequence,target_kg,produced_kg,actual_start,actual_end",
  ovens: "id,machine_code,code,position_count,is_active",
  cycles: "id,machine_code,tool_code,oven_id,oven_code,oven_position,status,entered_at,expected_ready_at,released_at,tool_heating_cycle_orders(production_order_id)",
};
export async function loadOperationalSnapshot(client: SupabaseClient, user: LocalUser, input: AgentInput, signal: AbortSignal): Promise<OperationalSnapshot> {
  const snapshot: OperationalSnapshot = { queriedAt: new Date().toISOString(), status: "unavailable", production: [], ovens: [], cycles: [], limitations: ["Leituras pontuais, não transação única nem monitoramento contínuo. Temperatura medida, qualidade e confirmação física não consultadas. A ordem por entrada é FIFO registrado, não autorização para retirar."] };
  const machines = operationalScope(user, input.context.orders.map(o => o.machineCode));
  if (!machines.length) { snapshot.limitations.push("Nenhuma prensa autorizada no escopo solicitado."); return snapshot; }
  const queries = [
    client.from("production_orders").select(fields.production).eq("organization_id",user.organization_id).in("machine_code",machines).in("id",input.context.orders.map(o=>o.id)).eq("is_active",true).order("id").limit(201).abortSignal(signal),
    client.from("tool_ovens").select(fields.ovens).eq("organization_id",user.organization_id).in("machine_code",machines).eq("is_active",true).order("id").limit(101).abortSignal(signal),
    client.from("tool_heating_cycles").select(fields.cycles).eq("organization_id",user.organization_id).in("machine_code",machines).in("status",["heating","released"]).order("entered_at").order("id").limit(501).abortSignal(signal),
  ];
  const keys = ["production","ovens","cycles"] as const; const caps = [200,100,500];
  const responses = await Promise.allSettled(queries); let successes = 0;
  responses.forEach((response,index)=>{
    const key=keys[index];
    if(response.status === "rejected" || response.value.error) { snapshot.limitations.push(`Consulta ${key} indisponível. Ausência de resposta não significa ausência de registros.`); return; }
    const rows = response.value.data as unknown as Record<string,unknown>[];
    if(rows.length > caps[index]) { snapshot.limitations.push(`Consulta ${key} excedeu o limite; registros não utilizados para evitar conclusões sobre disponibilidade com dados incompletos.`); return; }
    snapshot[key]=rows; successes++;
  });
  snapshot.status=successes===3?"available":successes?"partial":"unavailable";
  const found = new Set(snapshot.production.map(o=>o.id));
  const missing=input.context.orders.filter(o=>!found.has(o.id));
  if(missing.length) snapshot.limitations.push(`${missing.length} ordens da simulação não confirmadas na consulta de produção. Não presumir situação atual.`);
  snapshot.queriedAt=new Date().toISOString();
  return snapshot;
}
