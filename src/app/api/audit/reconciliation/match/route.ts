import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";
import { decideMatch } from "@/modules/reconciliation/matcher";

function comparable(value: unknown) {
  return String(value ?? "").trim().toUpperCase();
}

function fieldComparison(field: string, erpValue: unknown, appValue: unknown, severity = "warning") {
  const erp = erpValue == null || erpValue === "" ? null : erpValue;
  const app = appValue == null || appValue === "" ? null : appValue;
  const status = erp == null || app == null ? "missing" : comparable(erp) === comparable(app) ? "equal" : "different";
  return { field, erp_value: erp, app_value: app, status, severity: status === "different" ? severity : "info", delta: null };
}

function confrontation(record: Record<string, unknown>, execution?: Record<string, unknown>) {
  if (!execution) return { fieldComparisons: [], discrepancies: [] };
  const comparisons = [
    fieldComparison("order_number", record.order_number, execution.order_number),
    fieldComparison("machine_code", record.machine_code, execution.machine_code),
    fieldComparison("tool_code", record.tool_code, execution.tool_code),
    fieldComparison("tool_sequence", record.tool_sequence, execution.tool_sequence),
    fieldComparison("production_date", record.production_date, String(execution.started_at ?? execution.completed_at ?? "").slice(0, 10)),
    fieldComparison("alloy_code", record.alloy_code, (execution.planning_snapshot as Record<string, unknown> | null)?.alloy_code, "info"),
    fieldComparison("net_weight_kg", record.net_weight_kg, execution.produced_kg, "critical"),
    fieldComparison("produced_quantity", record.produced_quantity, execution.produced_quantity, "warning"),
    fieldComparison("achieved_productivity_kg_h", record.achieved_productivity_kg_h, execution.achieved_productivity_kg_h, "critical"),
  ];
  return { fieldComparisons: comparisons, discrepancies: comparisons.filter((item) => item.status === "different" || item.status === "missing") };
}

export async function POST() {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const client = await createClient();
  const { data, error } = await client.rpc("local_get_audit_reconciliation_data", { p_token: token });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  const payload = (data ?? {}) as { history?: Array<Record<string, unknown>>; external?: Array<Record<string, unknown>> };
  let linked = 0;
  let ambiguous = 0;
  let pending = 0;
  const reviews: Array<Record<string, unknown>> = [];
  for (const record of payload.external ?? []) {
    if (record.matched_execution_id) continue;
    const decision = decideMatch({
      id: String(record.id),
      productionDate: record.production_date as string | null,
      machineCode: record.machine_code as string | null,
      toolCode: record.tool_code as string | null,
      toolSequence: record.tool_sequence as number | null,
      orderNumber: record.order_number as string | null,
      alloyCode: record.alloy_code as string | null,
    }, (payload.history ?? []).map((row) => ({
      id: String(row.id),
      startedAt: row.started_at as string | null,
      completedAt: row.completed_at as string | null,
      machineCode: row.machine_code as string | null,
      toolCode: row.tool_code as string | null,
      toolSequence: row.tool_sequence as number | null,
      orderNumber: row.order_number as string | null,
      alloyCode: (row.planning_snapshot as Record<string, unknown> | null)?.alloy_code as string | null,
      producedKg: row.produced_kg as number | null,
      producedQuantity: row.produced_quantity as number | null,
      achievedProductivityKgH: row.achieved_productivity_kg_h as number | null,
      planningSnapshot: row.planning_snapshot as Record<string, unknown> | null,
    })));
    const topExecution = decision.candidates[0] ? (payload.history ?? []).find((row) => String(row.id) === decision.candidates[0].executionId) : undefined;
    const comparison = confrontation(record, topExecution);
    const autoSelected = decision.classification === "EXACT" || decision.classification === "HIGH_CONFIDENCE" ? decision.selected : null;
    if (decision.classification === "AMBIGUOUS") ambiguous += 1;
    if (!autoSelected) pending += 1;
    if (!autoSelected || decision.classification === "AMBIGUOUS" || decision.classification === "PROBABLE") {
      reviews.push({ recordId: record.id, classification: decision.classification, candidates: decision.candidates.slice(0, 5), fieldComparisons: comparison.fieldComparisons, discrepancies: comparison.discrepancies });
    }
    const evidence = { classification: decision.classification, reasons: decision.selected?.reasons ?? decision.candidates[0]?.reasons ?? [], candidates: decision.candidates.slice(0, 5), field_comparisons: comparison.fieldComparisons, discrepancies: comparison.discrepancies };
    const applied = await client.rpc("local_apply_production_match", {
      p_token: token,
      p_record_id: decision.externalId,
      p_execution_id: autoSelected?.executionId ?? null,
      p_classification: decision.classification,
      p_score: autoSelected?.score ?? decision.candidates[0]?.score ?? 0,
      p_evidence: evidence,
      p_reason: null,
    });
    if (!applied.error && autoSelected) linked += 1;
  }
  return NextResponse.json({ linked, ambiguous, pending, reviews });
}
