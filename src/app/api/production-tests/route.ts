import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { isDevelopmentSession } from "@/lib/local-auth/development";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(200),
  requiresTest: z.boolean(),
});

export async function POST(request: Request) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const input = schema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Seleção de testes inválida." }, { status: 400 });
  if (isDevelopmentSession(token)) {
    return NextResponse.json({ ok: true, updated: input.data.orderIds.length });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("local_set_production_order_test_requirement", {
    p_token: token,
    p_order_ids: input.data.orderIds,
    p_requires_test: input.data.requiresTest,
  });
  if (error) {
    const message = error.code === "42883" || error.code === "42703"
      ? "A estrutura do banco ainda não recebeu a migração dos testes do PCP."
      : error.message;
    return NextResponse.json({ error: message }, { status: 403 });
  }
  return NextResponse.json({ ok: true, updated: data ?? 0 });
}
