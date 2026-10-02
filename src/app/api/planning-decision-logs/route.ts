import { NextResponse } from "next/server";
import { z } from "zod";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const item = z.object({ pressCode: z.string().min(1).max(20), selectedOrderId: z.string().uuid().nullable(), selectedScore: z.number(), lookAheadDepth: z.number().int().nonnegative(), candidatesEvaluated: z.number().int().nonnegative(), decisionReasons: z.array(z.string()), penalties: z.array(z.string()), risksBefore: z.array(z.string()), risksAfter: z.array(z.string()), metadata: z.record(z.string(), z.unknown()).default({}) });
const schema = z.object({ decisions: z.array(item).max(100) });

export async function POST(request: Request) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Formato de auditoria inválido." }, { status: 400 });
  const supabase = await createClient();
  const ids: string[] = [];
  for (const decision of parsed.data.decisions) {
    const { data, error } = await supabase.rpc("local_log_planning_decision", { p_token: token, p_press_code: decision.pressCode, p_selected_order_id: decision.selectedOrderId, p_selected_score: decision.selectedScore, p_look_ahead_depth: decision.lookAheadDepth, p_candidates_evaluated: decision.candidatesEvaluated, p_decision_reasons: decision.decisionReasons, p_penalties: decision.penalties, p_risks_before: decision.risksBefore, p_risks_after: decision.risksAfter, p_metadata: decision.metadata });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    if (data) ids.push(data as string);
  }
  return NextResponse.json({ ok: true, ids });
}
