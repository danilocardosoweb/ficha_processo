import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { LOCAL_SESSION_COOKIE } from "@/lib/local-auth/types";

const schema = z.object({ login: z.string().trim().min(3).max(120), password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Informe usuário e senha." }, { status: 400 });
  try {
    const supabase = await createClient();
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const { data, error } = await supabase.rpc("local_login", {
      p_login: parsed.data.login,
      p_password: parsed.data.password,
      p_ip: forwarded,
      p_user_agent: request.headers.get("user-agent"),
    });
    if (error) {
      console.error("Falha no local_login:", error);
      return NextResponse.json({ error: "Não foi possível validar o acesso. Verifique se as tabelas e funções de usuários foram aplicadas no Supabase." }, { status: 503 });
    }
    const result = Array.isArray(data) ? data[0] : data;
    if (!result?.session_token) {
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
