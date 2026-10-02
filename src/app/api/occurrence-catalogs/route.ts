import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, getSessionToken } from "@/lib/local-auth/server";
import { isDevelopmentSession } from "@/lib/local-auth/development";

const catalogTypes = [
  "occurrence_type", "occurrence_area", "occurrence_category", "occurrence_cause", "occurrence_action",
  "occurrence_impact", "occurrence_destination", "occurrence_attachment_type", "quality_defect",
  "quality_cause", "quality_disposition", "maintenance_intervention", "maintenance_cause",
  "maintenance_priority", "maintenance_destination", "process_route", "packaging_type", "billet_supplier",
  "alloy", "cooling_mode", "billet_casing",
] as const;
const kind = z.enum(catalogTypes);
const createSchema = z.object({ catalogType: kind, code: z.string().trim().min(2).max(40).regex(/^[A-Z0-9_-]+$/), label: z.string().trim().min(2).max(120), department: z.string().trim().max(120).nullable().optional(), sortOrder: z.number().int().min(0).max(999).default(100) });
const updateSchema = z.object({ id: z.string().uuid(), label: z.string().trim().min(2).max(120).optional(), department: z.string().trim().max(120).nullable().optional(), sortOrder: z.number().int().min(0).max(999).optional(), isActive: z.boolean().optional() });
async function context() { const token = await getSessionToken(); const user = await getCurrentUser(); if (!token || !user) return null; return { user, development: isDevelopmentSession(token), supabase: await createClient() }; }
function errorResponse(error: unknown, status = 400) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível atualizar os cadastros." }, { status }); }
function canManage(role: string) { return role === "admin" || role === "manager"; }

export async function GET() {
  const ctx = await context();
  if (!ctx) return errorResponse(new Error("Sessão encerrada."), 401);
  const { data, error } = await ctx.supabase.from("operational_catalogs").select("id,catalog_type,code,label,group_code,responsible_department,sort_order,is_active,created_at,updated_at").eq("organization_id", ctx.user.organization_id).in("catalog_type", catalogTypes).order("catalog_type").order("sort_order");
  if (error) return errorResponse(error);
  return NextResponse.json({ catalogs: data ?? [] });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return errorResponse(new Error("Sessão encerrada."), 401);
  if (!canManage(ctx.user.role)) return errorResponse(new Error("Somente administradores e gerentes podem configurar cadastros industriais."), 403);
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(new Error(parsed.error.issues[0]?.message ?? "Revise o cadastro."));
  const value = parsed.data;
  const { data, error } = await ctx.supabase.from("operational_catalogs").insert({ organization_id: ctx.user.organization_id, catalog_type: value.catalogType, code: value.code, label: value.label, responsible_department: value.department || null, sort_order: value.sortOrder, is_active: true, metadata: {} }).select("*").single();
  if (error) return errorResponse(error);
  return NextResponse.json({ catalog: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const ctx = await context();
  if (!ctx) return errorResponse(new Error("Sessão encerrada."), 401);
  if (!canManage(ctx.user.role)) return errorResponse(new Error("Somente administradores e gerentes podem configurar cadastros industriais."), 403);
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(new Error(parsed.error.issues[0]?.message ?? "Revise o cadastro."));
  const { id, ...changes } = parsed.data;
  const payload = { ...(changes.label !== undefined ? { label: changes.label } : {}), ...(changes.department !== undefined ? { responsible_department: changes.department } : {}), ...(changes.sortOrder !== undefined ? { sort_order: changes.sortOrder } : {}), ...(changes.isActive !== undefined ? { is_active: changes.isActive } : {}) };
  const { data, error } = await ctx.supabase.from("operational_catalogs").update(payload).eq("id", id).eq("organization_id", ctx.user.organization_id).in("catalog_type", catalogTypes).select("*").single();
  if (error) return errorResponse(error);
  return NextResponse.json({ catalog: data });
}
