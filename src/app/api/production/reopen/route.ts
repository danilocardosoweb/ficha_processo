import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  orderId: z.string().uuid(),
  reason: z.string().trim().min(5).max(1_000).optional(),
});

export async function POST(request: Request) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revise o motivo da correção." }, { status: 400 });
  const { data, error } = await (await createClient()).rpc("local_reopen_production_session", {
    p_token: token,
    p_order_id: parsed.data.orderId,
    p_reason: parsed.data.reason || "Item reprogramado para correção operacional.",
  });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json(data);
}

