import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, getSessionToken } from "@/lib/local-auth/server";
import { isDevelopmentSession } from "@/lib/local-auth/development";

const editSchema = z.object({
  operation: z.literal("update"),
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(8000),
  typeId: z.string().uuid(),
  areaId: z.string().uuid(),
  severity: z.enum(["low", "medium", "high", "critical"]),
  status: z.enum(["open", "in_progress", "resolved", "cancelled"]),
  resolvedAt: z.string().datetime({ offset: true }).nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  causeId: z.string().uuid().nullable().optional(),
  actionId: z.string().uuid().nullable().optional(),
  impactId: z.string().uuid().nullable().optional(),
  destinationId: z.string().uuid().nullable().optional(),
  qualityDefectId: z.string().uuid().nullable().optional(),
  qualityDispositionId: z.string().uuid().nullable().optional(),
  rootCause: z.string().trim().max(4000).nullable().optional(),
  correctiveAction: z.string().trim().max(4000).nullable().optional(),
});
const updateSchema = z.object({ operation: z.literal("add_update"), body: z.string().trim().min(1).max(4000), eventType: z.enum(["comment", "status", "assignment", "system"]).optional().default("comment"), status: z.enum(["open", "in_progress", "resolved", "cancelled"]).optional() });
const linkSchema = z.object({ operation: z.literal("link_stoppage"), stoppageId: z.string().uuid() });
const mutationSchema = z.discriminatedUnion("operation", [editSchema, updateSchema, linkSchema]);

async function context() {
  const token = await getSessionToken();
  const user = await getCurrentUser();
  if (!token || !user) return null;
  return { user, development: isDevelopmentSession(token), supabase: await createClient() };
}
function errorResponse(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível concluir a operação." }, { status });
}

export async function GET(_: Request, route: { params: Promise<{ id: string }> }) {
  const ctx = await context();
  if (!ctx) return errorResponse(new Error("Sessão encerrada."), 401);
  const { id } = await route.params;
  const { data: occurrence, error } = await ctx.supabase.from("operational_occurrences").select("*").eq("id", id).eq("organization_id", ctx.user.organization_id).maybeSingle();
  if (error) return errorResponse(error);
  if (!occurrence) return errorResponse(new Error("Ocorrência não encontrada."), 404);
  const [{ data: stoppage }, { data: updates }, { data: attachments }, { data: catalogs }] = await Promise.all([
    occurrence.stoppage_id ? ctx.supabase.from("machine_stoppages").select("id,machine_code,reason,started_at,ended_at,duration_minutes,status,reported_by_name,closing_observation").eq("id", occurrence.stoppage_id).eq("organization_id", ctx.user.organization_id).maybeSingle() : Promise.resolve({ data: null }),
    ctx.supabase.from("operational_occurrence_updates").select("*").eq("occurrence_id", id).eq("organization_id", ctx.user.organization_id).order("created_at", { ascending: true }),
    ctx.supabase.from("operational_occurrence_attachments").select("*").eq("occurrence_id", id).eq("organization_id", ctx.user.organization_id).order("created_at", { ascending: false }),
    ctx.supabase.from("operational_catalogs").select("id,catalog_type,code,label").eq("organization_id", ctx.user.organization_id).in("catalog_type", ["occurrence_type", "occurrence_area", "occurrence_category", "occurrence_cause", "occurrence_action", "occurrence_impact", "occurrence_destination", "quality_defect", "quality_disposition"]),
  ]);
  const attachmentRows = await Promise.all((attachments ?? []).map(async (attachment) => {
    const signed = await ctx.supabase.storage.from("occurrence-attachments").createSignedUrl(attachment.storage_path, 60 * 60);
    return { ...attachment, url: signed.data?.signedUrl ?? null };
  }));
  return NextResponse.json({ occurrence, stoppage, updates: updates ?? [], attachments: attachmentRows, catalogs: catalogs ?? [] });
}

