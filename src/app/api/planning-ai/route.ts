import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const packetSchema = z.object({
  generatedAt: z.string().datetime(),
  mode: z.string().max(30),
  score: z.record(z.string(), z.unknown()),
  machines: z.array(z.record(z.string(), z.unknown())).max(10),
  materials: z.array(z.record(z.string(), z.unknown())).max(50),
  resources: z.record(z.string(), z.unknown()),
  deterministicRecommendations: z
    .array(z.record(z.string(), z.unknown()))
    .max(100),
});

const aiResultSchema = z.object({
  executiveSummary: z.string().min(20).max(1800),
  decision: z.enum([
    "approve",
    "approve_with_adjustments",
    "replan",
    "blocked",
  ]),
  confidence: z.number().min(0).max(100),
  recommendations: z
    .array(
      z.object({
        priority: z.enum(["critical", "high", "medium", "opportunity"]),
        title: z.string().min(3).max(140),
        evidence: z.array(z.string().max(280)).min(1).max(5),
        impact: z.string().min(3).max(500),
        action: z.string().min(3).max(500),
        plainExplanation: z.string().min(10).max(500),
        responsibleRole: z.string().min(2).max(80),
        steps: z.array(z.string().min(3).max(240)).min(1).max(6),
        successCheck: z.string().min(3).max(300),
        affectedTools: z.array(z.string().max(50)).max(20),
      }),
    )
    .max(12),
  assumptions: z.array(z.string().max(300)).max(10),
  missingData: z.array(z.string().max(300)).max(10),
  proposedScenario: z.object({
    title: z.string().min(3).max(140),
    rationale: z.string().min(20).max(1200),
    expectedBenefits: z.array(z.string().max(300)).max(8),
    risks: z.array(z.string().max(300)).max(8),
    machines: z
      .array(
        z.object({
          machineCode: z.string().min(1).max(30),
          orderedOrderIds: z.array(z.string().min(1).max(100)).max(200),
        }),
      )
      .max(10),
  }),
});

const outputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "executiveSummary",
    "decision",
    "confidence",
    "recommendations",
    "assumptions",
    "missingData",
    "proposedScenario",
  ],
  properties: {
    executiveSummary: { type: "string" },
    decision: {
      type: "string",
      enum: ["approve", "approve_with_adjustments", "replan", "blocked"],
    },
    confidence: { type: "number", minimum: 0, maximum: 100 },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "priority",
          "title",
          "evidence",
          "impact",
          "action",
          "plainExplanation",
          "responsibleRole",
          "steps",
          "successCheck",
          "affectedTools",
        ],
        properties: {
          priority: {
            type: "string",
            enum: ["critical", "high", "medium", "opportunity"],
          },
          title: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          impact: { type: "string" },
          action: { type: "string" },
          plainExplanation: { type: "string" },
          responsibleRole: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          successCheck: { type: "string" },
          affectedTools: { type: "array", items: { type: "string" } },
        },
      },
    },
    assumptions: { type: "array", items: { type: "string" } },
    missingData: { type: "array", items: { type: "string" } },
    proposedScenario: {
      type: "object",
      additionalProperties: false,
      required: ["title", "rationale", "expectedBenefits", "risks", "machines"],
      properties: {
        title: { type: "string" },
        rationale: { type: "string" },
        expectedBenefits: { type: "array", items: { type: "string" } },
        risks: { type: "array", items: { type: "string" } },
        machines: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["machineCode", "orderedOrderIds"],
            properties: {
              machineCode: { type: "string" },
              orderedOrderIds: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
    },
  },
} as const;

