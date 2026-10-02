import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser, getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";
import { profileSchema } from "@/modules/planning/decision-system/schema";

const saveSchema = z.object({
  id: z.string().uuid().nullable(),
  baseVersion: z.number().int().min(0),
  profile: profileSchema,
  reason: z.string().trim().min(5, "Explique o motivo da alteração.").max(1000),
  impact: z.record(z.string(), z.unknown()),
});
export async function GET() {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Entre no sistema para consultar os perfis." }, { status: 401 });
  const client = await createClient();
  const result = await client.rpc("local_list_decision_profiles", { p_token: token });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json(result.data ?? []);
}
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Somente o administrador pode salvar critérios." }, { status: 403 });
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  const input = parsed.data;
  if (JSON.stringify(input.impact).length > 30000) return NextResponse.json({ error: "Resumo de impacto muito grande." }, { status: 400 });
  const client = await createClient();
  const result = await client.rpc("local_save_decision_profile", {
    p_token: await getSessionToken(), p_id: input.id, p_base_version: input.baseVersion,
    p_document: input.profile, p_reason: input.reason,
    p_impact: { ...input.impact, source: "prévia da simulação; não representa aprovação da produção" },
  });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 409 });
  return NextResponse.json(result.data);
}
