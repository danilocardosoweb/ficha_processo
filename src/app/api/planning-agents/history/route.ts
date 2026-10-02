import { NextResponse } from "next/server";
import { sameRequestOrigin } from "@/modules/planning/agents/request-origin";
import { getCurrentUser } from "@/lib/local-auth/server";
import { canAccess } from "@/lib/access-control";
import { createAgentJournal, reviewSchema } from "@/modules/planning/agents/journal";

export const runtime = "nodejs";
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Entre novamente." }, { status: 401 });
  if (!canAccess(user.role, "simulation")) return NextResponse.json({ error: "Acesso não permitido." }, { status: 403 });
  try { return NextResponse.json({ entries: await createAgentJournal().list(user.user_id) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Não foi possível ler o histórico local." }, { status: 503 }); }
}
export async function POST(request: Request) {
  if (!sameRequestOrigin(request)) return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Entre novamente." }, { status: 401 });
  if (!canAccess(user.role, "simulation")) return NextResponse.json({ error: "Acesso não permitido." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 4000) return NextResponse.json({ error: "Registro muito grande." }, { status: 413 });
  try {
    const parsed = reviewSchema.parse(JSON.parse(raw));
    const review = await createAgentJournal().review(user.user_id, parsed);
    return NextResponse.json({ review });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return NextResponse.json({ error: code === "EEXIST" ? "Esta proposta já recebeu uma decisão. Atualize o histórico." : code === "ENOENT" ? "Parecer não encontrado para este usuário." : "Não foi possível registrar. Informe um motivo de 10 a 500 caracteres e tente novamente." }, { status: code === "EEXIST" ? 409 : 400 });
  }
}
