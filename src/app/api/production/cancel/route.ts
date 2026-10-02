import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({ orderId: z.string().uuid(), reason: z.string().trim().min(3).max(1_000) });

export async function POST(request: Request) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Informe o motivo." }, { status: 400 });
  const { data, error } = await (await createClient()).rpc("local_cancel_production_order", {
    p_token: token,
    p_order_id: parsed.data.orderId,
    p_reason: parsed.data.reason,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json(data);
}

