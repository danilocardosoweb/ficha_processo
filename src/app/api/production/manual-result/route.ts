import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  orderId: z.string().uuid(),
  producedKg: z.number().finite().min(0).max(1_000_000),
  producedQuantity: z.number().finite().min(0).max(10_000_000),
}).refine(value => value.producedKg > 0 || value.producedQuantity > 0, { message: "Informe o resultado produzido." });

export async function POST(request: Request) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revise o resultado." }, { status: 400 });
  const { data, error } = await (await createClient()).rpc("local_record_manual_production_result", {
    p_token: token,
    p_order_id: parsed.data.orderId,
    p_produced_kg: parsed.data.producedKg,
    p_produced_quantity: parsed.data.producedQuantity,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json(data);
}

