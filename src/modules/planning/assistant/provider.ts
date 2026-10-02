import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { resolvePlanningAnalysisProvider } from "@/modules/planning/ai/provider";

export function resolveAssistantModel(
  settings: Record<string, unknown>,
  environment: Record<string, string | undefined>,
): { model: LanguageModel; label: string; external: boolean; modelId: string } {
  const provider = resolvePlanningAnalysisProvider(settings, environment);
  const compatible = createOpenAICompatible({
    name: `alupilot-${provider.kind}`,
    apiKey: provider.apiKey || undefined,
    baseURL: provider.baseUrl,
    includeUsage: true,
    supportsStructuredOutputs: provider.supportsStrictSchema,
    headers:
      provider.kind === "openrouter"
        ? {
            "HTTP-Referer": environment.APP_URL || "http://localhost:3000",
            "X-OpenRouter-Title": "AluPilot",
          }
        : undefined,
  });

  return {
    model: compatible.chatModel(provider.model),
    label: provider.label,
    external: provider.external,
    modelId: provider.model,
  };
}

