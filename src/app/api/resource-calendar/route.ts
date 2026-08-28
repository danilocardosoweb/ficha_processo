import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  id: z.string().uuid().nullable(),
  resourceType: z.enum(["press", "oven", "tool", "carcass"]),
  resourceCode: z.string().trim().min(1).max(50),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  reason: z.string().trim().min(2).max(200),
  status: z.enum(["active", "cancelled"]),
  notes: z.string().trim().max(500),
}).refine((value) => new Date(value.endsAt) > new Date(value.startsAt), { message: "O fim deve ser posterior ao início." });

async function context() { const token = await getSessionToken(); return token ? { token, supabase: await createClient() } : null; }

export async function GET(request: Request) {
  const ctx = await context(); if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const url = new URL(request.url);
  const from = url.searchParams.get("from") ?? new Date().toISOString();
  const to = url.searchParams.get("to") ?? new Date(Date.now() + 90 * 86_400_000).toISOString();
  const { data, error } = await ctx.supabase.rpc("local_list_resource_unavailability", { p_token: ctx.token, p_from: from, p_to: to });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(Array.isArray(data) ? data : []);
}

export async function POST(request: Request) {
  const ctx = await context(); if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Revise os dados." }, { status: 400 });
  const value = parsed.data;
  const { data, error } = await ctx.supabase.rpc("local_upsert_resource_unavailability", {
    p_token: ctx.token, p_id: value.id, p_resource_type: value.resourceType, p_resource_code: value.resourceCode,
    p_starts_at: value.startsAt, p_ends_at: value.endsAt, p_reason: value.reason, p_status: value.status, p_notes: value.notes,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data ?? null });
}