function normalizeProposedScenario(
  result: z.infer<typeof aiResultSchema>,
  packet: z.infer<typeof packetSchema>,
) {
  const originalByMachine = new Map<string, string[]>();
  for (const rawMachine of packet.machines) {
    const machineCode = String(rawMachine.machineCode ?? "").trim();
    const items = Array.isArray(rawMachine.items) ? rawMachine.items : [];
    const orderIds = items
      .map((rawItem) => {
        const item =
          rawItem && typeof rawItem === "object"
            ? (rawItem as Record<string, unknown>)
            : {};
        return String(item.orderId ?? "").trim();
      })
      .filter(Boolean);
    if (machineCode && orderIds.length)
      originalByMachine.set(machineCode, orderIds);
  }

  const proposedByMachine = new Map(
    result.proposedScenario.machines.map((item) => [item.machineCode, item]),
  );
  const machines = [...originalByMachine.entries()].map(
    ([machineCode, originalOrderIds]) => {
      const allowed = new Set(originalOrderIds);
      const seen = new Set<string>();
      const proposed =
        proposedByMachine.get(machineCode)?.orderedOrderIds ?? [];
      const valid = proposed.filter((orderId) => {
        if (!allowed.has(orderId) || seen.has(orderId)) return false;
        seen.add(orderId);
        return true;
      });
      return {
        machineCode,
        orderedOrderIds: [
          ...valid,
          ...originalOrderIds.filter((orderId) => !seen.has(orderId)),
        ],
      };
    },
  );
  return {
    ...result,
    proposedScenario: { ...result.proposedScenario, machines },
  };
}

function friendlyAiError(cause: unknown) {
  if (cause instanceof z.ZodError || cause instanceof SyntaxError)
    return "O modelo devolveu uma resposta incompleta. Tente novamente; o AluPilot escolherá outro modelo automaticamente.";
  const message =
    cause instanceof Error ? cause.message : "Falha inesperada na análise.";
  if (/json|schema|structured|formato|conte[uú]do/i.test(message))
    return "O modelo não concluiu o cenário no formato esperado. Tente novamente para usar a rota de reserva.";
  if (/timeout|timed out|aborted/i.test(message))
    return "A análise demorou além do limite. Tente novamente em instantes.";
  return "A IA ficou temporariamente indisponível. A simulação e a análise determinística continuam válidas.";
}

async function context() {
  const token = await getSessionToken();
  return token ? { token, supabase: await createClient() } : null;
}

