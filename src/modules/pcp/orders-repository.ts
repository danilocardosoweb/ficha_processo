import { orders as demoOrders } from "@/data/mock";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { isDevelopmentAuthEnabled } from "@/lib/local-auth/development";
import type { ProductionOrder, SimplifiedQueue } from "@/types/database";

const productionOrderFields = [
  "id", "organization_id", "import_batch_id", "order_number", "plan_code", "machine_code", "tool_code",
  "product_code", "product_description", "customer_name", "alloy_code", "temper", "target_kg", "produced_kg",
  "produced_quantity", "target_quantity", "actual_start", "actual_end", "started_by_name", "completed_by_name",
  "reopened_at", "reopened_by_name", "reprogram_count", "last_status_reason", "demand_unit", "is_active",
  "due_date", "sequence", "original_machine_code", "original_sequence", "active_sequence_source", "active_sequence_scenario_id", "active_sequence_version", "active_sequence_approved_at", "active_sequence_approved_by_name", "status", "notes", "source_data", "holes", "bo_code", "carcass_code",
  "package_measure_mm", "carcass_diameter_mm", "created_at", "updated_at",
].join(",");

function isSupabaseRestricted(error: unknown) {
  const value = error instanceof Error ? error.message : error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
  return /exceed_cached_egress_quota|service for this project is restricted/i.test(value);
}

function demoQueues(): SimplifiedQueue[] {
  const grouped = new Map<string, ProductionOrder[]>();
  demoOrders.forEach((order) => {
    const key = order.plan_code || "DEMO";
    grouped.set(key, [...(grouped.get(key) ?? []), order]);
  });
  return [...grouped.entries()].map(([plan, production_orders], index) => ({
    id: `demo-${plan}`,
    plan_code: plan,
    machine_code: production_orders[0]?.machine_code ?? null,
    file_name: "Dados demonstrativos · Supabase indisponível",
    created_at: new Date(Date.now() + index * 1000).toISOString(),
    is_active: true,
    status: "processed" as const,
    production_orders,
  }));
}

export async function listProductionOrders(): Promise<ProductionOrder[]> {
  if (!isSupabaseConfigured()) return demoOrders;
  const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
  if (!organizationId) throw new Error("Organizacao padrao nao configurada.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("production_orders")
    .select(productionOrderFields)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("due_date", { ascending: true })
    .order("sequence", { ascending: true })
    .limit(2000);
  if (error) {
    if (isDevelopmentAuthEnabled() && isSupabaseRestricted(error)) {
      console.warn("Supabase restrito; usando ordens demonstrativas para desenvolvimento.");
      return demoOrders;
    }
    throw new Error(`Falha ao consultar ordens: ${error.message}`);
  }
  return (data ?? []) as unknown as ProductionOrder[];
}

export async function listSimplifiedQueues(): Promise<SimplifiedQueue[]> {
  if (!isSupabaseConfigured()) {
    return demoQueues();
  }
  const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
  if (!organizationId) throw new Error("Organizacao padrao nao configurada.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("simplified_imports")
    .select(
      `id,plan_code,machine_code,file_name,created_at,processed_at,is_active,status,production_status,production_started_at,production_completed_at,production_completed_by_name,active_sequence_source,active_sequence_scenario_id,active_sequence_version,active_sequence_approved_at,active_sequence_approved_by_name,production_orders(${productionOrderFields})`,
    )
    .eq("organization_id", organizationId)
    .eq("status", "processed")
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) {
    if (isDevelopmentAuthEnabled() && isSupabaseRestricted(error)) {
      console.warn("Supabase restrito; usando Simplificadas demonstrativas para desenvolvimento.");
      return demoQueues();
    }
    throw new Error(`Falha ao consultar Simplificadas: ${error.message}`);
  }
  return ((data ?? []) as unknown as SimplifiedQueue[]).map((queue) => ({
    ...queue,
    production_orders: [...(queue.production_orders ?? [])].sort(
      (a, b) => a.sequence - b.sequence,
    ),
  }));
}
