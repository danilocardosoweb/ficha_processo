import { NextResponse } from "next/server";
import { z } from "zod";
import { bootstrapLocalAdministrator, hasLocalUsers } from "@/lib/local-db/auth";
import { isLocalDesktopMode } from "@/lib/local-db/mode";
import { LOCAL_SESSION_COOKIE } from "@/lib/local-auth/types";
import { localSessionCookieOptions } from "@/lib/local-auth/cookie";

const schema = z.object({
  username: z.string().trim().min(3).max(80).regex(/^[a-zA-Z0-9._-]+$/, "Use apenas letras, números, ponto, hífen ou sublinhado."),
  displayName: z.string().trim().min(3).max(120),
  email: z.string().trim().email().max(160).optional().or(z.literal("")),
  password: z.string().min(8).max(200),
});

export const runtime = "nodejs";

export async function GET() {
  if (!isLocalDesktopMode()) return NextResponse.json({ error: "Edição local não habilitada." }, { status: 404 });
  return NextResponse.json({ required: !hasLocalUsers() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!isLocalDesktopMode()) return NextResponse.json({ error: "Edição local não habilitada." }, { status: 404 });
  if (hasLocalUsers()) return NextResponse.json({ error: "O primeiro acesso já foi configurado." }, { status: 409 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Confira os dados informados." }, { status: 400 });

  try {
    const result = bootstrapLocalAdministrator({ ...parsed.data, email: parsed.data.email || null, userAgent: request.headers.get("user-agent") });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(LOCAL_SESSION_COOKIE, result.token, localSessionCookieOptions(60 * 60 * 12));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Não foi possível configurar o primeiro acesso.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
