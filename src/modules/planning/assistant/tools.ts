import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LocalUser } from "@/lib/local-auth/types";
import type { AssistantContext } from "./contracts";
import { queryResult, type AssistantQueryResult } from "./contracts";

const MAX_ROWS = 20;

const queryInputSchema = z.object({
  machineCode: z.string().trim().max(40).optional(),
  from: z.string().trim().max(40).optional(),
  to: z.string().trim().max(40).optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.number().int().min(1).max(MAX_ROWS).optional(),
});

type ToolScope = {
  supabase: SupabaseClient;
  user: LocalUser;
  context?: AssistantContext;
};

function scopedMachines(user: LocalUser, requested?: string, contextual?: string) {
  const candidate = requested || contextual;
  if (candidate) {
    if (user.machine_codes.length && !user.machine_codes.includes(candidate)) return [];
    return [candidate];
  }
  return user.machine_codes.slice(0, 12);
}

function safeLimit(value?: number) {
  return Math.min(MAX_ROWS, Math.max(1, value ?? 10));
}

function dateRange(query: ReturnType<typeof queryInputSchema.parse>) {
  return {
    from: query.from ? new Date(query.from).toISOString() : null,
    to: query.to ? new Date(query.to).toISOString() : null,
  };
}

function sanitizeRows(rows: unknown[], fields: string[]) {
  return rows.slice(0, MAX_ROWS).map((raw) => {
    const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
  });
}

function unavailable(source: string, error: unknown): AssistantQueryResult {
  void error;
  return queryResult({
    status: "unavailable",
    source,
    summary: "A fonte não respondeu nesta consulta.",
    rows: [],
    limitations: [
      "Não foi possível ler esta fonte nesta rodada; o erro técnico permanece apenas no servidor.",
      "A ausência de resposta não significa ausência de registros.",
    ],
  });
}

async function productionRows(scope: ToolScope, input: z.infer<typeof queryInputSchema>, planned: boolean) {
  const machines = scopedMachines(scope.user, input.machineCode, scope.context?.machineCode);
  if (!machines.length) {
    return queryResult({
      status: "unavailable",
      source: "production_orders",
      summary: "Nenhuma prensa autorizada está no escopo desta consulta.",
      rows: [],
      limitations: ["O assistente não pode consultar prensas fora do escopo do usuário."],
    });
  }
  const range = dateRange(input);
  let query = scope.supabase
    .from("production_orders")
    .select("id,order_number,plan_code,machine_code,tool_code,status,production_status,sequence,target_kg,produced_kg,actual_start,actual_end,due_date")
    .eq("organization_id", scope.user.organization_id)
    .eq("is_active", true)
    .in("machine_code", machines)
    .order("machine_code")
    .order("sequence")
    .limit(safeLimit(input.limit));
  if (scope.context?.orderId) query = query.eq("id", scope.context.orderId);
  if (input.search) query = query.or(`order_number.ilike.%${input.search}%,tool_code.ilike.%${input.search}%`);
  if (range.from) query = query.gte(planned ? "created_at" : "actual_start", range.from);
  if (range.to) query = query.lte(planned ? "created_at" : "actual_start", range.to);
  const { data, error } = await query;
  if (error) return unavailable("production_orders", error);
  const fields = ["id", "order_number", "plan_code", "machine_code", "tool_code", "status", "production_status", "sequence", "target_kg", "produced_kg", "actual_start", "actual_end", "due_date"];
  const rows = sanitizeRows(data ?? [], fields);
  return queryResult({
    status: "available",
    source: "production_orders",
    summary: `${rows.length} registro(s) de ${planned ? "programação" : "produção"} encontrado(s).`,
    rows,
    limitations: ["Os registros são uma leitura pontual; não representam monitoramento contínuo."],
    evidenceRefs: [{ id: "production_orders", label: "Ordens de produção", kind: "record" }],
  });
}

