import { orders as demoOrders } from "@/data/mock";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import type { ProductionOrder, SimplifiedQueue } from "@/types/database";

export async function listProductionOrders(): Promise<ProductionOrder[]> {
  if (!isSupabaseConfigured()) return demoOrders;
  const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
  if (!organizationId) throw new Error("Organizacao padrao nao configurada.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_orders")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("due_date", { ascending: true })
    .order("sequence", { ascending: true });
  if (error) throw new Error(`Falha ao consultar ordens: ${error.message}`);
  return (data ?? []) as ProductionOrder[];
}

export async function listSimplifiedQueues(): Promise<SimplifiedQueue[]> {
  if (!isSupabaseConfigured()) {
    const grouped = new Map<string, ProductionOrder[]>();
    demoOrders.forEach((order) => {
      const key = order.plan_code || "DEMO";
      grouped.set(key, [...(grouped.get(key) ?? []), order]);
    });
    return [...grouped.entries()].map(([plan, production_orders], index) => ({
      id: `demo-${plan}`,
      plan_code: plan,
      machine_code: production_orders[0]?.machine_code ?? null,
      file_name: "Dados demonstrativos",
      created_at: new Date(Date.now() + index * 1000).toISOString(),
      is_active: true,
      status: "processed" as const,
      production_orders,
    }));
  }
  const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
  if (!organizationId) throw new Error("Organizacao padrao nao configurada.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("simplified_imports")
    .select(
      "id,plan_code,machine_code,file_name,created_at,processed_at,is_active,status,production_status,production_started_at,production_completed_at,production_completed_by_name,production_orders(*)",
    )
    .eq("organization_id", organizationId)
    .eq("status", "processed")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error)
    throw new Error(`Falha ao consultar Simplificadas: ${error.message}`);
  return ((data ?? []) as SimplifiedQueue[]).map((queue) => ({
    ...queue,
    production_orders: [...(queue.production_orders ?? [])].sort(
      (a, b) => a.sequence - b.sequence,
    ),
  }));
}
