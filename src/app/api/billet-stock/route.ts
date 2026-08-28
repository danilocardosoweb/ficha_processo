import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const upsertSchema = z.object({
  operation: z.literal("upsertLot"),
  id: z.string().uuid().nullable(),
  alloyCode: z.string().trim().min(1).max(30),
  lotCode: z.string().trim().min(1).max(80),
  barWeightKg: z.number().positive().max(100_000),
  totalBars: z.number().int().min(0).max(1_000_000),
  status: z.enum(["available", "blocked", "depleted"]),
  location: z.string().trim().max(120),
  receivedAt: z.string().datetime(),
  notes: z.string().trim().max(500),
});

const reserveSchema = z.object({
  operation: z.literal("reserve"),
  alloyCode: z.string().trim().min(1).max(30),
  bars: z.number().int().positive().max(1_000_000),
  simulationVersionId: z.string().uuid().nullable(),
  productionOrderId: z.string().uuid().nullable(),
  notes: z.string().trim().max(500),
});

const releaseSchema = z.object({
  operation: z.literal("release"),
  reservationId: z.string().uuid(),
});

const schema = z.discriminatedUnion("operation", [upsertSchema, reserveSchema, releaseSchema]);

async function context() {
  const token = await getSessionToken();
  if (!token) return null;
  return { token, supabase: await createClient() };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const { data, error } = await ctx.supabase.rpc("local_list_billet_stock", { p_token: ctx.token });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? { lots: [], summary: [] });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Revise os dados." }, { status: 400 });
  const value = parsed.data;
  const result = value.operation === "upsertLot"
    ? await ctx.supabase.rpc("local_upsert_billet_stock_lot", {
        p_token: ctx.token, p_id: value.id, p_alloy_code: value.alloyCode, p_lot_code: value.lotCode,
        p_bar_weight_kg: value.barWeightKg, p_total_bars: value.totalBars, p_status: value.status,
        p_location: value.location, p_received_at: value.receivedAt, p_notes: value.notes,
      })
    : value.operation === "reserve"
      ? await ctx.supabase.rpc("local_reserve_billet_stock", {
          p_token: ctx.token, p_alloy_code: value.alloyCode, p_bars: value.bars,
          p_simulation_version_id: value.simulationVersionId, p_production_order_id: value.productionOrderId,
          p_notes: value.notes,
        })
      : await ctx.supabase.rpc("local_release_billet_reservation", {
          p_token: ctx.token, p_reservation_id: value.reservationId,
        });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json({ ok: true, data: result.data ?? null });
}
