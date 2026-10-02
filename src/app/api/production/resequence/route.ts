import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(500),
  password: z.string().min(1).max(200),
  reason: z.string().trim().min(5, "Informe o motivo do ajuste (mínimo de 5 caracteres).").max(1_000),
});

export async function POST(request: Request) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Revise o ajuste de sequência." }, { status: 400 });
  }

  const { data, error } = await (await createClient()).rpc("local_resequence_work_queue", {
    p_token: token,
    p_password: parsed.data.password,
    p_order_ids: parsed.data.orderIds,
    p_reason: parsed.data.reason,
  });
  if (error) {
    const missingFunction =
      error.code === "42883" ||
      error.code === "PGRST202" ||
      /could not find the function .*local_resequence_work_queue.*schema cache/i.test(error.message ?? "");
    if (missingFunction) {
      return NextResponse.json(
        { error: "O recálculo ainda não está disponível porque a atualização de segurança da sequência não foi publicada no Supabase. Peça ao administrador para aplicar a migration 20261001183000_protected_work_sequence_recalculation.sql e tente novamente." },
        { status: 503 },
      );
    }
    const status = error.code === "42501" ? 403 : error.code === "28000" ? 401 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }
  return NextResponse.json(data ?? { ok: true });
}