export function createAssistantTools(scope: ToolScope) {
  return {
    consultar_programacao: tool({
      description: "Consulta a programação e a sequência registrada nas prensas autorizadas. Use para perguntas sobre ordens, ferramentas, sequência, prazo ou carga planejada.",
      inputSchema: queryInputSchema,
      execute: (input) => productionRows(scope, input, true),
    }),
    consultar_producao: tool({
      description: "Consulta registros reais de produção das prensas autorizadas, diferenciando produzido, planejado e status registrado.",
      inputSchema: queryInputSchema,
      execute: (input) => productionRows(scope, input, false),
    }),
    consultar_status_prensa: tool({
      description: "Consulta as ordens atuais de uma prensa autorizada e resume a situação registrada, sem afirmar que a leitura é contínua.",
      inputSchema: queryInputSchema,
      execute: async (input) => {
        const result = await productionRows(scope, input, false);
        return { ...result, summary: result.rows.length ? `Status registrado para ${result.rows.length} ordem(ns).` : result.summary };
      },
    }),
    consultar_forno: tool({
      description: "Consulta ciclos de aquecimento e liberação de ferramentas. Não substitui a confirmação física nem a temperatura medida.",
      inputSchema: queryInputSchema,
      execute: async (input) => {
        const machines = scopedMachines(scope.user, input.machineCode, scope.context?.machineCode);
        if (!machines.length) return unavailable("tool_heating_cycles", "Nenhuma prensa autorizada no escopo.");
        let query = scope.supabase
          .from("tool_heating_cycles")
          .select("id,machine_code,tool_code,oven_id,oven_code,oven_position,status,entered_at,expected_ready_at,released_at")
          .eq("organization_id", scope.user.organization_id)
          .in("machine_code", machines)
          .in("status", ["heating", "released"])
          .order("entered_at", { ascending: false })
          .limit(safeLimit(input.limit));
        if (input.search) query = query.ilike("tool_code", `%${input.search}%`);
        const { data, error } = await query;
        if (error) return unavailable("tool_heating_cycles", error);
        const rows = sanitizeRows(data ?? [], ["id", "machine_code", "tool_code", "oven_id", "oven_code", "oven_position", "status", "entered_at", "expected_ready_at", "released_at"]);
        return queryResult({
          status: "available",
          source: "tool_heating_cycles",
          summary: `${rows.length} ciclo(s) de forno encontrado(s).`,
          rows,
          limitations: ["A leitura não confirma temperatura medida nem retirada física da ferramenta."],
          evidenceRefs: [{ id: "tool_heating_cycles", label: "Ciclos de aquecimento", kind: "record" }],
        });
      },
    }),
    consultar_paradas: tool({
      description: "Consulta paradas de máquina, motivo, duração e status nas prensas autorizadas.",
      inputSchema: queryInputSchema,
      execute: async (input) => {
        const machines = scopedMachines(scope.user, input.machineCode, scope.context?.machineCode);
        if (!machines.length) return unavailable("machine_stoppages", "Nenhuma prensa autorizada no escopo.");
        let query = scope.supabase
          .from("machine_stoppages")
          .select("id,machine_code,reason,started_at,ended_at,duration_minutes,status,reported_by_name,closing_observation")
          .eq("organization_id", scope.user.organization_id)
          .eq("is_deleted", false)
          .in("machine_code", machines)
          .order("started_at", { ascending: false })
          .limit(safeLimit(input.limit));
        const range = dateRange(input);
        if (range.from) query = query.gte("started_at", range.from);
        if (range.to) query = query.lte("started_at", range.to);
        if (input.search) query = query.ilike("reason", `%${input.search}%`);
        const { data, error } = await query;
        if (error) return unavailable("machine_stoppages", error);
        const rows = sanitizeRows(data ?? [], ["id", "machine_code", "reason", "started_at", "ended_at", "duration_minutes", "status", "reported_by_name", "closing_observation"]);
        return queryResult({
          status: "available",
          source: "machine_stoppages",
          summary: `${rows.length} parada(s) encontrada(s).`,
          rows,
          limitations: ["A duração registrada pode depender do horário informado no encerramento."],
          evidenceRefs: [{ id: "machine_stoppages", label: "Paradas de máquina", kind: "record" }],
        });
      },
    }),
    consultar_diario_bordo: tool({
      description: "Consulta ocorrências operacionais e passagens de turno recentes para responder o que aconteceu na operação.",
      inputSchema: queryInputSchema,
      execute: async (input) => {
        const machines = scopedMachines(scope.user, input.machineCode, scope.context?.machineCode);
        let occurrencesQuery = scope.supabase
          .from("operational_occurrences")
          .select("id,title,description,status,severity,machine_code,occurred_at,created_by_name,stoppage_id")
          .eq("organization_id", scope.user.organization_id)
          .order("occurred_at", { ascending: false, nullsFirst: false })
          .limit(safeLimit(input.limit));
        if (machines.length) occurrencesQuery = occurrencesQuery.in("machine_code", machines);
        if (input.search) occurrencesQuery = occurrencesQuery.ilike("title", `%${input.search}%`);
        const handoversQuery = scope.supabase
          .from("shift_handovers")
          .select("id,from_shift,to_shift,summary,handed_over_at,created_by_name")
          .eq("organization_id", scope.user.organization_id)
          .order("handed_over_at", { ascending: false })
          .limit(safeLimit(input.limit));
        const [{ data: occurrences, error: occurrencesError }, { data: handovers, error: handoversError }] = await Promise.all([occurrencesQuery, handoversQuery]);
        if (occurrencesError && handoversError) return unavailable("operational_occurrences+shift_handovers", occurrencesError);
        const rows = [
          ...sanitizeRows(occurrences ?? [], ["id", "title", "description", "status", "severity", "machine_code", "occurred_at", "created_by_name", "stoppage_id"]).map((row) => ({ ...row, tipo: "ocorrência" })),
          ...sanitizeRows(handovers ?? [], ["id", "from_shift", "to_shift", "summary", "handed_over_at", "created_by_name"]).map((row) => ({ ...row, tipo: "passagem de turno" })),
        ].slice(0, MAX_ROWS);
        return queryResult({
          status: occurrencesError || handoversError ? "partial" : "available",
          source: "operational_occurrences+shift_handovers",
          summary: `${rows.length} registro(s) do Report da Produção encontrado(s).`,
          rows,
          limitations: [
            ...(occurrencesError ? ["Ocorrências indisponíveis nesta consulta."] : []),
            ...(handoversError ? ["Passagens de turno indisponíveis nesta consulta."] : []),
          ],
          evidenceRefs: [{ id: "diario-bordo", label: "Report da Produção", kind: "record" }],
        });
      },
    }),
  };
}
