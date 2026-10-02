import type { ProviderKind } from "./contracts";

type Environment = Record<string, string | undefined>;

export type PlanningAnalysisProvider = {
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  external: boolean;
  supportsStrictSchema: boolean;
};

function safeConfiguredUrl(value: string | undefined, fallback: string, name: string) {
  const url = new URL(value || fallback);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error(`${name} inválido na configuração do servidor.`);
  return url.toString().replace(/\/$/, "");
}

function restrictedEndpoint(kind: ProviderKind, requested: string, environment: Environment) {
  const url = new URL(requested);
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (kind === "lmstudio") {
    if (!local) throw new Error("O endpoint do LM Studio deve apontar para o servidor local do aplicativo.");
    return url.toString().replace(/\/$/, "");
  }
  if (kind === "openai") {
    if (host !== "api.openai.com") throw new Error("Por segurança, a API direta da OpenAI usa somente api.openai.com.");
    return url.toString().replace(/\/$/, "");
  }
  if (kind === "openrouter") {
    if (host !== "openrouter.ai") throw new Error("Por segurança, o OpenRouter usa somente openrouter.ai.");
    return url.toString().replace(/\/$/, "");
  }
  const approved = environment.OPENCLAW_BASE_URL
    ? new URL(environment.OPENCLAW_BASE_URL).hostname.toLowerCase()
    : "";
  if (url.protocol !== "https:" || !approved || host !== approved)
    throw new Error("O endpoint do OpenClaw precisa usar HTTPS e o host aprovado no servidor.");
  return url.toString().replace(/\/$/, "");
}

/**
 * As chaves nunca atravessam a interface. Endpoints de provedores externos
 * ficam sob configuração do servidor para impedir que o navegador transforme
 * a API em um proxy para endereços arbitrários.
 */
export function resolvePlanningAnalysisProvider(
  settings: Record<string, unknown>,
  environment: Environment,
): PlanningAnalysisProvider {
  const kind = String(settings.aiProvider || "openrouter") as ProviderKind;
  const configuredModel = String(settings.aiModel || "").trim();
  const requestedEndpoint = String(settings.aiProviderEndpoint || "").trim();
  if (kind === "lmstudio") {
    return {
      kind,
      label: "LM Studio local",
      baseUrl: requestedEndpoint
        ? restrictedEndpoint("lmstudio", requestedEndpoint, environment)
        : safeConfiguredUrl(environment.LM_STUDIO_BASE_URL, "http://127.0.0.1:1234/v1", "LM_STUDIO_BASE_URL"),
      apiKey: environment.LM_STUDIO_API_KEY || "",
      model: configuredModel || "local-model",
      external: false,
      supportsStrictSchema: false,
    };
  }
  if (kind === "openai") {
    if (!environment.OPENAI_API_KEY) throw new Error("Configure OPENAI_API_KEY no servidor antes de usar a API da OpenAI.");
    if (!configuredModel) throw new Error("Informe o modelo da OpenAI nos Critérios e analista IA.");
    return {
      kind,
      label: "OpenAI",
      baseUrl: requestedEndpoint
        ? restrictedEndpoint("openai", requestedEndpoint, environment)
        : "https://api.openai.com/v1",
      apiKey: environment.OPENAI_API_KEY,
      model: configuredModel,
      external: true,
      supportsStrictSchema: true,
    };
  }
  if (kind === "openclaw") {
    if (!environment.OPENCLAW_API_KEY) throw new Error("Configure OPENCLAW_API_KEY no servidor antes de usar o OpenClaw.");
    if (!environment.OPENCLAW_BASE_URL) throw new Error("Configure OPENCLAW_BASE_URL no servidor antes de usar o OpenClaw.");
    if (!configuredModel) throw new Error("Informe o modelo do OpenClaw nos Critérios e analista IA.");
    return {
      kind,
      label: "OpenClaw",
      baseUrl: requestedEndpoint
        ? restrictedEndpoint("openclaw", requestedEndpoint, environment)
        : safeConfiguredUrl(environment.OPENCLAW_BASE_URL, "", "OPENCLAW_BASE_URL"),
      apiKey: environment.OPENCLAW_API_KEY,
      model: configuredModel,
      external: true,
      supportsStrictSchema: false,
    };
  }
  if (!environment.OPENROUTER_API_KEY)
    throw new Error("Configure OPENROUTER_API_KEY no servidor ou escolha um provedor local já configurado.");
  const auto = settings.aiModelMode === "auto";
  return {
    kind: "openrouter",
    label: "OpenRouter",
    baseUrl: requestedEndpoint
      ? restrictedEndpoint("openrouter", requestedEndpoint, environment)
      : "https://openrouter.ai/api/v1",
    apiKey: environment.OPENROUTER_API_KEY,
    model: auto ? "openrouter/auto" : configuredModel || "openrouter/auto",
    external: true,
    supportsStrictSchema: true,
  };
}

export function providerAvailability(environment: Environment) {
  return {
    openrouter: Boolean(environment.OPENROUTER_API_KEY),
    lmstudio: Boolean(environment.LM_STUDIO_BASE_URL || environment.LM_STUDIO_API_KEY),
    openai: Boolean(environment.OPENAI_API_KEY),
    openclaw: Boolean(environment.OPENCLAW_BASE_URL && environment.OPENCLAW_API_KEY),
  } satisfies Record<ProviderKind, boolean>;
}
