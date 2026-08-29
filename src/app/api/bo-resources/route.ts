import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  id: z.string().uuid().nullable(), boCode: z.string().trim().min(1).max(50),
  totalQuantity: z.number().int().min(0).max(10_000), unavailableQuantity: z.number().int().min(0).max(10_000),
  status: z.enum(["available", "maintenance", "blocked", "inactive"]),
  location: z.string().trim().max(120), notes: z.string().trim().max(500),
}).refine((value) => value.unavailableQuantity <= value.totalQuantity, { message: "A quantidade indisponível não pode superar o total." });

async function context() { const token = await getSessionToken(); return token ? { token, supabase: await createClient() } : null; }

export async function GET() {
  const ctx = await context(); if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const { data, error } = await ctx.supabase.rpc("local_list_bo_resources", { p_token: ctx.token });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(Array.isArray(data) ? data : []);
}

export async function POST(request: Request) {
  const ctx = await context(); if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Revise os dados." }, { status: 400 });
  const value = parsed.data;
  const { data, error } = await ctx.supabase.rpc("local_upsert_bo_resource", { p_token: ctx.token, p_id: value.id, p_bo_code: value.boCode, p_total_quantity: value.totalQuantity, p_unavailable_quantity: value.unavailableQuantity, p_status: value.status, p_location: value.location, p_notes: value.notes });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data ?? null });
}
