import { NextResponse } from "next/server";
import { z } from "zod";
import { canAccess } from "@/lib/access-control";
import { getCurrentUser, getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(200),
  category: z.enum(["mechanical", "electrical", "hydraulic", "tooling", "quality", "process", "material", "setup", "other"]),
  reasonCode: z.string().trim().max(120).optional().nullable(),
  reasonCatalogId: z.string().uuid().optional().nullable(),
  typeCatalogId: z.string().uuid().optional().nullable(),
  responsibleDepartment: z.string().trim().max(120).optional().nullable(),
  reason: z.string().trim().min(3).max(2_000),
  notes: z.string().trim().max(2_000).optional().nullable(),
  shift: z.string().trim().max(80).optional().nullable(),
  maintenanceRequired: z.boolean(),
  problemArea: z.string().trim().max(120).optional().nullable(),
  responsibleArea: z.string().trim().max(120).optional().nullable(),
  serviceOrderNumber: z.string().trim().max(120).optional().nullable(),
  occurrenceDate: z.string().trim().min(1),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime().optional().nullable(),
  durationMinutes: z.number().nonnegative().optional().nullable(),
  toolSequence: z.number().int().nonnegative().optional().nullable(),
  billetCasing: z.string().trim().max(120).optional().nullable(),
  equipmentType: z.string().trim().max(120).optional().nullable(),
  equipmentNumber: z.string().trim().max(120).optional().nullable(),
  symptoms: z.string().trim().max(2_000),
  interventionPerformed: z.string().trim().max(2_000).optional().nullable(),
  dummyBlockEntered: z.string().trim().max(120).optional().nullable(),
  dummyBlockExited: z.string().trim().max(120).optional().nullable(),
  pressCount: z.number().int().nonnegative().optional().nullable(),
  dummyBlockSide: z.string().trim().max(120).optional().nullable(),
});

export async function POST(request: Request) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
  if (!canAccess(user.role, "production", user.access_overrides) || user.role === "viewer") {
    return NextResponse.json({ error: "Seu perfil não pode registrar parada de produção." }, { status: 403 });
  }
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revise os dados da parada." }, { status: 400 });

  const input = parsed.data;
  const client = await createClient();
  const { data: orders, error: orderError } = await client
    .from("production_orders")
    .select("id,organization_id,import_batch_id,machine_code,plan_code,order_number,tool_code,product_code,customer_name,alloy_code,temper")
    .in("id", input.orderIds)
    .eq("organization_id", user.organization_id)
    .eq("is_active", true)
    .eq("status", "in_progress");
  if (orderError) return NextResponse.json({ error: orderError.message }, { status: 400 });
  if (!orders || orders.length !== input.orderIds.length) {
    return NextResponse.json({ error: "Um dos itens não está mais em produção. Atualize a tela antes de registrar a parada." }, { status: 409 });
  }
  const order = orders[0];
  if (user.role === "operator" && user.machine_codes.length > 0 && !user.machine_codes.includes(order.machine_code)) {
    return NextResponse.json({ error: "Seu usuário não possui acesso à prensa selecionada." }, { status: 403 });
  }
  const { data: stoppage, error: stoppageError } = await client.from("machine_stoppages").insert({
    organization_id: user.organization_id,
    production_order_id: order.id,
    import_batch_id: order.import_batch_id,
    machine_code: order.machine_code,
    plan_code: order.plan_code,
    order_number: order.order_number,
    tool_code: order.tool_code,
    product_code: order.product_code,
    customer_name: order.customer_name,
    alloy_code: order.alloy_code,
    temper: order.temper,
    category: input.category,
    reason_code: input.reasonCode || null,
    reason_catalog_id: input.reasonCatalogId || null,
    stoppage_type_catalog_id: input.typeCatalogId || null,
    responsible_department: input.responsibleDepartment || null,
    reason: input.reason,
    notes: input.notes || null,
    shift: input.shift || null,
    maintenance_required: input.maintenanceRequired,
    reported_by_name: user.display_name,
    problem_area: input.problemArea || "Produção",
    responsible_area: input.responsibleArea || null,
    service_order_number: input.serviceOrderNumber || null,
    occurrence_date: input.occurrenceDate,
    started_at: input.startedAt,
    ended_at: input.endedAt || null,
    duration_minutes: input.durationMinutes ?? null,
    status: input.endedAt ? "closed" : "open",
    closed_by_name: input.endedAt ? user.display_name : null,
    tool_sequence: input.toolSequence ?? null,
    billet_casing: input.billetCasing || null,
    equipment_type: input.equipmentType || null,
    equipment_number: input.equipmentNumber || null,
    symptoms: input.symptoms,
    intervention_performed: input.interventionPerformed || null,
    dummy_block_entered: input.dummyBlockEntered || null,
    dummy_block_exited: input.dummyBlockExited || null,
    press_count: input.pressCount ?? null,
    dummy_block_side: input.dummyBlockSide || null,
  }).select("id,status,started_at,ended_at,duration_minutes").single();
  if (stoppageError) return NextResponse.json({ error: stoppageError.message }, { status: 400 });

  if (!input.endedAt) {
    const { error: pauseError } = await client.rpc("local_pause_production_session", {
      p_token: token,
      p_order_ids: input.orderIds,
      p_reason: input.reason,
    });
    if (pauseError) return NextResponse.json({ error: pauseError.message, stoppage }, { status: 400 });
  }
  return NextResponse.json({ stoppage, paused: !input.endedAt });
}
