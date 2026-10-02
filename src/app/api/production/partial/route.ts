import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(200),
  producedKg: z.number().finite().min(0).max(1_000_000),
  producedQuantity: z.number().finite().min(0).max(10_000_000),
  reasonType: z.enum(["tool_issue", "produce_later"]),
  reason: z.string().trim().min(8).max(1_000),
  notes: z.string().trim().max(2_000).optional(),
  achievedProductivity: z.number().finite().positive().max(2_500),
  processSheetId: z.string().uuid().optional(),
}).refine(value => value.producedKg > 0 || value.producedQuantity > 0, {
  message: "Informe o resultado produzido nesta etapa.",
});

export async function POST(request: Request) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revise o apontamento parcial." }, { status: 400 });
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("local_record_partial_production_session", {
    p_token: token,
    p_order_ids: parsed.data.orderIds,
    p_produced_kg: parsed.data.producedKg,
    p_produced_quantity: parsed.data.producedQuantity,
    p_reason_type: parsed.data.reasonType,
    p_reason: parsed.data.reason,
    p_notes: parsed.data.notes || null,
    p_achieved_productivity_kg_h: parsed.data.achievedProductivity,
    p_process_sheet_id: parsed.data.processSheetId || null,
  });
  if (error)
    return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json(data);
}
