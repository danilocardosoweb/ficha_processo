import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { LOCAL_SESSION_COOKIE } from "@/lib/local-auth/types";
import { developmentLoginMatches, developmentSessionToken, getDevelopmentUser, isDevelopmentAuthEnabled } from "@/lib/local-auth/development";

const schema = z.object({ login: z.string().trim().min(3).max(120), password: z.string().min(1).max(200) });

function infrastructureMessage(error: { code?: unknown; message?: unknown }) {
  const code = String(error.code ?? "").toUpperCase();
  const message = String(error.message ?? "").toLowerCase();

  if (code === "402" || /exceed_cached_egress_quota|service for this project is restricted/.test(message)) {
    return "O banco de dados está temporariamente bloqueado por limite de consumo. Troque para a base ativa ou regularize a cota do Supabase.";
  }
  if (code === "PGRST202" || code === "42883" || /function .*local_login.*does not exist|could not find the function/.test(message)) {
    return "A base de produção ainda não tem a função de login. Aplique as migrações do Supabase e tente novamente.";
  }
  if (code === "42P01" || /relation .*local_users.*does not exist|schema .*private.*does not exist/.test(message)) {
    return "A base de produção ainda não tem as tabelas de usuários. Aplique as migrações do Supabase e tente novamente.";
  }
  if (code === "42501" || /permission denied|execute privilege/.test(message)) {
    return "A função de login existe, mas está sem permissão pública. Reaplique as migrações do Supabase.";
  }
  return "Não foi possível conectar ao serviço de acesso. Confirme as variáveis do Supabase na Vercel e tente novamente.";
}

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Informe usuário e senha." }, { status: 400 });
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({ error: "O servidor está sem a configuração do Supabase. Confira as variáveis de produção na Vercel." }, { status: 503 });
    }
    const supabase = await createClient();
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const { data, error } = await supabase.rpc("local_login", {
      p_login: parsed.data.login,
      p_password: parsed.data.password,
      p_ip: forwarded,
      p_user_agent: request.headers.get("user-agent"),
    });
    if (error) {
      console.error("Falha no local_login:", { code: error.code, message: error.message });
      if (isDevelopmentAuthEnabled() && developmentLoginMatches(parsed.data.login, parsed.data.password)) {
        const response = NextResponse.json({ ok: true, development: true, mustChangePassword: false });
        response.cookies.set(LOCAL_SESSION_COOKIE, developmentSessionToken(), {
          httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12, priority: "high",
        });
        console.warn(`Acesso local de desenvolvimento concedido para ${getDevelopmentUser().username}; o Supabase continua indisponível.`);
        return response;
      }
      return NextResponse.json({ error: infrastructureMessage(error) }, { status: 503 });
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.session_token) {
      if (isDevelopmentAuthEnabled() && developmentLoginMatches(parsed.data.login, parsed.data.password)) {
        const response = NextResponse.json({ ok: true, development: true, mustChangePassword: false });
        response.cookies.set(LOCAL_SESSION_COOKIE, developmentSessionToken(), {
          httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12, priority: "high",
        });
        return response;
      }
      const message = result?.error_code === "INACTIVE" ? "Usuário desativado. Procure um administrador." : result?.error_code === "LOCKED" ? "Acesso bloqueado por 15 minutos após tentativas inválidas." : "Usuário ou senha inválidos.";
      return NextResponse.json({ error: message }, { status: 401 });
    }
    const response = NextResponse.json({ ok: true, mustChangePassword: result.must_change_password });
    response.cookies.set(LOCAL_SESSION_COOKIE, result.session_token, {
      httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 12, priority: "high",
    });
    return response;
  } catch (error) {
    console.error("Erro inesperado ao iniciar sessão:", error);
    return NextResponse.json({ error: "Não foi possível iniciar a sessão. Tente novamente ou procure o administrador." }, { status: 500 });
  }
}
