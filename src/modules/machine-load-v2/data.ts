import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getSessionToken } from "@/lib/local-auth/server";
import type { LocalUser } from "@/lib/local-auth/types";
import { buildProgram, type OrderRecord, type ToolRecord, type ProgramSnapshot } from "./domain";
import { evaluateTemporalResources, type ResourceCapacity, type TemporalResourceSnapshot } from "./evaluator";

export async function readProgram(user: LocalUser): Promise<ProgramSnapshot> {
  const snapshot: ProgramSnapshot = { readAt: new Date().toISOString(), rows: [], warnings: [], error: null };
  try {
    const client = await createClient();
    const orders: OrderRecord[] = [];
    // Stable pages avoid silently cutting off the queue at the API row limit.
    for (let offset = 0; ; offset += 500) {
      let query = client.from("production_orders")
        .select("id,order_number,machine_code,tool_code,sequence,alloy_code,target_kg,produced_kg,status,carcass_code,bo_code,last_productivity_kg_h,actual_start,source_data")
        .eq("organization_id", user.organization_id).eq("is_active", true)
        .in("status", ["planned", "released", "in_progress", "paused"]);
      if (user.machine_codes.length) query = query.in("machine_code", user.machine_codes);
      const result = await query.order("id").range(offset, offset + 499).abortSignal(AbortSignal.timeout(15000));
      if (result.error) throw new Error("orders-unavailable");
      orders.push(...result.data as OrderRecord[]);
      if (result.data.length < 500) break;
    }
    const tools: ToolRecord[] = [];
    try {
      if (orders.length) for (let offset = 0; ; offset += 500) {
        const result = await client.from("tools")
          .select("code,matrix_code,sequence_number,source_available,carcass_code,bo,productivity_kg_h")
          .eq("organization_id", user.organization_id).order("id").range(offset, offset + 499)
          .abortSignal(AbortSignal.timeout(15000));
        if (result.error) throw new Error("tools-unavailable");
        tools.push(...result.data as ToolRecord[]);
        if (result.data.length < 500) break;
      }
      const cycles = await client.from("tool_heating_cycles")
        .select("tool_code,tool_type,status,entered_at")
        .eq("organization_id", user.organization_id)
        .in("status", ["heating", "released"])
        .order("entered_at", { ascending: false })
        .limit(1000)
        .abortSignal(AbortSignal.timeout(15000));
      if (!cycles.error) {
        const types = new Map<string, "solid" | "tubular">();
        for (const cycle of (cycles.data ?? []) as Array<{ tool_code: string; tool_type: "solid" | "tubular" | null }>) {
          if (cycle.tool_type && !types.has(cycle.tool_code.toUpperCase())) types.set(cycle.tool_code.toUpperCase(), cycle.tool_type);
        }
        for (const tool of tools) tool.tool_type = types.get(tool.code.toUpperCase()) ?? null;
      } else {
        snapshot.warnings.push("Tipo sólida/tubular não pôde ser confirmado pelos ciclos térmicos.");
      }
    } catch {
      tools.length = 0;
      snapshot.warnings.push("Cadastro de ferramentas indisponível. Os dados das ordens continuam visíveis; os complementos não foram confirmados.");
    }
    snapshot.rows = buildProgram(orders, tools);
    const token = await getSessionToken();
    const resources: TemporalResourceSnapshot = { carcaças: [], bos: [], fornos: [] };
    if (token) {
      const now = new Date();
      const [carcassResult, boResult, ovenResult, cycleResult, calendarResult] = await Promise.all([
        client.rpc("local_list_press_carcass_resources", { p_token: token }),
        client.rpc("local_list_bo_resources", { p_token: token }),
        client.from("tool_ovens").select("machine_code,position_count,is_active").eq("organization_id", user.organization_id).eq("is_active", true),
        client.from("tool_heating_cycles").select("machine_code,status,entered_at,expected_ready_at,maximum_due_at").eq("organization_id", user.organization_id).eq("status", "heating"),
        client.rpc("local_list_resource_unavailability", { p_token: token, p_from: now.toISOString(), p_to: new Date(now.getTime() + 90 * 86_400_000).toISOString() }),
      ]);
      const normalize = (value: unknown, codeKeys: string[]): ResourceCapacity[] => {
        if (!Array.isArray(value)) return [];
        return value.map(item => {
          const row = item as Record<string, unknown>;
          const code = codeKeys.map(key => row[key]).find(value => typeof value === "string" && value.trim()) as string | undefined;
          const total = Number(row.totalQuantity ?? row.total_quantity ?? row.capacity ?? NaN);
          const unavailable = Number(row.unavailableQuantity ?? row.unavailable_quantity ?? 0);
          return { code: code ?? "", capacity: code && Number.isFinite(total) ? Math.max(total - unavailable, 0) : null };
        }).filter(item => item.code);
      };
      if (!carcassResult.error) resources.carcaças = normalize(carcassResult.data, ["carcassCode", "carcass_code"]);
      else snapshot.warnings.push("Carcaças não puderam ser confirmadas pelo cadastro físico.");
      if (!boResult.error) resources.bos = normalize(boResult.data, ["boCode", "bo_code"]);
      else snapshot.warnings.push("BOs não puderam ser confirmados pelo cadastro físico.");
      if (!ovenResult.error) {
        const ovenCapacity = new Map<string, number>();
        for (const oven of (ovenResult.data ?? []) as Array<{ machine_code: string; position_count: number }>) {
          ovenCapacity.set(oven.machine_code, (ovenCapacity.get(oven.machine_code) ?? 0) + Math.max(Number(oven.position_count) || 0, 0));
        }
        resources.fornos = [...ovenCapacity].map(([machine, capacity]) => ({ code: `${machine}:FORNO`, capacity }));
      } else {
        snapshot.warnings.push("Capacidade dos fornos não pôde ser confirmada.");
      }
      if (!cycleResult.error) {
        const ovenMap = new Map(resources.fornos.map(item => [item.code, item]));
        for (const cycle of (cycleResult.data ?? []) as Array<{ machine_code: string; entered_at: string; expected_ready_at: string; maximum_due_at: string }>) {
          const oven = ovenMap.get(`${cycle.machine_code}:FORNO`);
          if (oven) oven.reservations = [...(oven.reservations ?? []), { resource: oven.code, startsAt: cycle.entered_at, endsAt: cycle.expected_ready_at || cycle.maximum_due_at }];
        }
      } else {
        snapshot.warnings.push("Ciclos de aquecimento não puderam ser consultados.");
      }
      if (!calendarResult.error && Array.isArray(calendarResult.data)) {
        resources.calendarBlocks = (calendarResult.data as Array<Record<string, unknown>>).filter(item => String(item.resourceType ?? item.resource_type ?? "") === "press").map(item => ({
          resource: String(item.resourceCode ?? item.resource_code ?? ""),
          startsAt: String(item.startsAt ?? item.starts_at),
          endsAt: String(item.endsAt ?? item.ends_at),
        })).filter(item => item.resource && item.startsAt !== "undefined" && item.endsAt !== "undefined");
      } else {
        snapshot.warnings.push("Paradas cadastradas não puderam ser consultadas.");
      }
    }
    snapshot.resources = resources;
    snapshot.evaluation = evaluateTemporalResources(snapshot.rows, new Date(), resources, { ovenCapacityPerPress: null, heatingMinutes: 0 });
  } catch {
    snapshot.error = "Não foi possível consultar a programação. Tente atualizar. Nenhuma alteração foi realizada.";
  }
  snapshot.readAt = new Date().toISOString();
  return snapshot;
}
