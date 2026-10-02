import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  orderIds: z.array(z.string().uuid()).min(1).max(200),
  confirmedRemovedFromOven: z.literal(true),
  earlyReleaseJustification: z.string().trim().max(500).optional(),
});

export async function POST(request: Request) {
  const token = await getSessionToken();
  if (!token) {
    return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  }

  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Revise a confirmação de início." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("local_start_production_session", {
    p_token: token,
    p_order_ids: parsed.data.orderIds,
    p_confirmed_removed_from_oven: parsed.data.confirmedRemovedFromOven,
    p_early_release_justification: parsed.data.earlyReleaseJustification || null,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  }

  return NextResponse.json(data);
}
