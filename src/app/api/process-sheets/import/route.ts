import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { getCurrentUser, getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value).trim().replace(/\s/g, "");
  if (!raw) return null;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : raw;
  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const positiveOrNull = (value: number | null) =>
  value !== null && value > 0 ? value : null;

export async function POST(request: Request) {
  const token = await getSessionToken();
  if (!token || !organizationId) return NextResponse.json({ error: "Sessão ou organização não configurada." }, { status: 401 });
  const form = await request.formData();
  const currentUser = await getCurrentUser();
  const changedBy = currentUser?.display_name || "Importação de planilha";
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Selecione uma planilha Excel." }, { status: 400 });
  const workbook = XLSX.read(Buffer.from(await file.arrayBuffer()), { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const valid = rows.map((row, index) => {
    const machine = text(row["Prensa"]);
    const tool = text(row["Perfil"]);
    const alloy = text(row["Liga"]);
    const sequence = number(row["Sequência"]);
    if (!machine || !tool || !alloy || sequence == null) return { error: `Linha ${index + 2}: Prensa, Perfil, Liga e Sequência são obrigatórios.` };
    const profileLinearWeight = positiveOrNull(number(row["Peso_Teorico"]));
    const holes = number(row["Furos"]);
    const totalLinearWeight = positiveOrNull(
      number(row["Teorico_X_Furo"]) ??
        (profileLinearWeight !== null && holes !== null
          ? profileLinearWeight * holes
          : null),
    );
    const parameters = {
      extrusion: {
        profile_linear_weight_kg_m: profileLinearWeight,
        total_linear_weight_kg_m: totalLinearWeight,
        holes,
        cut_length_mm: positiveOrNull(number(row["Comprimento_Corte"])),
        cuts_per_pull: number(row["Numero_Cortes"]),
        discard_mm: positiveOrNull(number(row["Descarte"])),
        ram_speed_mm_s: number(row["Velocidade_Princiapal"]),
        initial_pressure: number(row["Presão Inicial"]),
        target_productivity_kg_h: number(row["Produtividade_kg/h"]),
        billets_per_pull: number(row["TarugosXPuxada"]),
      },
      temperatures: {
        zone_1_c: number(row["Zona 01"]),
        zone_2_c: number(row["Zona 02"]),
        zone_3_c: number(row["Zona 03"]),
        zone_4_c: number(row["Zona 04"]),
        exit_min_c: number(row["Temperatura_Emergente_Min"]),
        exit_max_c: number(row["Temperatura_Emergente_Max"]),
      },
      pulling: {
        puller_left_s: number(row["Tempo_Puller_DX"]),
        puller_right_s: number(row["Tempo_Puller_SX"]),
      },
      billet: {
        calculated_length_mm: positiveOrNull(number(row["Comprimento _tarugo"])),
        calculated_pull_mm: positiveOrNull(number(row["Comprimento_Puxada"])),
        butt_mm: positiveOrNull(number(row["Talão"])),
      },
      saw: { mode: text(row["Serra"]) || null },
      cooling: { mode: text(row["Resfriamento"]) || null },
      notes: text(row["Observação_processo"]) || "",
      legacy: { source_code: text(row["Código"]) || null },
    };
    return { value: { organization_id: organizationId, machine_code: machine, tool_code: tool, product_code: tool, alloy_code: alloy, temper: text(row["Têmpera"]) || null, revision: sequence, tool_sequence: sequence, parameters, is_active: true, source_system: "excel", source_file: file.name, source_row: index + 2, last_changed_by_name: changedBy, last_change_reason: "Importação da ficha de processo pela planilha" } };
  });
  const errors = valid.filter((item) => "error" in item).map((item) => (item as { error: string }).error);
  const rawPayload = valid.filter((item) => "value" in item).map((item) => (item as { value: Record<string, unknown> }).value);
  const uniquePayload = new Map<string, Record<string, unknown>>();
  for (const item of rawPayload) uniquePayload.set(`${item.machine_code}|${item.tool_code}|${item.alloy_code}|${item.tool_sequence}`, item);
  const payload = [...uniquePayload.values()];
  if (errors.length) return NextResponse.json({ error: "A planilha possui linhas que precisam ser corrigidas.", errors: errors.slice(0, 20), totalErrors: errors.length }, { status: 400 });
  const supabase = await createClient();
  const { error } = await supabase.from("process_sheets").upsert(payload, { onConflict: "organization_id,machine_code,tool_code,alloy_code,tool_sequence" });
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  const tools = [...new Map(payload.map((item) => [String(item.tool_code), { organization_id: organizationId, code: item.tool_code, description: `Perfil importado da ficha de processo · Prensas ${[...new Set(payload.filter((candidate) => candidate.tool_code === item.tool_code).map((candidate) => candidate.machine_code))].join(" e ")}`, status: "available" }])).values()];
  const { error: toolsError } = await supabase.from("tools").upsert(tools, { onConflict: "organization_id,code" });
  if (toolsError) return NextResponse.json({ error: `Fichas gravadas, mas não foi possível cadastrar as ferramentas: ${toolsError.message}` }, { status: 400 });
  return NextResponse.json({ imported: payload.length, toolsImported: tools.length, duplicatesMerged: rawPayload.length - payload.length, presses: [...new Set(payload.map((item) => item.machine_code))], sourceFile: file.name });
}
