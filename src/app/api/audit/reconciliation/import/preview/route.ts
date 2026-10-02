import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";
import { combineDateTime, normalizeDate, normalizeNumber, normalizePress, normalizeText, normalizeTime, normalizeTool, NORMALIZATION_VERSION } from "@/modules/reconciliation/normalizers";

function key(value: unknown) { return normalizeText(value).replace(/\s/g, "").toLowerCase(); }
function value(row: Record<string, unknown>, ...names: string[]) {
  const normalized = new Map(Object.entries(row).map(([name, item]) => [key(name), item]));
  for (const name of names) if (normalized.has(key(name))) return normalized.get(key(name));
  return null;
}
function canonical(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

async function parseReport(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(buffer).digest("hex");
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sourceSheet = workbook.SheetNames.find((name) => key(name) === "reports") ?? workbook.SheetNames[0];
  if (!sourceSheet) throw new Error("O arquivo não possui uma aba para importar.");
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sourceSheet], { defval: null, raw: true });
  if (!rows.length) throw new Error("O relatório não possui linhas para importar.");
  const prepared = rows.map((rawData, index) => {
    const tool = normalizeTool(value(rawData, "Ferramenta", "Ferrametna"), value(rawData, "Sequência", "Seq", "Sequencia"));
    const productionDate = normalizeDate(value(rawData, "Data Produção", "Data de Produção", "Data"));
    const startTime = normalizeTime(value(rawData, "Hora Inicial", "Hora início", "Início"));
    const endTime = normalizeTime(value(rawData, "Hora Final", "Hora fim", "Fim"));
    const normalizedData: Record<string, unknown> = {
      normalization_version: NORMALIZATION_VERSION,
      machine_code: normalizePress(value(rawData, "Prensa", "Press")),
      production_date: productionDate,
      batch_number: normalizeText(value(rawData, "Lote")) || null,
      start_time: startTime,
      end_time: endTime,
      start_at: combineDateTime(productionDate, startTime),
      end_at: combineDateTime(productionDate, endTime),
      shift_code: normalizeText(value(rawData, "Turno")) || null,
      product_code: normalizeText(value(rawData, "Produto")) || null,
      tool_code: tool.base,
      tool_sequence: tool.sequence,
      billet_quantity: normalizeNumber(value(rawData, "Qtde Tarugo", "Quantidade Tarugo")),
      billet_length_mm: normalizeNumber(value(rawData, "Compr Tarugo", "Comprimento Tarugo")),
      gross_weight_kg: normalizeNumber(value(rawData, "Peso Bruto")),
      net_weight_kg: normalizeNumber(value(rawData, "Peso Liq.", "Peso Líquido")),
      efficiency_percent: normalizeNumber(value(rawData, "Eficiencia", "Eficiência")),
      achieved_productivity_kg_h: normalizeNumber(value(rawData, "Produtividade")),
      produced_quantity: normalizeNumber(value(rawData, "Qt Pc", "Quantidade Peças")),
      theoretical_linear_weight_kg_m: normalizeNumber(value(rawData, "Kg/m Teórico")),
      actual_linear_weight_kg_m: normalizeNumber(value(rawData, "kg/m Real")),
      packaging_linear_weight_kg_m: normalizeNumber(value(rawData, "kg/m Embalagem")),
      alloy_code: normalizeText(value(rawData, "Liga")) || null,
      alloy_used: normalizeText(value(rawData, "Liga Utilizada")) || null,
      order_number: normalizeText(value(rawData, "OP", "Ordem")) || null,
      state: normalizeText(value(rawData, "Estado", "Status")) || null,
      scrap_kg: normalizeNumber(value(rawData, "Sucata")),
      losses_kg: normalizeNumber(value(rawData, "Perdas")),
    };
    const validationErrors: string[] = [];
    if (!normalizedData.production_date) validationErrors.push("Data de produção ausente ou inválida.");
    if (!normalizedData.machine_code) validationErrors.push("Prensa ausente ou inválida.");
    if (!normalizedData.tool_code) validationErrors.push("Ferramenta ausente ou inválida.");
    if (normalizedData.losses_kg == null && Object.prototype.hasOwnProperty.call(rawData, "Perdas")) validationErrors.push("Perdas não informada; mantida como ausente.");
    const fingerprint = createHash("sha256").update(JSON.stringify(canonical(normalizedData))).digest("hex");
    return { rowNumber: index + 2, rawData, normalizedData, validationErrors, fingerprint };
  });
  return { hash, sourceSheet, headers: Object.keys(rows[0]), rows: prepared };
}

export async function POST(request: Request) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Selecione um arquivo ERP." }, { status: 400 });
  try {
    const report = await parseReport(file);
    const { data, error } = await (await createClient()).rpc("local_prepare_production_report_import", {
      p_token: token,
      p_file_name: file.name,
      p_file_hash: report.hash,
      p_source_sheet: report.sourceSheet,
      p_headers: report.headers,
      p_rows: report.rows,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível ler o relatório." }, { status: 400 });
  }
}

