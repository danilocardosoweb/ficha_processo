import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, getSessionToken } from "@/lib/local-auth/server";
import { isDevelopmentSession } from "@/lib/local-auth/development";

const createSchema = z.object({ fromShift: z.string().trim().min(1).max(80), toShift: z.string().trim().min(1).max(80), summary: z.string().trim().min(3).max(8000), occurrenceIds: z.array(z.string().uuid()).max(200).default([]), handedOverAt: z.string().datetime({ offset: true }).optional() });
async function context() { const token = await getSessionToken(); const user = await getCurrentUser(); if (!token || !user) return null; return { user, development: isDevelopmentSession(token), supabase: await createClient() }; }
function errorResponse(error: unknown, status = 400) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível preparar a passagem de turno." }, { status }); }

export async function GET() {
  const ctx = await context();
  if (!ctx) return errorResponse(new Error("Sessão encerrada."), 401);
  const { data: handovers, error } = await ctx.supabase.from("shift_handovers").select("*").eq("organization_id", ctx.user.organization_id).order("handed_over_at", { ascending: false }).limit(50);
  if (error) return errorResponse(error);
  const ids = (handovers ?? []).map((item) => item.id);
  const { data: links, error: linkError } = ids.length ? await ctx.supabase.from("shift_handover_occurrences").select("handover_id,occurrence_id").in("handover_id", ids) : { data: [], error: null };
  if (linkError) return errorResponse(linkError);
  return NextResponse.json({ handovers: (handovers ?? []).map((handover) => ({ ...handover, occurrence_ids: (links ?? []).filter((link) => link.handover_id === handover.id).map((link) => link.occurrence_id) })) });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return errorResponse(new Error("Sessão encerrada."), 401);
  if (ctx.user.role === "viewer") return errorResponse(new Error("Seu perfil pode consultar, mas não registrar passagem de turno."), 403);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(new Error(parsed.error.issues[0]?.message ?? "Revise a passagem de turno."));
  const value = parsed.data;
  const ids = [...new Set(value.occurrenceIds)];
  if (ids.length) {
    const { data: occurrences, error } = await ctx.supabase.from("operational_occurrences").select("id").eq("organization_id", ctx.user.organization_id).in("id", ids);
    if (error) return errorResponse(error);
    if ((occurrences ?? []).length !== ids.length) return errorResponse(new Error("Uma ou mais ocorrências selecionadas não pertencem à organização."));
  }
  const { data: handover, error } = await ctx.supabase.from("shift_handovers").insert({ organization_id: ctx.user.organization_id, from_shift: value.fromShift, to_shift: value.toShift, summary: value.summary, handed_over_at: value.handedOverAt ?? new Date().toISOString(), created_by_user_id: ctx.development ? null : ctx.user.user_id, created_by_name: ctx.user.display_name }).select("*").single();
  if (error) return errorResponse(error);
  if (ids.length) {
    const { error: linkError } = await ctx.supabase.from("shift_handover_occurrences").insert(ids.map((occurrenceId) => ({ handover_id: handover.id, occurrence_id: occurrenceId })));
    if (linkError) return errorResponse(linkError);
  }
  return NextResponse.json({ handover, occurrence_ids: ids }, { status: 201 });
}