export async function PATCH(request: Request, route: { params: Promise<{ id: string }> }) {
  const ctx = await context();
  if (!ctx) return errorResponse(new Error("Sessão encerrada."), 401);
  if (ctx.user.role === "viewer") return errorResponse(new Error("Seu perfil pode consultar, mas não alterar ocorrências."), 403);
  const { id } = await route.params;
  const parsed = mutationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(new Error(parsed.error.issues[0]?.message ?? "Revise a atualização."));
  const value = parsed.data;
  const { data: current, error: currentError } = await ctx.supabase.from("operational_occurrences").select("*").eq("id", id).eq("organization_id", ctx.user.organization_id).maybeSingle();
  if (currentError) return errorResponse(currentError);
  if (!current) return errorResponse(new Error("Ocorrência não encontrada."), 404);
  if (value.operation === "link_stoppage") {
    const { data: stoppage, error: stopError } = await ctx.supabase.from("machine_stoppages").select("id,machine_code,started_at").eq("id", value.stoppageId).eq("organization_id", ctx.user.organization_id).eq("is_deleted", false).maybeSingle();
    if (stopError || !stoppage) return errorResponse(stopError ?? new Error("Parada não encontrada."));
    const { data, error } = await ctx.supabase.from("operational_occurrences").update({ stoppage_id: stoppage.id, machine_code: stoppage.machine_code, occurred_at: stoppage.started_at, source: "stoppage", updated_by_name: ctx.user.display_name }).eq("id", id).eq("organization_id", ctx.user.organization_id).is("stoppage_id", null).select("*").single();
    if (error) return errorResponse(/unique|duplicate/i.test(error.message) ? new Error("Esta parada já possui uma ocorrência vinculada.") : error);
    return NextResponse.json({ occurrence: data });
  }
  if (value.operation === "update") {
    const { data: catalogs, error: catalogError } = await ctx.supabase.from("operational_catalogs").select("id,catalog_type").eq("organization_id", ctx.user.organization_id).in("id", [value.typeId, value.areaId]).eq("is_active", true);
    if (catalogError) return errorResponse(catalogError);
    const expectedKinds: Array<[string | null | undefined, string]> = [[value.typeId, "occurrence_type"], [value.areaId, "occurrence_area"], [value.categoryId, "occurrence_category"], [value.causeId, "occurrence_cause"], [value.actionId, "occurrence_action"], [value.impactId, "occurrence_impact"], [value.destinationId, "occurrence_destination"], [value.qualityDefectId, "quality_defect"], [value.qualityDispositionId, "quality_disposition"]];
    if (expectedKinds.some(([id, kind]) => id && catalogs?.find((item) => item.id === id)?.catalog_type !== kind)) return errorResponse(new Error("Um dos catálogos selecionados é inválido."));
    const resolvedAt = value.status === "resolved" || value.status === "cancelled" ? value.resolvedAt ?? new Date().toISOString() : null;
    const { data, error } = await ctx.supabase.from("operational_occurrences").update({ title: value.title, description: value.description, occurrence_type_id: value.typeId, area_id: value.areaId, severity: value.severity, status: value.status, resolved_at: resolvedAt, occurrence_category_id: value.categoryId ?? null, occurrence_cause_id: value.causeId ?? null, occurrence_action_id: value.actionId ?? null, occurrence_impact_id: value.impactId ?? null, occurrence_destination_id: value.destinationId ?? null, quality_defect_id: value.qualityDefectId ?? null, quality_disposition_id: value.qualityDispositionId ?? null, root_cause: value.rootCause || null, corrective_action: value.correctiveAction || null, updated_by_name: ctx.user.display_name }).eq("id", id).eq("organization_id", ctx.user.organization_id).select("*").single();
    if (error) return errorResponse(error);
    if (current.status !== value.status) await ctx.supabase.from("operational_occurrence_updates").insert({ organization_id: ctx.user.organization_id, occurrence_id: id, event_type: "status", body: `Status alterado para ${value.status}.`, from_status: current.status, to_status: value.status, created_by_user_id: ctx.development ? null : ctx.user.user_id, created_by_name: ctx.user.display_name });
    return NextResponse.json({ occurrence: data });
  }
  const nextStatus = value.status ?? current.status;
  const { data: update, error: updateError } = await ctx.supabase.from("operational_occurrence_updates").insert({ organization_id: ctx.user.organization_id, occurrence_id: id, event_type: value.eventType, body: value.body, from_status: value.status && current.status !== value.status ? current.status : null, to_status: value.status ?? null, created_by_user_id: ctx.development ? null : ctx.user.user_id, created_by_name: ctx.user.display_name }).select("*").single();
  if (updateError) return errorResponse(updateError);
  const { data: occurrence, error: occurrenceError } = await ctx.supabase.from("operational_occurrences").update({ status: nextStatus, resolved_at: nextStatus === "resolved" || nextStatus === "cancelled" ? new Date().toISOString() : null, updated_by_name: ctx.user.display_name }).eq("id", id).eq("organization_id", ctx.user.organization_id).select("*").single();
  if (occurrenceError) return errorResponse(occurrenceError);
  return NextResponse.json({ occurrence, update });
}
