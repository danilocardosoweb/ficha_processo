import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  thermal: z.number().min(0).max(100),
  resources: z.number().min(0).max(100),
  material: z.number().min(0).max(100),
  delivery: z.number().min(0).max(100),
  flow: z.number().min(0).max(100),
  minimumConfidenceSamples: z.number().int().min(1).max(100),
}).refine((value) => Math.abs(value.thermal + value.resources + value.material + value.delivery + value.flow - 100) < 0.001, { message: "A soma dos critérios deve ser 100%." });

async function context() {
  const token = await getSessionToken();
  if (!token) return null;
  return { token, supabase: await createClient() };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const { data, error } = await ctx.supabase.rpc("local_get_planning_intelligence", { p_token: ctx.token });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? { settings: null, summary: null, groups: [], recent: [] });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Revise os critérios." }, { status: 400 });
  const value = parsed.data;
  const { error } = await ctx.supabase.rpc("local_save_planning_intelligence_settings", {
    p_token: ctx.token, p_thermal: value.thermal, p_resources: value.resources,
    p_material: value.material, p_delivery: value.delivery, p_flow: value.flow,
    p_minimum_confidence_samples: value.minimumConfidenceSamples,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
