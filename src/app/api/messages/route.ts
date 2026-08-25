import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionToken } from "@/lib/local-auth/server";
import { localRoles } from "@/lib/local-auth/types";
import { messageAudiences, messagePriorities } from "@/lib/operational-messages/types";

const createSchema = z.object({
  title: z.string().trim().min(3).max(100),
  body: z.string().trim().min(3).max(1000),
  priority: z.enum(messagePriorities),
  audienceType: z.enum(messageAudiences),
  targetUserId: z.string().uuid().nullable().optional(),
  targetRole: z.enum(localRoles).nullable().optional(),
  targetMachineCode: z.string().trim().max(20).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  requiresAck: z.boolean().default(false),
}).superRefine((value, ctx) => {
  if (value.audienceType === "user" && !value.targetUserId) ctx.addIssue({ code: "custom", path: ["targetUserId"], message: "Selecione o usuário." });
  if (value.audienceType === "role" && !value.targetRole) ctx.addIssue({ code: "custom", path: ["targetRole"], message: "Selecione o perfil." });
  if (value.audienceType === "press" && !value.targetMachineCode) ctx.addIssue({ code: "custom", path: ["targetMachineCode"], message: "Selecione a prensa." });
});

const actionSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("mark"), id: z.string().uuid(), action: z.enum(["read", "acknowledge", "dismiss"]) }),
  z.object({ operation: z.literal("deactivate"), id: z.string().uuid() }),
]);

async function context() {
  const token = await getSessionToken();
  if (!token) return null;
  return { token, supabase: await createClient() };
}

export async function GET(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const adminView = new URL(request.url).searchParams.get("view") === "admin";
  if (adminView) {
    const [{ data: messages, error }, { data: targets, error: targetError }] = await Promise.all([
      ctx.supabase.rpc("local_list_sent_operational_messages", { p_token: ctx.token }),
      ctx.supabase.rpc("local_list_operational_message_targets", { p_token: ctx.token }),
    ]);
    if (error || targetError) return NextResponse.json({ error: "Acesso não autorizado." }, { status: 403 });
    return NextResponse.json({ messages: messages ?? [], targets: targets ?? [] });
  }
  const { data, error } = await ctx.supabase.rpc("local_list_operational_messages", { p_token: ctx.token });
  if (error) return NextResponse.json({ error: "Não foi possível carregar os avisos." }, { status: 400 });
  return NextResponse.json({ messages: data ?? [] });
}

export async function POST(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message || "Revise a mensagem." }, { status: 400 });
  const value = parsed.data;
  const { data, error } = await ctx.supabase.rpc("local_create_operational_message", {
    p_token: ctx.token,
    p_title: value.title,
    p_body: value.body,
    p_priority: value.priority,
    p_audience_type: value.audienceType,
    p_target_user_id: value.targetUserId ?? null,
    p_target_role: value.targetRole ?? null,
    p_target_machine_code: value.targetMachineCode ?? null,
    p_expires_at: value.expiresAt ?? null,
    p_requires_ack: value.requiresAck,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: data });
}

export async function PATCH(request: Request) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  const value = parsed.data;
  const result = value.operation === "mark"
    ? await ctx.supabase.rpc("local_mark_operational_message", { p_token: ctx.token, p_message_id: value.id, p_action: value.action })
    : await ctx.supabase.rpc("local_deactivate_operational_message", { p_token: ctx.token, p_message_id: value.id });
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
