import { NextResponse } from "next/server";
import { z } from "zod";
import { canAccess } from "@/lib/access-control";
import { isDevelopmentSession } from "@/lib/local-auth/development";
import { getCurrentUser, getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";
import { sameRequestOrigin } from "@/modules/planning/agents/request-origin";

export const runtime = "nodejs";

const decisionSchema = z.object({
  snapshotId: z.string().uuid().nullable(),
  suggestedItem: z.string().trim().min(1).max(180),
  selectedItem: z.string().trim().min(1).max(180),
  reason: z.string().trim().max(1000).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

async function context() {
  const token = await getSessionToken();
  const user = await getCurrentUser();
  if (!token || !user || isDevelopmentSession(token)) return null;
  if (!canAccess(user.role, "planning", user.access_overrides)) return "forbidden" as const;
  return { token, supabase: await createClient() };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Entre novamente para consultar o histórico." }, { status: 401 });
  if (ctx === "forbidden") return NextResponse.json({ error: "Acesso não permitido." }, { status: 403 });
  const { data, error } = await ctx.supabase.rpc("local_list_portfolio_analysis_snapshots", { p_token: ctx.token, p_limit: 10 });
  if (error) return NextResponse.json({ error: "O histórico da carteira ainda não está disponível neste banco." }, { status: 503 });
  return NextResponse.json({ snapshots: Array.isArray(data) ? data : [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!sameRequestOrigin(request)) return NextResponse.json({ error: "Origem não permitida." }, { status: 403 });
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Entre novamente para registrar uma decisão." }, { status: 401 });
  if (ctx === "forbidden") return NextResponse.json({ error: "Acesso não permitido." }, { status: 403 });
  const raw = await request.text();
  if (raw.length > 35_000) return NextResponse.json({ error: "Registro muito grande." }, { status: 413 });
  const parsed = decisionSchema.safeParse(JSON.parse(raw || "null"));
  if (!parsed.success) return NextResponse.json({ error: "Revise os dados da decisão." }, { status: 400 });
  const value = parsed.data;
  const { data, error } = await ctx.supabase.rpc("local_record_portfolio_decision", {
    p_token: ctx.token,
    p_snapshot_id: value.snapshotId,
    p_suggested_item: value.suggestedItem,
    p_selected_item: value.selectedItem,
    p_reason: value.reason ?? null,
    p_context_snapshot: value.context ?? {},
  });
  if (error) return NextResponse.json({ error: "Não foi possível registrar a decisão." }, { status: 503 });
  return NextResponse.json({ id: data }, { headers: { "Cache-Control": "no-store" } });
}
