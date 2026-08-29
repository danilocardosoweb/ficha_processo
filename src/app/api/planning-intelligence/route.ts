import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const schema = z
  .object({
    thermal: z.number().min(0).max(100),
    resources: z.number().min(0).max(100),
    material: z.number().min(0).max(100),
    delivery: z.number().min(0).max(100),
    flow: z.number().min(0).max(100),
    holeSequence: z.number().min(0).max(100),
    shortRun: z.number().min(0).max(100),
    minimumConfidenceSamples: z.number().int().min(1).max(100),
    highHoleThreshold: z.number().int().min(1).max(100),
    maxConsecutiveHighHoleTools: z.number().int().min(1).max(20),
    lowVolumeThresholdKg: z.number().min(1).max(100_000),
    aiEnabled: z.boolean(),
    aiModelMode: z.enum(["auto", "manual"]),
    aiModel: z.string().trim().min(3).max(160),
    aiPersonalityPrompt: z.string().trim().min(40).max(6000),
    aiAnalysisCriteria: z.string().trim().min(20).max(6000),
    aiMaxRecommendations: z.number().int().min(1).max(12),
  })
  .refine(
    (value) =>
      Math.abs(
        value.thermal +
          value.resources +
          value.material +
          value.delivery +
          value.flow +
          value.holeSequence +
          value.shortRun -
          100,
      ) < 0.001,
    { message: "A soma dos critérios deve ser 100%." },
  );

async function context() {
  const token = await getSessionToken();
  if (!token) return null;
  return { token, supabase: await createClient() };
}

export async function GET() {
  const ctx = await context();
  if (!ctx)
    return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const { data, error } = await ctx.supabase.rpc(
    "local_get_planning_intelligence",
    { p_token: ctx.token },
  );
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  const payload =
    data && typeof data === "object"
      ? (data as Record<string, unknown>)
      : { settings: null, summary: null, groups: [], recent: [] };
  return NextResponse.json({
    ...payload,
    aiConfigured: Boolean(process.env.OPENROUTER_API_KEY),
  });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx)
    return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || "Revise os critérios." },
      { status: 400 },
    );
  const value = parsed.data;
  const { error } = await ctx.supabase.rpc(
    "local_save_planning_intelligence_settings_v2",
    {
      p_token: ctx.token,
      p_thermal: value.thermal,
      p_resources: value.resources,
      p_material: value.material,
      p_delivery: value.delivery,
      p_flow: value.flow,
      p_hole_sequence: value.holeSequence,
      p_short_run: value.shortRun,
      p_minimum_confidence_samples: value.minimumConfidenceSamples,
      p_high_hole_threshold: value.highHoleThreshold,
      p_max_consecutive_high_hole_tools: value.maxConsecutiveHighHoleTools,
      p_low_volume_threshold_kg: value.lowVolumeThresholdKg,
      p_ai_enabled: value.aiEnabled,
      p_ai_model_mode: value.aiModelMode,
      p_ai_model: value.aiModel,
      p_ai_personality_prompt: value.aiPersonalityPrompt,
      p_ai_analysis_criteria: value.aiAnalysisCriteria,
      p_ai_max_recommendations: value.aiMaxRecommendations,
    },
  );
  if (error)
    return NextResponse.json({ error: error.message }, { status: 400 });
  const confirmed = await ctx.supabase.rpc("local_get_planning_intelligence", {
    p_token: ctx.token,
  });
  if (confirmed.error)
    return NextResponse.json(
      {
        error:
          "Os critérios foram gravados, mas não foi possível confirmar a leitura.",
      },
      { status: 500 },
    );
  const confirmedPayload =
    confirmed.data && typeof confirmed.data === "object"
      ? (confirmed.data as { settings?: unknown })
      : null;
  if (!confirmedPayload?.settings)
    return NextResponse.json(
      { error: "O banco não devolveu a configuração confirmada." },
      { status: 500 },
    );
  const confirmedSettings = schema.safeParse(confirmedPayload.settings);
  if (!confirmedSettings.success)
    return NextResponse.json(
      {
        error:
          "Os dados foram enviados, mas a confirmação do banco veio incompleta. Tente salvar novamente.",
      },
      { status: 500 },
    );
  const changedFields = Object.keys(value).filter((key) => {
    const field = key as keyof typeof value;
    return confirmedSettings.data[field] !== value[field];
  });
  if (changedFields.length)
    return NextResponse.json(
      {
        error:
          "O banco não confirmou todos os valores alterados. Nada foi mostrado como salvo; tente novamente.",
        changedFields,
      },
      { status: 409 },
    );
  return NextResponse.json({
    ok: true,
    settings: confirmedSettings.data,
    savedAt: new Date().toISOString(),
  });
}
