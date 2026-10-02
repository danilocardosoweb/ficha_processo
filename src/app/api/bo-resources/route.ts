import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { isDevelopmentSession } from "@/lib/local-auth/development";
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
  if (isDevelopmentSession(ctx.token)) {
    const seed: Array<[string, number]> = [["0", 0], ["1", 0], ["1A", 0], ["2", 0], ["2A", 0], ["3", 0], ["4", 0], ["5", 0], ["6", 0], ["6A", 0], ["7", 0], ["8", 0], ["9", 0], ["10", 0], ["11", 0], ["12", 0], ["13", 0], ["15", 0], ["16", 0], ["17", 0], ["18", 0], ["19", 0], ["20", 0], ["21", 0], ["100", 0], ["135", 0], ["336", 0], ["350", 0], ["421", 0], ["529", 0], ["811", 0], ["908", 0]];
    return NextResponse.json(seed.map(([boCode, totalQuantity]) => ({ id: `dev-bo-${boCode}`, boCode, totalQuantity, unavailableQuantity: 0, availableQuantity: totalQuantity, status: "available", location: "Estoque inicial", notes: "Modo de desenvolvimento" })));
  }
  const { data, error } = await ctx.supabase.rpc("local_list_bo_resources", { p_token: ctx.token });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(Array.isArray(data) ? data : []);
}

export async function POST(request: Request) {
  const ctx = await context(); if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  if (isDevelopmentSession(ctx.token)) return NextResponse.json({ error: "O modo de desenvolvimento exibe o estoque inicial em modo somente leitura. Entre com um usuário persistente para alterar." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Revise os dados." }, { status: 400 });
  const value = parsed.data;
  const { data, error } = await ctx.supabase.rpc("local_upsert_bo_resource", { p_token: ctx.token, p_id: value.id, p_bo_code: value.boCode, p_total_quantity: value.totalQuantity, p_unavailable_quantity: value.unavailableQuantity, p_status: value.status, p_location: value.location, p_notes: value.notes });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data ?? null });
}
