import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  id: z.string().uuid().nullable(),
  toolCode: z.string().trim().min(1).max(80),
  machineCode: z.string().trim().max(20).nullable(),
  sequenceNumber: z.number().int().positive().max(10_000).nullable(),
  carcassCode: z.string().trim().min(1).max(50),
  quantity: z.number().int().positive().max(100),
  notes: z.string().trim().max(500),
  isActive: z.boolean(),
});

async function context() {
  const token = await getSessionToken();
  if (!token) return null;
  return { token, supabase: await createClient() };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const { data, error } = await ctx.supabase.rpc("local_list_tool_carcass_requirements", { p_token: ctx.token });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? { mappings: [], tools: [], carcasses: [], machines: [] });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Revise os dados do vínculo." }, { status: 400 });
  const value = parsed.data;
  const { data, error } = await ctx.supabase.rpc("local_upsert_tool_carcass_requirement", {
    p_token: ctx.token,
    p_id: value.id,
    p_tool_code: value.toolCode,
    p_machine_code: value.machineCode || null,
    p_sequence_number: value.sequenceNumber,
    p_carcass_code: value.carcassCode,
    p_quantity: value.quantity,
    p_notes: value.notes || null,
    p_is_active: value.isActive,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data ?? null });
}
