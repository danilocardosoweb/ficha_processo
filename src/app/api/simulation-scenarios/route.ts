import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const saveSchema = z.object({
  scenarioId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(3, "Informe um nome com pelo menos 3 caracteres.").max(120),
  description: z.string().trim().max(500).default(""),
  machineCode: z.string().trim().min(1).max(20),
  mode: z.enum(["fifo", "optimized", "manual"]),
  requestedStartAt: z.string().datetime(),
  inputSnapshot: z.record(z.string(), z.unknown()),
  rulesSnapshot: z.record(z.string(), z.unknown()),
  resultSnapshot: z.record(z.string(), z.unknown()),
});

async function context() {
  const token = await getSessionToken();
  if (!token) return null;
  return { token, supabase: await createClient() };
}

export async function GET(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const url = new URL(request.url);
  const scenarioId = url.searchParams.get("id");
  const versionValue = url.searchParams.get("version");

  if (scenarioId) {
    const versionNumber = versionValue ? Number(versionValue) : null;
    if (versionValue && (!Number.isInteger(versionNumber) || Number(versionNumber) < 1)) {
      return NextResponse.json({ error: "Versão inválida." }, { status: 400 });
    }
    const { data, error } = await ctx.supabase.rpc("local_get_simulation_scenario", {
      p_token: ctx.token,
      p_scenario_id: scenarioId,
      p_version_number: versionNumber,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (!data) return NextResponse.json({ error: "Cenário não encontrado." }, { status: 404 });
    return NextResponse.json(data);
  }

  const { data, error } = await ctx.supabase.rpc("local_list_simulation_scenarios", { p_token: ctx.token });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(Array.isArray(data) ? data : []);
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Revise os dados do cenário." }, { status: 400 });
  }
  const value = parsed.data;
  const { data, error } = await ctx.supabase.rpc("local_save_simulation_scenario", {
    p_token: ctx.token,
    p_scenario_id: value.scenarioId,
    p_name: value.name,
    p_description: value.description || null,
    p_machine_code: value.machineCode,
    p_mode: value.mode,
    p_requested_start_at: value.requestedStartAt,
    p_input_snapshot: value.inputSnapshot,
    p_rules_snapshot: value.rulesSnapshot,
    p_result_snapshot: value.resultSnapshot,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json(data ?? { ok: true });
}
