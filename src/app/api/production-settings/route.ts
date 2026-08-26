import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const shiftSchema = z.object({
  operation: z.literal("shift"),
  id: z.string().uuid().nullable(),
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(2).max(80),
  startTime: timeSchema,
  endTime: timeSchema,
  breakMinutes: z.number().int().min(0).max(720),
  machineCodes: z.array(z.string().trim().min(1).max(20)).max(20),
  displayOrder: z.number().int().min(1).max(99),
  isActive: z.boolean(),
});
const settingSchema = z.object({
  operation: z.literal("setting"),
  machineCode: z.string().trim().min(1).max(20),
  defaultProductivityKgH: z.number().positive().max(100_000),
  billetBarWeightKg: z.number().positive().max(100_000),
  extrusionEfficiencyPct: z.number().positive().max(100),
  setupMinutes: z.number().int().min(0).max(1_440),
  alloyChangeMinutes: z.number().int().min(0).max(1_440),
  toolHeatingMinutes: z.number().int().min(0).max(1_440),
});
const schema = z.discriminatedUnion("operation", [shiftSchema, settingSchema]);

async function context() {
  const token = await getSessionToken();
  if (!token) return null;
  return { token, supabase: await createClient() };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const { data, error } = await ctx.supabase.rpc("local_list_production_settings", { p_token: ctx.token });
  if (error) return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  return NextResponse.json(data ?? { shifts: [], settings: [], machines: [] });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Revise os dados." }, { status: 400 });
  const value = parsed.data;
  const result = value.operation === "shift"
    ? await ctx.supabase.rpc("local_save_work_shift", {
        p_token: ctx.token, p_id: value.id, p_code: value.code, p_name: value.name,
        p_start_time: value.startTime, p_end_time: value.endTime, p_break_minutes: value.breakMinutes,
        p_machine_codes: value.machineCodes, p_display_order: value.displayOrder, p_is_active: value.isActive,
      })
    : await ctx.supabase.rpc("local_save_machine_load_setting", {
        p_token: ctx.token, p_machine_code: value.machineCode,
        p_default_productivity_kg_h: value.defaultProductivityKgH,
        p_billet_bar_weight_kg: value.billetBarWeightKg,
        p_extrusion_efficiency: value.extrusionEfficiencyPct / 100,
        p_setup_minutes: value.setupMinutes, p_alloy_change_minutes: value.alloyChangeMinutes,
        p_tool_heating_minutes: value.toolHeatingMinutes,
      });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: result.data ?? null });
}
