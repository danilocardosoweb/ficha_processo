import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionToken } from "@/lib/local-auth/server";
import { localRoles } from "@/lib/local-auth/types";

const createSchema = z.object({
  username: z.string().trim().min(3).max(60), email: z.union([z.string().email(), z.literal("")]).optional(),
  displayName: z.string().trim().min(2).max(120), role: z.enum(localRoles), machineCodes: z.array(z.string()).max(10),
  password: z.string().min(8).max(200),
});
const updateSchema = z.object({
  id: z.string().uuid(), email: z.union([z.string().email(), z.literal("")]).optional(), displayName: z.string().trim().min(2).max(120),
  role: z.enum(localRoles), machineCodes: z.array(z.string()).max(10), isActive: z.boolean(),
});
const resetSchema = z.object({ id: z.string().uuid(), password: z.string().min(8).max(200) });

async function context() {
  const token = await getSessionToken();
  if (!token) return null;
  return { token, supabase: await createClient() };
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const presence = await ctx.supabase.rpc("local_list_users_with_presence", { p_token: ctx.token });
  if (!presence.error) return NextResponse.json({ users: presence.data ?? [] });

  const fallback = await ctx.supabase.rpc("local_list_users", { p_token: ctx.token });
  if (fallback.error) return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
  return NextResponse.json({ users: fallback.data ?? [] });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revise os dados. A senha temporária precisa ter ao menos 8 caracteres." }, { status: 400 });
  const input = parsed.data;
  const { error } = await ctx.supabase.rpc("local_create_user", { p_token: ctx.token, p_username: input.username, p_email: input.email || null, p_display_name: input.displayName, p_role: input.role, p_machine_codes: input.machineCodes, p_password: input.password });
  if (error) return NextResponse.json({ error: error.message.includes("duplicate") ? "Usuário ou e-mail já cadastrado." : error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (body?.operation === "reset-password") {
    const parsed = resetSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Senha temporária inválida." }, { status: 400 });
    const { error } = await ctx.supabase.rpc("local_reset_password", { p_token: ctx.token, p_user_id: parsed.data.id, p_password: parsed.data.password });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Revise os dados do usuário." }, { status: 400 });
  const input = parsed.data;
  const { error } = await ctx.supabase.rpc("local_update_user", { p_token: ctx.token, p_user_id: input.id, p_email: input.email || null, p_display_name: input.displayName, p_role: input.role, p_machine_codes: input.machineCodes, p_is_active: input.isActive });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