export async function GET() {
  const ctx = await context();
  if (!ctx)
    return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const key = process.env.OPENROUTER_API_KEY;
  try {
    const response = await fetch(
      "https://openrouter.ai/api/v1/models?output_modalities=text&sort=latency-low-to-high",
      {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        next: { revalidate: 3600 },
      },
    );
    if (!response.ok) throw new Error("Catálogo indisponível.");
    const body = (await response.json()) as {
      data?: Array<{
        id: string;
        name: string;
        supported_parameters?: string[];
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };
    const models = (body.data ?? [])
      .filter((item) =>
        item.supported_parameters?.some(
          (parameter) =>
            parameter === "structured_outputs" ||
            parameter === "response_format",
        ),
      )
      .slice(0, 80)
      .map((item) => ({
        id: item.id,
        name: item.name,
        contextLength: item.context_length ?? null,
        pricing: item.pricing ?? null,
      }));
    return NextResponse.json({
      configured: Boolean(key),
      models: [
        {
          id: "openrouter/auto",
          name: "Automático · melhor modelo para a análise",
          contextLength: null,
          pricing: null,
        },
        ...models.filter((item) => item.id !== "openrouter/auto"),
      ],
    });
  } catch {
    return NextResponse.json({
      configured: Boolean(key),
      models: [
        {
          id: "openrouter/auto",
          name: "Automático · melhor modelo para a análise",
          contextLength: null,
          pricing: null,
        },
      ],
    });
  }
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx)
    return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const raw = await request.text();
  if (raw.length > 500_000)
    return NextResponse.json(
      { error: "Pacote de análise excede o limite seguro." },
      { status: 413 },
    );
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw || "null");
  } catch {
    return NextResponse.json(
      { error: "Dados da simulação inválidos." },
      { status: 400 },
    );
  }
  const parsed = packetSchema.safeParse(decoded);
  if (!parsed.success)
    return NextResponse.json(
      { error: "Dados da simulação inválidos." },
      { status: 400 },
    );
  const key = process.env.OPENROUTER_API_KEY;
  if (!key)
    return NextResponse.json(
      {
        error:
          "Integração com IA ainda não configurada no servidor. Cadastre uma nova OPENROUTER_API_KEY.",
      },
      { status: 503 },
    );
  const settingsResult = await ctx.supabase.rpc(
    "local_get_planning_intelligence",
    { p_token: ctx.token },
  );
  if (settingsResult.error)
    return NextResponse.json(
      { error: "Não foi possível carregar os critérios de IA." },
      { status: 400 },
    );
  const settings =
    (settingsResult.data as { settings?: Record<string, unknown> } | null)
      ?.settings ?? {};
  if (!settings.aiEnabled)
    return NextResponse.json(
      { error: "Ative a análise por IA nos Critérios da nota AluPilot." },
      { status: 409 },
    );
  const requestHash = createHash("sha256")
    .update(
      JSON.stringify({
        schemaVersion: 3,
        packet: parsed.data,
        model: settings.aiModel,
        personality: settings.aiPersonalityPrompt,
        criteria: settings.aiAnalysisCriteria,
      }),
    )
    .digest("hex");
  const cached = await ctx.supabase.rpc(
    "local_get_cached_planning_ai_analysis",
    { p_token: ctx.token, p_request_hash: requestHash },
  );
  if (cached.data) return NextResponse.json(cached.data);
  const model =
    settings.aiModelMode === "auto"
      ? "openrouter/auto"
      : String(settings.aiModel || "openrouter/auto");
  const started = Date.now();
  try {
    const modelAttempts =
      settings.aiModelMode === "auto"
        ? ["openrouter/auto", "deepseek/deepseek-v4-flash-0731"]
        : [model];
    let completed:
      | {
          result: z.infer<typeof aiResultSchema>;
          modelUsed: string;
          usage: Record<string, unknown>;
        }
      | undefined;
    let lastFailure: unknown;
    for (const attemptedModel of modelAttempts) {
      try {
        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            signal: AbortSignal.timeout(60_000),
            headers: {
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
              "HTTP-Referer": process.env.APP_URL || "http://localhost:3000",
              "X-OpenRouter-Title": "AluPilot",
            },
            body: JSON.stringify({
              model: attemptedModel,
              messages: [
                {
                  role: "system",
                  content: `${String(settings.aiPersonalityPrompt)}\n\nCRITÉRIOS CONFIGURÁVEIS:\n${String(settings.aiAnalysisCriteria)}\n\nPÚBLICO DA RESPOSTA: operadores, líderes e profissionais do chão de fábrica. Escreva para uma pessoa sem conhecimento de informática ou planejamento. Use português do Brasil, palavras comuns, frases curtas, tom respeitoso e instruções diretas. Explique siglas e termos técnicos quando forem indispensáveis. Não mostre nomes internos de campos, código JSON, camelCase, fórmulas, datas ISO ou textos como "score = 0". Converta 240 minutos em "4 horas" e apresente horários no formato brasileiro.\n\nFORMATO DE CADA ORIENTAÇÃO: o título deve começar com um verbo; plainExplanation explica o problema em linguagem simples; responsibleRole diz quem deve agir; steps contém ações curtas, concretas e na ordem correta; successCheck ensina como confirmar visualmente que o problema foi resolvido. evidence deve conter apenas fatos fáceis de entender.\n\nREGRAS DE SEGURANÇA: use somente os dados fornecidos; diferencie fato, inferência e dado ausente; nunca altere cálculos físicos; bloqueios determinísticos são soberanos; não invente estoques, tempos ou capacidades.`,
                },
                {
                  role: "user",
                  content: `Analise o pacote compacto desta simulação e produza no máximo ${Number(settings.aiMaxRecommendations) || 6} orientações priorizadas. A resposta precisa ser autoexplicativa: diga claramente o que está acontecendo, por que isso pode parar ou atrasar a produção, quem deve agir, o passo a passo e como conferir o resultado. Evite jargões e nunca copie nomes técnicos do pacote para o texto destinado ao usuário.\n\nAlém da análise, crie obrigatoriamente um cenário alternativo de sequenciamento para avaliação do PCP. Em proposedScenario, reorganize apenas os orderId existentes dentro da própria prensa; use cada orderId exatamente uma vez, não transfira ordens entre prensas e não invente ordens. Explique o cenário com linguagem simples. Dê preferência a ações que evitem parada das prensas, respeitando bloqueios físicos, carcaças, BOs, ligas, prazo, cobertura térmica, volume e produtividade. O cenário será recalculado pelo motor determinístico antes de poder ser aprovado.\n\n${JSON.stringify(parsed.data)}`,
                },
              ],
              temperature: 0.2,
              max_tokens: 3000,
              provider: {
                require_parameters: true,
                allow_fallbacks: true,
                data_collection: "deny",
              },
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "alupilot_planning_analysis",
                  strict: true,
                  schema: outputSchema,
                },
              },
            }),
          },
        );
        const body = (await response.json()) as {
          error?: { message?: string };
          model?: string;
          usage?: Record<string, unknown>;
          choices?: Array<{ message?: { content?: string } }>;
        };
        if (!response.ok)
          throw new Error(
            body.error?.message || `OpenRouter respondeu ${response.status}.`,
          );
        const content = body.choices?.[0]?.message?.content;
        if (!content)
          throw new Error("O modelo não devolveu conteúdo estruturado.");
        const validated = normalizeProposedScenario(
          aiResultSchema.parse(JSON.parse(content)),
          parsed.data,
        );
        completed = {
          result: {
            ...validated,
            recommendations: validated.recommendations.slice(
              0,
              Number(settings.aiMaxRecommendations) || 6,
            ),
          },
          modelUsed: body.model ?? attemptedModel,
          usage: body.usage ?? {},
        };
        break;
      } catch (cause) {
        lastFailure = cause;
      }
    }
    if (!completed) {
      throw lastFailure instanceof Error
        ? new Error(
            `Os modelos disponíveis não entregaram uma resposta válida: ${lastFailure.message}`,
          )
        : new Error(
            "Os modelos disponíveis não entregaram uma resposta válida.",
          );
    }
    const durationMs = Date.now() - started;
    await ctx.supabase.rpc("local_save_planning_ai_analysis", {
      p_token: ctx.token,
      p_request_hash: requestHash,
      p_model_requested: model,
      p_model_used: completed.modelUsed,
      p_status: "completed",
      p_input_summary: {
        machines: parsed.data.machines.length,
        materials: parsed.data.materials.length,
      },
      p_result: completed.result,
      p_usage: completed.usage,
      p_duration_ms: durationMs,
      p_error_message: null,
    });
    return NextResponse.json({
      result: completed.result,
      modelUsed: completed.modelUsed,
      usage: completed.usage,
      durationMs,
      createdAt: new Date().toISOString(),
      cached: false,
    });
  } catch (cause) {
    const technicalMessage =
      cause instanceof Error ? cause.message : "Falha inesperada na análise.";
    const message = friendlyAiError(cause);
    await ctx.supabase.rpc("local_save_planning_ai_analysis", {
      p_token: ctx.token,
      p_request_hash: requestHash,
      p_model_requested: model,
      p_model_used: null,
      p_status: "failed",
      p_input_summary: {
        machines: parsed.data.machines.length,
        materials: parsed.data.materials.length,
      },
      p_result: null,
      p_usage: {},
      p_duration_ms: Date.now() - started,
      p_error_message: technicalMessage.slice(0, 1000),
    });
    return NextResponse.json(
      {
        error: message,
      },
      { status: 502 },
    );
  }
}
