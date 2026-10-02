import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

type ScenarioSummary = {
  id?: string;
  status?: string;
  currentVersion?: number;
  updatedAt?: string;
};

type ScenarioSnapshot = {
  scenarioId?: string;
  versionNumber?: number;
  inputs?: { orders?: Array<{ id?: string; machineCode?: string }> };
};

/**
 * Returns the approved simulation snapshots that can identify the active
 * work sequence. This is a compatibility read for databases where the
 * provenance trigger has not yet backfilled existing approvals; it never
 * changes production data or authorizes a scenario.
 */
export async function GET() {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });

  const supabase = await createClient();
  const { data: sessionRows, error: sessionError } = await supabase.rpc("local_get_session", {
    p_token: token,
  });
  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 400 });
  const session = Array.isArray(sessionRows) ? sessionRows[0] as { machine_codes?: string[] } | undefined : undefined;
  const allowedMachineCodes = (session?.machine_codes ?? []).map((code) => String(code));
  const { data: listed, error: listError } = await supabase.rpc("local_list_simulation_scenarios", {
    p_token: token,
  });
  if (listError) return NextResponse.json({ error: listError.message }, { status: 400 });

  const summaries = (Array.isArray(listed) ? listed : []) as ScenarioSummary[];
  const approved = summaries
    .filter((scenario) => scenario.status === "approved" && scenario.id)
    .sort((left, right) => String(right.updatedAt ?? "").localeCompare(String(left.updatedAt ?? "")));

  const snapshots = await Promise.all(approved.map(async (scenario) => {
    const { data, error } = await supabase.rpc("local_get_simulation_scenario", {
      p_token: token,
      p_scenario_id: scenario.id,
      p_version_number: Number.isInteger(scenario.currentVersion) ? scenario.currentVersion : null,
    });
    if (error || !data) return null;
    const snapshot = data as ScenarioSnapshot;
    const orderIds = (snapshot.inputs?.orders ?? [])
      .filter((order) => allowedMachineCodes.length === 0 || (order.machineCode && allowedMachineCodes.includes(order.machineCode)))
      .map((order) => order.id)
      .filter((id): id is string => Boolean(id));
    if (!snapshot.scenarioId || !orderIds.length) return null;
    return {
      scenarioId: snapshot.scenarioId,
      versionNumber: snapshot.versionNumber ?? scenario.currentVersion ?? null,
      orderIds,
    };
  }));

  return NextResponse.json(snapshots.filter(Boolean), {
    headers: { "Cache-Control": "no-store" },
  });
}
