import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { isDevelopmentSession } from "@/lib/local-auth/development";
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
  defaultProductivityKgH: z.number().positive().max(2_500, "A produtividade não pode passar de 2.500 kg/h."),
  billetBarWeightKg: z.number().positive().max(100_000),
  extrusionEfficiencyPct: z.number().positive().max(100),
  setupMinutes: z.number().int().min(0).max(1_440),
  alloyChangeMinutes: z.number().int().min(0).max(1_440),
  toolHeatingMinutes: z.number().int().min(0).max(1_440),
  toolChangeMinutes: z.number().int().min(0).max(1_440),
  ovenCount: z.number().int().min(1).max(20),
  ovenSlotsPerOven: z.number().int().min(1).max(100),
});
const calendarSchema = z.object({ operation: z.literal("calendar"), saturdayEnabled: z.boolean(), sundayEnabled: z.boolean() });
const overtimeSchema = z.object({
  operation: z.literal("overtime"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data da hora extra."),
  startTime: timeSchema,
  endTime: timeSchema,
  machineCodes: z.array(z.string().trim().min(1).max(20)).max(20),
  reason: z.string().trim().min(8, "Informe o motivo da hora extra.").max(500),
});
const cancelOvertimeSchema = z.object({ operation: z.literal("cancel-overtime"), id: z.string().uuid() });
const schema = z.discriminatedUnion("operation", [shiftSchema, settingSchema, calendarSchema, overtimeSchema, cancelOvertimeSchema]);

async function context() {
  const token = await getSessionToken();
  if (!token) return null;
  return { token, supabase: await createClient() };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  // O login local de desenvolvimento não possui uma linha em private.local_users.
  // Entregue um cenário mínimo somente para leitura, sem gravar nada no Supabase.
  if (isDevelopmentSession(ctx.token)) {
    return NextResponse.json({
      shifts: [],
      settings: [
        { machine_code: "18", default_productivity_kg_h: 1300, billet_bar_weight_kg: 300, extrusion_efficiency: 0.9, setup_minutes: 15, alloy_change_minutes: 10, tool_heating_minutes: 45, tool_change_minutes: 1, oven_count: 3, oven_slots_per_oven: 4 },
        { machine_code: "19", default_productivity_kg_h: 1300, billet_bar_weight_kg: 300, extrusion_efficiency: 0.9, setup_minutes: 15, alloy_change_minutes: 10, tool_heating_minutes: 45, tool_change_minutes: 1, oven_count: 3, oven_slots_per_oven: 4 },
      ],
      machines: [{ code: "18", name: "Prensa 18" }, { code: "19", name: "Prensa 19" }],
      overtime_periods: [],
      calendar: { saturday_enabled: false, sunday_enabled: false },
    });
  }
  const { data, error } = await ctx.supabase.rpc("local_list_production_settings", { p_token: ctx.token });
  if (error) return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  const { data: calendar } = await ctx.supabase.rpc("local_get_weekend_calendar", { p_token: ctx.token });
  return NextResponse.json({ ...(data ?? { shifts: [], settings: [], machines: [] }), calendar: calendar ?? { saturday_enabled: false, sunday_enabled: false } });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Revise os dados." }, { status: 400 });
  const value = parsed.data;
  const result = value.operation === "calendar"
    ? await ctx.supabase.rpc("local_save_weekend_calendar", { p_token: ctx.token, p_saturday_enabled: value.saturdayEnabled, p_sunday_enabled: value.sundayEnabled })
    : value.operation === "overtime"
    ? await ctx.supabase.rpc("local_register_overtime_period", {
        p_token: ctx.token, p_work_date: value.date, p_start_time: value.startTime, p_end_time: value.endTime,
        p_machine_codes: value.machineCodes, p_reason: value.reason,
      })
    : value.operation === "cancel-overtime"
    ? await ctx.supabase.rpc("local_cancel_overtime_period", { p_token: ctx.token, p_id: value.id })
    : value.operation === "shift"
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
        p_tool_heating_minutes: value.toolHeatingMinutes, p_tool_change_minutes: value.toolChangeMinutes,
        p_oven_count: value.ovenCount, p_oven_slots_per_oven: value.ovenSlotsPerOven,
      });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: result.data ?? null });
}
