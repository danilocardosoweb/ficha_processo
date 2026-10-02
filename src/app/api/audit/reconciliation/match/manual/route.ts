import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const inputSchema = z.object({
  recordId: z.string().uuid(),
  executionId: z.string().uuid(),
  reason: z.string().trim().min(5).max(1_000),
});

export async function POST(request: Request) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Informe o vínculo e o motivo." }, { status: 400 });
  const client = await createClient();
  const { data: audit, error: auditError } = await client.rpc("local_get_audit_reconciliation_data", { p_token: token });
  if (auditError) return NextResponse.json({ error: auditError.message }, { status: 400 });
  const payload = (audit ?? {}) as { external?: Array<Record<string, unknown>>; history?: Array<Record<string, unknown>> };
  const record = (payload.external ?? []).find((item) => String(item.id) === parsed.data.recordId);
  const execution = (payload.history ?? []).find((item) => String(item.id) === parsed.data.executionId);
  if (!record || !execution) return NextResponse.json({ error: "Registro ou execução não encontrado no escopo atual." }, { status: 404 });

  const { data, error } = await client.rpc("local_apply_production_match", {
    p_token: token,
    p_record_id: parsed.data.recordId,
    p_execution_id: parsed.data.executionId,
    p_classification: record.match_classification === "AMBIGUOUS" ? "AMBIGUOUS" : "PROBABLE",
    p_score: Number(record.match_confidence ?? (record.match_evidence as { candidates?: Array<{ score?: number }> } | null)?.candidates?.[0]?.score ?? 0),
    p_evidence: {
      ...(record.match_evidence as Record<string, unknown> | null ?? {}),
      manual_execution_id: parsed.data.executionId,
    },
    p_reason: parsed.data.reason,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json(data);
}
