import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionToken } from "@/lib/local-auth/server";
import { localRoles } from "@/lib/local-auth/types";

const createSchema = z.object({
  username: z.string().trim().min(3).max(60), email: z.union([z.string().email(), z.literal("")]).optional(),
  displayName: z.string().trim().min(2).max(120), role: z.enum(localRoles), machineCodes: z.array(z.string()).max(10),
  password: z.string().min(8).max(200), accessOverrides: z.record(z.string(), z.boolean()).optional(),
});
const updateSchema = z.object({
  id: z.string().uuid(), email: z.union([z.string().email(), z.literal("")]).optional(), displayName: z.string().trim().min(2).max(120), accessOverrides: z.record(z.string(), z.boolean()).optional(),
  role: z.enum(localRoles), machineCodes: z.array(z.string()).max(10), isActive: z.boolean(),
});
const resetSchema = z.object({ id: z.string().uuid(), password: z.string().min(8).max(200) });

async function context() {
  const token = await getSessionToken();
  if (!token) return null;
  return { token, supabase: await createClient() };
}

function userAccessError(message: string) {
  return /28000|sessão inválida|acesso não autorizado/i.test(message)
    ? "A sessão local de desenvolvimento não gerencia usuários persistentes. Para criar ou promover um administrador, entre com uma conta cadastrada no Supabase."
    : message;
}

export async function GET() {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const presence = await ctx.supabase.rpc("local_list_users_with_presence", { p_token: ctx.token });
  if (!presence.error) {
    const overrides = await ctx.supabase.rpc("local_list_user_access_overrides", { p_token: ctx.token });
    const grouped = new Map<string, Record<string, boolean>>();
    for (const row of overrides.data ?? []) grouped.set(row.user_id, { ...(grouped.get(row.user_id) ?? {}), [row.area]: row.enabled });
    return NextResponse.json({ users: (presence.data ?? []).map((user: { id: string }) => ({ ...user, access_overrides: grouped.get(user.id) ?? {} })) });
  }

  const fallback = await ctx.supabase.rpc("local_list_users", { p_token: ctx.token });
  if (fallback.error) return NextResponse.json({ error: userAccessError(fallback.error.message) }, { status: 403 });
  return NextResponse.json({ users: fallback.data ?? [] });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Revise os dados. A senha temporária precisa ter ao menos 8 caracteres." }, { status: 400 });
  const input = parsed.data;
  const { data: userId, error } = await ctx.supabase.rpc("local_create_user", { p_token: ctx.token, p_username: input.username, p_email: input.email || null, p_display_name: input.displayName, p_role: input.role, p_machine_codes: input.machineCodes, p_password: input.password });
  if (error) return NextResponse.json({ error: error.message.includes("duplicate") ? "Usuário ou e-mail já cadastrado." : userAccessError(error.message) }, { status: 400 });
  if (input.accessOverrides && userId) await ctx.supabase.rpc("local_set_user_access_overrides", { p_token: ctx.token, p_user_id: userId, p_overrides: Object.entries(input.accessOverrides).map(([area, enabled]) => ({ area, enabled })) });
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
  if (input.accessOverrides) await ctx.supabase.rpc("local_set_user_access_overrides", { p_token: ctx.token, p_user_id: input.id, p_overrides: Object.entries(input.accessOverrides).map(([area, enabled]) => ({ area, enabled })) });
  return NextResponse.json({ ok: true });
}
