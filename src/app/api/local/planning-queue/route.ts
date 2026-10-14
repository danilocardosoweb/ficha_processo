import { NextResponse } from "next/server";
import { canAccess } from "@/lib/access-control";
import { getCurrentUser } from "@/lib/local-auth/server";
import { isLocalDesktopMode } from "@/lib/local-db/mode";
import {
  endAutomaticPlanningTurn,
  ensureAutomaticPlanningTurn,
  getPlanningQueueStatus,
  heartbeatPlanningTurn,
  PlanningQueueError,
  recoverStalePlanningTurn,
} from "@/lib/local-db/shared-planning-queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const recoveryRoles = new Set(["admin", "manager"]);

async function getPlanningActor() {
  if (!isLocalDesktopMode()) return { actor: null, response: NextResponse.json({ error: "Este recurso existe somente no aplicativo local." }, { status: 404 }) };
  const user = await getCurrentUser();
  if (!user) return { actor: null, response: NextResponse.json({ error: "Sessão encerrada. Entre novamente." }, { status: 401 }) };
  if (!canAccess(user.role, "planning", user.access_overrides)) {
    return { actor: null, response: NextResponse.json({ error: "Seu perfil não pode acessar a fila de programação." }, { status: 403 }) };
  }
  return { actor: { username: user.username, display_name: user.display_name, role: user.role }, response: null };
}

function actionError(error: unknown) {
  if (error instanceof PlanningQueueError) return NextResponse.json({ error: error.message }, { status: error.status });
  return NextResponse.json({ error: "Não foi possível concluir a ação na fila. Atualize a tela e tente novamente." }, { status: 500 });
}

export async function GET() {
  const { actor, response } = await getPlanningActor();
  if (response || !actor) return response;
  try {
    const status = await getPlanningQueueStatus(actor);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return actionError(error);
  }
}

export async function POST(request: Request) {
  const { actor, response } = await getPlanningActor();
  if (response || !actor) return response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "A solicitação está incompleta." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "A solicitação está incompleta." }, { status: 400 });
  const input = body as Record<string, unknown>;
  const requestId = typeof input.requestId === "string" ? input.requestId : "";
  const token = typeof input.token === "string" ? input.token : "";

  try {
    switch (input.action) {
      case "ensure":
        return NextResponse.json(await ensureAutomaticPlanningTurn(actor), { headers: { "Cache-Control": "no-store" } });
      case "auto-release":
        if (!requestId) return NextResponse.json({ error: "A solicitação automática não foi identificada." }, { status: 400 });
        return NextResponse.json(await endAutomaticPlanningTurn(actor, requestId, token || undefined));
      case "heartbeat":
        if (!requestId || !token) return NextResponse.json({ error: "Atualize a tela antes de renovar sua vez." }, { status: 400 });
        return NextResponse.json(await heartbeatPlanningTurn(actor, requestId, token));
      case "recover": {
        if (!recoveryRoles.has(actor.role)) return NextResponse.json({ error: "Somente administrador ou gerente pode recuperar uma reserva parada." }, { status: 403 });
        const reason = typeof input.reason === "string" ? input.reason.trim() : "";
        if (reason.length < 10) return NextResponse.json({ error: "Informe um motivo com pelo menos 10 caracteres." }, { status: 400 });
        return NextResponse.json(await recoverStalePlanningTurn(actor, reason));
      }
      default:
        return NextResponse.json({ error: "Ação da fila desconhecida." }, { status: 400 });
    }
  } catch (error) {
    return actionError(error);
  }
}
