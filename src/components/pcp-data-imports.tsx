"use client";

import { useRef, useState } from "react";
import { CheckCircle2, FileClock, FileSpreadsheet, Loader2, ShoppingCart, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { requestOfflineSync } from "@/lib/offline-store";
import type { PcpImportBatch, PcpImportType } from "@/types/database";
import { useCurrentUser } from "@/components/current-user-provider";

type Cell = string | number | boolean | Date | null;
type ParsedImport = { rows: Record<string, unknown>[]; sourceSheet: string; minDate: string | null; maxDate: string | null };
const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
const accepted = ".xls,.xlsx,.xlsm,.xlsb,.ods,.csv,.tsv";

const definitions = {
  order_portfolio: {
    title: "Carteira de Encomendas",
    short: "Carteira",
    description: "Pedidos, saldos, clientes, ferramentas e prazos de entrega.",
    icon: ShoppingCart,
    color: "text-blue-600 bg-blue-50",
  },
  planning_history: {
    title: "Histórico de Planejamentos",
    short: "Histórico",
    description: "Planos anteriores, quantidades planejadas e atendimento realizado.",
    icon: FileClock,
    color: "text-violet-600 bg-violet-50",
  },
} satisfies Record<PcpImportType, { title: string; short: string; description: string; icon: typeof ShoppingCart; color: string }>;

function normalized(value: unknown) {
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function text(value: Cell) { return String(value ?? "").trim(); }
function numeric(value: Cell) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const source = text(value);
  const cleaned = source.includes(",") ? source.replace(/\./g, "").replace(",", ".") : source;
  const parsed = Number(cleaned.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function isoDate(value: Cell) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const source = text(value);
  const br = source.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (br) return `${br[3].length === 2 ? `20${br[3]}` : br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}
function orderKey(value: Cell) { return text(value).replace(/\D/g, "").replace(/^0+/, ""); }
function unit(value: Cell): "kg" | "pieces" { return normalized(value).includes("pc") || normalized(value).includes("pec") ? "pieces" : "kg"; }
function sourceObject(headers: string[], row: Cell[]) {
  return Object.fromEntries(headers.map((header, index) => [header || `Coluna ${index + 1}`, row[index] instanceof Date ? isoDate(row[index]) : row[index] ?? null]));
}

function parsePortfolio(matrix: Cell[][], headerIndex: number) {
  const headers = matrix[headerIndex].map(text);
  const index = new Map(headers.map((header, position) => [normalized(header), position]));
  const value = (row: Cell[], ...names: string[]) => {
    for (const name of names) { const position = index.get(normalized(name)); if (position !== undefined) return row[position] ?? null; }
    return null;
  };
  const rows = matrix.slice(headerIndex + 1).map((row, offset) => {
    const pedido = text(value(row, "Pedido"));
    if (!pedido) return null;
    const serviceUnit = unit(value(row, "Un.At", "Un At"));
    const billingUnit = unit(value(row, "Un.Fat", "Un Fat"));
    return {
      source_row: headerIndex + offset + 2,
      order_key: orderKey(pedido), order_number: pedido,
      customer_name: text(value(row, "Cliente")) || null,
      customer_order_number: text(value(row, "Nr Pedido")) || null,
      source_base: text(value(row, "Base de Origem")) || null,
      implantation_date: isoDate(value(row, "Data Implant")),
      delivery_week: numeric(value(row, "Sem/Ent")) || null,
      due_date: isoDate(value(row, "Data Entrega")),
      original_due_date: isoDate(value(row, "Data Ent.Orig")),
      scheduled_date: isoDate(value(row, "Data Prog")),
      last_invoice_date: isoDate(value(row, "Data Ult Fat")),
      product_code: text(value(row, "Produto")) || null,
      tool_code: text(value(row, "Ferramenta")).toUpperCase() || null,
      service_unit: serviceUnit, billing_unit: billingUnit,
      ordered_kg: numeric(value(row, "Pedido Kg")), ordered_pieces: numeric(value(row, "Pedido Pc")),
      balance_kg: numeric(value(row, "Saldo Kg")), balance_pieces: numeric(value(row, "Saldo Pc")),
      committed_kg: numeric(value(row, "Empenho Kg")), committed_pieces: numeric(value(row, "Empenho Pc")),
      produced_kg: numeric(value(row, "Produzido Kg")), produced_pieces: numeric(value(row, "Produzido Pc")),
      packed_kg: numeric(value(row, "Embalado Kg")), packed_pieces: numeric(value(row, "Embalado Pc")),
      invoiced_kg: numeric(value(row, "Faturado Kg")), invoiced_pieces: numeric(value(row, "Faturado Pc")),
      priority: numeric(value(row, "Prior")) || null,
      alloy_code: text(value(row, "Liga")) || null, temper: text(value(row, "Têmpera", "Tempera")) || null,
      status: text(value(row, "Status")) || null, service_status: text(value(row, "Atend.Pedido")) || null,
      item_status: text(value(row, "Sit Item OF")) || null, market_code: text(value(row, "Código Mercado")) || null,
      customer_item: text(value(row, "Item do Cliente")) || null, delivery_city: text(value(row, "Cidade Entrega")) || null,
      special_conditions: text(value(row, "Condições Especiais")) || null, situation_notes: text(value(row, "Obs. Situação")) || null,
      source_data: sourceObject(headers, row),
    };
  }).filter(Boolean) as Record<string, unknown>[];
  return rows;
}

function parseHistory(matrix: Cell[][], headerIndex: number) {
  const headers = matrix[headerIndex].map(text);
  const index = new Map(headers.map((header, position) => [normalized(header), position]));
  const value = (row: Cell[], ...names: string[]) => {
    for (const name of names) { const position = index.get(normalized(name)); if (position !== undefined) return row[position] ?? null; }
    return null;
  };
  let context: Record<string, Cell> = {};
  return matrix.slice(headerIndex + 1).map((row, offset) => {
    const currentOrder = text(value(row, "Pedido"));
    if (currentOrder) context = {
      pedido: currentOrder, cliente: value(row, "Cliente", "Clietnte"), produto: value(row, "Produto"),
      programacao: value(row, "Dt Programação", "Dt Programacao"), entrega: value(row, "Pz Entrega"),
      pedida: value(row, "Qt. Pedida"), atendida: value(row, "Qt. Atendida"), unidade: value(row, "Un.Atend"),
      sitItem: value(row, "Sit.Item"), sitPedido: value(row, "Sit.Pedido"),
    };
    const pedido = text(context.pedido);
    if (!pedido) return null;
    const serviceUnit = unit(context.unidade);
    const requested = numeric(context.pedida);
    const fulfilled = numeric(context.atendida);
    return {
      source_row: headerIndex + offset + 2, order_key: orderKey(pedido), order_number: pedido,
      customer_name: text(context.cliente) || null, product_code: text(context.produto) || null, tool_code: null,
      programming_date: isoDate(context.programacao), due_date: isoDate(context.entrega),
      requested_kg: serviceUnit === "kg" ? requested : 0, requested_pieces: serviceUnit === "pieces" ? requested : 0,
      fulfilled_kg: serviceUnit === "kg" ? fulfilled : 0, fulfilled_pieces: serviceUnit === "pieces" ? fulfilled : 0,
      service_unit: serviceUnit, item_status: text(context.sitItem) || null, order_status: text(context.sitPedido) || null,
      plan_code: text(value(row, "Plano")).replace(/\.0$/, "") || null, plan_date: isoDate(value(row, "Data")),
      planned_kg: numeric(value(row, "Qt Pln KG")), planned_pieces: numeric(value(row, "Qt Pln PC")),
      packed_kg: numeric(value(row, "Qt Emb KG")), packed_pieces: numeric(value(row, "Qt Emb PC")),
      lot_number: text(value(row, "Lote")) || null, production_date: isoDate(value(row, "Data.1")),
      gross_kg: numeric(value(row, "Qt Bruta")), net_kg: numeric(value(row, "Qt Liqda")), loss_kg: numeric(value(row, "Qt Perda")),
      purchased_kg: numeric(value(row, "Qt Compr")), packaging_date: isoDate(value(row, "Dt Embal")),
      separated_kg: numeric(value(row, "Qt Separ")), pending_packaging_kg: numeric(value(row, "Qt a Emb")),
      racks: text(value(row, "Racks")) || null, stoppage_reason: text(value(row, "Motivo Parada")) || null,
      source_data: sourceObject(headers, row),
    };
  }).filter(Boolean) as Record<string, unknown>[];
}

async function readWorkbook(file: File, type: PcpImportType): Promise<ParsedImport> {
  const [XLSX, codepage] = await Promise.all([import("xlsx"), import("xlsx/dist/cpexcel.full.mjs")]);
  XLSX.set_cptable(codepage);
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const required = type === "order_portfolio" ? ["pedido", "cliente", "ferramenta", "saldokg"] : ["pedido", "produto", "plano", "qtplnkg"];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName]; if (!worksheet) continue;
    const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true, defval: null, blankrows: false }) as Cell[][];
    const headerIndex = matrix.slice(0, 20).findIndex((row) => {
      const headers = row.map(normalized);
      return required.every((requiredHeader) => headers.includes(requiredHeader));
    });
    if (headerIndex < 0) continue;
    const rows = type === "order_portfolio" ? parsePortfolio(matrix, headerIndex) : parseHistory(matrix, headerIndex);
    const dates = rows.map((row) => String(row.due_date ?? "")).filter(Boolean).sort();
    return { rows, sourceSheet: sheetName, minDate: dates[0] ?? null, maxDate: dates.at(-1) ?? null };
  }
  throw new Error(type === "order_portfolio" ? "Não encontrei as colunas Pedido, Cliente, Ferramenta e Saldo Kg." : "Não encontrei as colunas Pedido, Produto, Plano e Qt Pln KG.");
}

function formatDate(value: string | null) { return value ? new Date(`${value}T12:00:00`).toLocaleDateString("pt-BR") : "—"; }
function formatTimestamp(value?: string | null) { return value ? new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Ainda não importado"; }

export function PcpDataImports({ batches, onImported }: { batches: Partial<Record<PcpImportType, PcpImportBatch>>; onImported: () => void }) {
  const { display_name: operatorName } = useCurrentUser();
  const input = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<PcpImportType | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");

  function open(nextType: PcpImportType) { setType(nextType); setFile(null); setParsed(null); setError(""); setProgress(0); }
  async function selectFile(selected?: File) {
    if (!selected || !type) return;
    setReading(true); setFile(selected); setParsed(null); setError("");
    try { setParsed(await readWorkbook(selected, type)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível ler o arquivo."); }
    finally { setReading(false); }
  }
  async function commit() {
    if (!file || !parsed || !type || !organizationId) return;
    setSaving(true); setError(""); setProgress(2);
    let batchId: string | null = null;
    try {
      const supabase = createClient();
      const hashBuffer = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
      const fileHash = [...new Uint8Array(hashBuffer)].map((part) => part.toString(16).padStart(2, "0")).join("");
      const { data: duplicate, error: duplicateError } = await supabase.from("pcp_import_batches").select("id,imported_at").eq("organization_id", organizationId).eq("import_type", type).eq("file_hash", fileHash).eq("status", "processed").maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate) throw new Error(`Este mesmo arquivo já foi importado em ${formatTimestamp(duplicate.imported_at)}.`);
      const { data: batch, error: batchError } = await supabase.from("pcp_import_batches").insert({ organization_id: organizationId, import_type: type, file_name: file.name, file_hash: fileHash, source_sheet: parsed.sourceSheet, row_count: parsed.rows.length, status: "processing", imported_by_name: operatorName, metadata: { min_due_date: parsed.minDate, max_due_date: parsed.maxDate } }).select("id").single();
      if (batchError) throw batchError;
      batchId = batch.id;
      const table = type === "order_portfolio" ? "order_portfolio" : "planning_history";
      const chunkSize = 250;
      for (let start = 0; start < parsed.rows.length; start += chunkSize) {
        const payload = parsed.rows.slice(start, start + chunkSize).map((row) => ({ ...row, organization_id: organizationId, import_batch_id: batch.id }));
        const { error: insertError } = await supabase.from(table).insert(payload);
        if (insertError) throw insertError;
        setProgress(Math.min(96, Math.round(((start + payload.length) / parsed.rows.length) * 94) + 2));
      }
      const { error: finishError } = await supabase.from("pcp_import_batches").update({ status: "processed", processed_at: new Date().toISOString(), row_count: parsed.rows.length }).eq("id", batch.id);
      if (finishError) throw finishError;
      setProgress(100); requestOfflineSync(); onImported(); setType(null);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : typeof cause === "object" && cause ? String((cause as Record<string, unknown>).message ?? "") : "";
      setError(detail || "Falha ao salvar a importação.");
      if (batchId) await createClient().from("pcp_import_batches").update({ status: "failed", error_details: { message: detail } }).eq("id", batchId);
    } finally { setSaving(false); }
  }

  return (
    <>
      <div className="grid gap-3 lg:grid-cols-2">
        {(Object.keys(definitions) as PcpImportType[]).map((key) => {
          const definition = definitions[key]; const Icon = definition.icon; const batch = batches[key];
          return <article key={key} className="flex items-center gap-4 rounded-2xl border bg-white p-4 shadow-sm">
            <span className={`grid size-11 shrink-0 place-items-center rounded-xl ${definition.color}`}><Icon className="size-5" /></span>
            <div className="min-w-0 flex-1"><h3 className="font-heading font-bold text-slate-900">{definition.title}</h3><p className="truncate text-xs text-slate-500">{batch ? `${batch.row_count.toLocaleString("pt-BR")} linhas · ${formatTimestamp(batch.processed_at)}` : definition.description}</p></div>
            <Button variant={batch ? "outline" : "default"} onClick={() => open(key)} className={batch ? "" : "bg-orange-500 hover:bg-orange-600"}><UploadCloud className="size-4" />{batch ? "Atualizar" : "Importar"}</Button>
          </article>;
        })}
      </div>
      <Dialog open={Boolean(type)} onOpenChange={(openState) => { if (!openState && !saving) setType(null); }}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader><DialogTitle className="text-lg">Importar {type ? definitions[type].title : "dados"}</DialogTitle><DialogDescription>{type ? definitions[type].description : ""} Cada importação cria um snapshot preservado para auditoria.</DialogDescription></DialogHeader>
          <input ref={input} type="file" accept={accepted} className="hidden" onChange={(event) => void selectFile(event.target.files?.[0])} />
          <button type="button" disabled={saving} onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void selectFile(event.dataTransfer.files[0]); }} className="grid min-h-36 place-items-center rounded-2xl border-2 border-dashed bg-slate-50 p-5 text-center transition hover:border-orange-300 hover:bg-orange-50/30">
            {reading ? <Loader2 className="size-7 animate-spin text-orange-500" /> : <div><span className="mx-auto grid size-11 place-items-center rounded-full bg-orange-50 text-orange-600"><FileSpreadsheet className="size-5" /></span><b className="mt-3 block text-sm">{file?.name || "Arraste o Excel ou clique para selecionar"}</b><span className="mt-1 block text-xs text-slate-400">XLS · XLSX · XLSM · XLSB · ODS · CSV · TSV</span></div>}
          </button>
          {parsed && <div className="grid grid-cols-3 gap-3 rounded-xl border bg-slate-50 p-3 text-center"><div><span className="text-[10px] uppercase text-slate-400">Linhas válidas</span><strong className="block text-lg">{parsed.rows.length.toLocaleString("pt-BR")}</strong></div><div><span className="text-[10px] uppercase text-slate-400">Menor prazo</span><strong className="block text-sm">{formatDate(parsed.minDate)}</strong></div><div><span className="text-[10px] uppercase text-slate-400">Maior prazo</span><strong className="block text-sm">{formatDate(parsed.maxDate)}</strong></div></div>}
          {saving && <div><div className="mb-1.5 flex justify-between text-xs font-semibold"><span>Salvando no banco</span><span>{progress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-orange-500 transition-all" style={{ width: `${progress}%` }} /></div></div>}
          {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
          <DialogFooter><Button variant="outline" disabled={saving} onClick={() => setType(null)}>Cancelar</Button><Button disabled={!parsed || saving} onClick={() => void commit()} className="bg-orange-500 hover:bg-orange-600">{saving ? <><Loader2 className="animate-spin" />Importando...</> : <><CheckCircle2 />Confirmar importação</>}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
