import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, getSessionToken } from "@/lib/local-auth/server";
import { isDevelopmentSession } from "@/lib/local-auth/development";

const createSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(8000),
  typeId: z.string().uuid(),
  areaId: z.string().uuid(),
  severity: z.enum(["low", "medium", "high", "critical"]).default("medium"),
  machineCode: z.string().trim().max(20).nullable().optional(),
  occurredAt: z.string().datetime({ offset: true }).nullable().optional(),
  stoppageId: z.string().uuid().nullable().optional(),
  source: z.enum(["manual", "stoppage", "production", "system"]).optional().default("manual"),
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

const catalogTypes = [
  "occurrence_type", "occurrence_area", "occurrence_category", "occurrence_cause", "occurrence_action",
  "occurrence_impact", "occurrence_destination", "occurrence_attachment_type", "quality_defect",
  "quality_cause", "quality_disposition", "maintenance_intervention", "maintenance_cause",
  "maintenance_priority", "maintenance_destination", "process_route", "packaging_type", "billet_supplier",
  "alloy", "cooling_mode",
] as const;

async function context() {
  const token = await getSessionToken();
  const user = await getCurrentUser();
  if (!token || !user) return null;
  return { user, token, supabase: await createClient(), development: isDevelopmentSession(token) };
}

function errorResponse(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Não foi possível concluir a operação.";
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const ctx = await context();
  if (!ctx) return errorResponse(new Error("Sessão encerrada."), 401);
  const params = new URL(request.url).searchParams;
  let query = ctx.supabase.from("operational_occurrences").select("*").eq("organization_id", ctx.user.organization_id).order("occurred_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(500);
  const status = params.get("status");
  if (status && ["open", "in_progress", "resolved", "cancelled"].includes(status)) query = query.eq("status", status);
  const typeId = params.get("typeId");
  if (typeId) query = query.eq("occurrence_type_id", typeId);
  const areaId = params.get("areaId");
  if (areaId) query = query.eq("area_id", areaId);
  const from = params.get("from");
  if (from) query = query.gte("occurred_at", from);
  const to = params.get("to");
  if (to) query = query.lte("occurred_at", to);
  const [{ data: occurrences, error }, { data: catalogs, error: catalogError }, { data: stoppages, error: stoppageError }] = await Promise.all([
    query,
    ctx.supabase.from("operational_catalogs").select("id,catalog_type,code,label,group_code,responsible_department,sort_order,is_active").eq("organization_id", ctx.user.organization_id).in("catalog_type", catalogTypes).eq("is_active", true).order("sort_order"),
    ctx.supabase.from("machine_stoppages").select("id,machine_code,reason,started_at,ended_at,duration_minutes,status,reported_by_name").eq("organization_id", ctx.user.organization_id).eq("is_deleted", false).order("started_at", { ascending: false }).limit(300),
  ]);
  if (error || catalogError || stoppageError) return errorResponse(error ?? catalogError ?? stoppageError);
  const rows = (occurrences ?? []) as Array<Record<string, unknown>>;
  const search = params.get("search")?.trim().toLocaleLowerCase("pt-BR");
  const filtered = search ? rows.filter((row) => [row.title, row.description, row.machine_code, row.status].some((value) => String(value ?? "").toLocaleLowerCase("pt-BR").includes(search))) : rows;
  const ids = filtered.map((row) => String(row.id));
  const [{ data: updates }, { data: attachments }] = ids.length ? await Promise.all([
    ctx.supabase.from("operational_occurrence_updates").select("id,occurrence_id,event_type,body,from_status,to_status,created_by_name,created_at").eq("organization_id", ctx.user.organization_id).in("occurrence_id", ids).order("created_at", { ascending: true }),
    ctx.supabase.from("operational_occurrence_attachments").select("id,occurrence_id,file_name,mime_type,byte_size,uploaded_by_name,created_at,storage_path").eq("organization_id", ctx.user.organization_id).in("occurrence_id", ids).order("created_at", { ascending: false }),
  ]) : [{ data: [] }, { data: [] }];
  const byType = (catalogType: string) => (catalogs ?? []).filter((row) => row.catalog_type === catalogType);
  return NextResponse.json({ occurrences: filtered, catalogs: {
    types: byType("occurrence_type"), areas: byType("occurrence_area"), categories: byType("occurrence_category"), causes: byType("occurrence_cause"), actions: byType("occurrence_action"), impacts: byType("occurrence_impact"), destinations: byType("occurrence_destination"), attachmentTypes: byType("occurrence_attachment_type"), qualityDefects: byType("quality_defect"), qualityCauses: byType("quality_cause"), qualityDispositions: byType("quality_disposition"), maintenanceInterventions: byType("maintenance_intervention"), maintenanceCauses: byType("maintenance_cause"), maintenancePriorities: byType("maintenance_priority"), maintenanceDestinations: byType("maintenance_destination"), processRoutes: byType("process_route"), packagingTypes: byType("packaging_type"), billetSuppliers: byType("billet_supplier"), alloys: byType("alloy"), coolingModes: byType("cooling_mode"),
  }, stoppages: stoppages ?? [], updates: updates ?? [], attachments: attachments ?? [] });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return errorResponse(new Error("Sessão encerrada."), 401);
  if (ctx.user.role === "viewer") return errorResponse(new Error("Seu perfil pode consultar, mas não criar ocorrências."), 403);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(new Error(parsed.error.issues[0]?.message ?? "Revise os dados da ocorrência."));
  const value = parsed.data;
  if (!value.stoppageId && (!value.machineCode || !value.occurredAt)) return errorResponse(new Error("Informe a prensa e o horário da ocorrência quando ela não estiver vinculada a uma parada."));
  const optionalCatalogIds = [value.typeId, value.areaId, value.categoryId, value.causeId, value.actionId, value.impactId, value.destinationId, value.qualityDefectId, value.qualityDispositionId].filter((id): id is string => Boolean(id));
  const { data: catalogs, error: catalogError } = await ctx.supabase.from("operational_catalogs").select("id,catalog_type").eq("organization_id", ctx.user.organization_id).in("id", optionalCatalogIds).eq("is_active", true);
  if (catalogError) return errorResponse(catalogError);
  const expectedKinds: Array<[string | null | undefined, string]> = [[value.typeId, "occurrence_type"], [value.areaId, "occurrence_area"], [value.categoryId, "occurrence_category"], [value.causeId, "occurrence_cause"], [value.actionId, "occurrence_action"], [value.impactId, "occurrence_impact"], [value.destinationId, "occurrence_destination"], [value.qualityDefectId, "quality_defect"], [value.qualityDispositionId, "quality_disposition"]];
  if (expectedKinds.some(([id, kind]) => id && catalogs?.find((item) => item.id === id)?.catalog_type !== kind)) return errorResponse(new Error("Um dos catálogos selecionados é inválido."));
  let linkedStoppage: Record<string, unknown> | null = null;
  if (value.stoppageId) {
    const result = await ctx.supabase.from("machine_stoppages").select("id,machine_code,started_at,ended_at").eq("id", value.stoppageId).eq("organization_id", ctx.user.organization_id).eq("is_deleted", false).maybeSingle();
    if (result.error) return errorResponse(result.error);
    if (!result.data) return errorResponse(new Error("A parada selecionada não existe ou não pertence à organização."));
    linkedStoppage = result.data as Record<string, unknown>;
  }
  const { data, error } = await ctx.supabase.from("operational_occurrences").insert({
    organization_id: ctx.user.organization_id,
    stoppage_id: value.stoppageId ?? null,
    occurrence_type_id: value.typeId,
    area_id: value.areaId,
    occurrence_category_id: value.categoryId ?? null,
    occurrence_cause_id: value.causeId ?? null,
    occurrence_action_id: value.actionId ?? null,
    occurrence_impact_id: value.impactId ?? null,
    occurrence_destination_id: value.destinationId ?? null,
    quality_defect_id: value.qualityDefectId ?? null,
    quality_disposition_id: value.qualityDispositionId ?? null,
    root_cause: value.rootCause || null,
    corrective_action: value.correctiveAction || null,
    title: value.title,
    description: value.description,
    severity: value.severity,
    source: value.stoppageId ? "stoppage" : value.source,
    machine_code: linkedStoppage ? linkedStoppage.machine_code : value.machineCode || null,
    occurred_at: linkedStoppage ? linkedStoppage.started_at : value.occurredAt ?? new Date().toISOString(),
    created_by_user_id: ctx.development ? null : ctx.user.user_id,
    created_by_name: ctx.user.display_name,
    updated_by_name: ctx.user.display_name,
  }).select("*").single();
  if (error) return errorResponse(/duplicate|unique/i.test(error.message) ? new Error("Esta parada já possui uma ocorrência vinculada.") : error);
  return NextResponse.json({ occurrence: data }, { status: 201 });
}
