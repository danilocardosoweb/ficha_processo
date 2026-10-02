import "server-only";

import type { LocalUser } from "@/lib/local-auth/types";

// A chave é explícita para permitir o ambiente local mesmo quando o app é
// executado com `next start` (modo production). Nunca habilite isso no deploy.
const enabled = process.env.NODE_ENV !== "production" && process.env.LOCAL_DEV_AUTH_ENABLED === "true";
const token = process.env.LOCAL_DEV_AUTH_TOKEN || "dev-local-session";

export function isDevelopmentAuthEnabled() { return enabled; }
export function isDevelopmentSession(value: string | null) { return enabled && value === token; }
export function developmentLoginMatches(login: string, password: string) {
  return enabled && login === (process.env.LOCAL_DEV_AUTH_LOGIN || "dev") && password === (process.env.LOCAL_DEV_AUTH_PASSWORD || "AluDev2026");
}
export function developmentSessionToken() { return token; }
export function getDevelopmentUser(): LocalUser {
  const now = new Date();
  return {
    user_id: "00000000-0000-4000-8000-000000000001",
    organization_id: process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID || "00000000-0000-4000-8000-000000000002",
    username: process.env.LOCAL_DEV_AUTH_LOGIN || "dev",
    email: "dev@localhost",
    display_name: "Usuário de desenvolvimento",
    role: "admin",
    machine_codes: [],
    must_change_password: false,
    expires_at: new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString(),
  };
}
