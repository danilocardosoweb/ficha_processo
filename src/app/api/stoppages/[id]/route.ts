import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { isDevelopmentSession } from "@/lib/local-auth/development";
import { createClient } from "@/lib/supabase/server";

const dateTime = z.string().datetime({ offset: true });
const mutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("close"),
    endedAt: dateTime,
    closingObservation: z.string().trim().max(4_000).optional().default(""),
  }),
  z.object({
    action: z.literal("edit"),
    machineCode: z.string().trim().min(1).max(20),
    reason: z.string().trim().min(2).max(500),
    startedAt: dateTime,
    endedAt: dateTime.nullable(),
    initialObservation: z.string().trim().min(1).max(4_000),
    closingObservation: z.string().trim().max(4_000).optional().default(""),
    responsibleDepartment: z.string().trim().max(120).optional().default(""),
    shift: z.string().trim().max(40).optional().default(""),
  }),
  z.object({ action: z.literal("delete"), reason: z.string().trim().min(3).max(1_000) }),
]);

async function context() {
  const token = await getSessionToken();
  if (!token) return null;
  if (isDevelopmentSession(token)) return { token, development: true as const, supabase: null };
  return { token, development: false as const, supabase: await createClient() };
}

function responseFor(error: { code?: string; message?: string } | null) {
  const status = error?.code === "42501" || /não autorizado|sem permissão/i.test(error?.message ?? "") ? 403 : 400;
  return NextResponse.json({ error: error?.message || "Não foi possível concluir a operação." }, { status });
}

export async function GET(_: Request, contextValue: { params: Promise<{ id: string }> }) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  if (ctx.development) return NextResponse.json({ error: "Histórico administrativo indisponível no modo de desenvolvimento." }, { status: 503 });
  const { id } = await contextValue.params;
  const { data, error } = await ctx.supabase!.rpc("local_get_machine_stoppage_details", { p_token: ctx.token, p_stoppage_id: id });
  if (error) return responseFor(error);
  return NextResponse.json(data);
}

export async function PATCH(request: Request, contextValue: { params: Promise<{ id: string }> }) {
  const ctx = await context();
  if (!ctx) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  if (ctx.development) return NextResponse.json({ error: "Alterações administrativas exigem uma sessão conectada." }, { status: 503 });
  const body = mutationSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: body.error.issues[0]?.message || "Revise os dados informados." }, { status: 400 });
  const { id } = await contextValue.params;
  const result = body.data.action === "close"
    ? await ctx.supabase!.rpc("local_close_machine_stoppage", { p_token: ctx.token, p_stoppage_id: id, p_ended_at: body.data.endedAt, p_closing_observation: body.data.closingObservation })
    : body.data.action === "delete"
      ? await ctx.supabase!.rpc("local_delete_machine_stoppage", { p_token: ctx.token, p_stoppage_id: id, p_reason: body.data.reason })
      : await ctx.supabase!.rpc("local_update_machine_stoppage", {
          p_token: ctx.token, p_stoppage_id: id, p_machine_code: body.data.machineCode,
          p_reason: body.data.reason, p_started_at: body.data.startedAt, p_ended_at: body.data.endedAt,
          p_initial_observation: body.data.initialObservation, p_closing_observation: body.data.closingObservation,
          p_responsible_department: body.data.responsibleDepartment, p_shift: body.data.shift,
        });
  if (result.error) return responseFor(result.error);
  return NextResponse.json({ ok: true });
}
