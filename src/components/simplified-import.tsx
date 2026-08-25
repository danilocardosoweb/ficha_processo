"use client";

import { useRef, useState } from "react";
import Papa from "papaparse";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  FileSpreadsheet,
  Loader2,
  RotateCcw,
  UploadCloud,
  X,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { requestOfflineSync } from "@/lib/offline-store";
import type { SimplifiedRow } from "@/types/database";

type Cell = string | number | boolean | Date | null;
const maxFileSize = 10 * 1024 * 1024;
const excelExtensions = ["xls", "xlsx", "xlsm", "xlsb", "xltx", "xltm", "ods"];
const textExtensions = ["csv", "tsv"];
const supportedExtensions = [...excelExtensions, ...textExtensions];
const fileAccept = [
  ...supportedExtensions.map((extension) => `.${extension}`),
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroEnabled.12",
  "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  "application/vnd.oasis.opendocument.spreadsheet",
  "text/csv",
  "text/tab-separated-values",
].join(",");
const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const aliases = {
  ordem: [
    "ordem",
    "op",
    "ordemdeproducao",
    "ordemproducao",
    "numeroop",
    "numop",
  ],
  plano: ["plano", "programacao", "plan"],
  prensa: ["prensa", "maquina", "equipamento", "machine"],
  ferramenta: [
    "ferramenta",
    "matriz",
    "ferr",
    "tool",
    "codferr",
    "codigoferr",
    "codigoferramenta",
  ],
  perfil: ["perfil", "produto", "codigoperfil", "codproduto"],
  cliente: ["cliente", "customer", "razaosocial"],
  liga: ["liga", "alloy", "certif", "certificado"],
  tempera: ["tempera", "trat", "tratamento", "temper"],
  kg: ["kg", "peso", "pesoprogramado", "quantidadekg", "qtdkg"],
  data: ["data", "entrega", "dataprogramada", "duedate"],
  item: ["item"],
  sequencia: ["seq", "sequencia"],
  furos: ["furos", "numerodefuros"],
  bo: ["bo"],
  bat: ["bat"],
  box: ["box"],
  pc: ["pc", "pcs", "pecas", "quantidadepcs"],
  st: ["st"],
  departamento: ["dep", "departamento"],
  observacao: ["observacao", "obs"],
  entradaForno: ["entrada", "horarioentrada", "entradanoforno"],
  saidaForno: ["saida", "horariosaida", "saidadoforno"],
  ativa: ["ativa", "ativo", "active", "programacaoativa"],
  unidade: ["unidade", "un", "unidademedida", "tipopedido"],
  quantidade: [
    "quantidade",
    "qtd",
    "qtde",
    "pecas",
    "barras",
    "quantidadepecas",
    "quantidadebarras",
  ],
} as const;
type ColumnKey = keyof typeof aliases;

function cellText(cell: Cell) {
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell ?? "").trim();
}
function parseNumber(value: Cell) {
  if (typeof value === "number") return value;
  const text = cellText(value);
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text;
  return Number(normalized.replace(/[^0-9.-]/g, "")) || 0;
}
function parseActive(value: Cell, columnExists: boolean) {
  if (!columnExists) return true;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = normalize(cellText(value));
  return ![
    "nao",
    "n",
    "false",
    "0",
    "inativa",
    "inativo",
    "cancelada",
    "cancelado",
  ].includes(normalized);
}
function parseUnit(value: Cell, quantityHeader: string) {
  const normalized = normalize(`${cellText(value)} ${quantityHeader}`);
  if (normalized.includes("barra")) return "bars" as const;
  if (normalized.includes("peca") || normalized.includes("pca"))
    return "pieces" as const;
  return "kg" as const;
}
function parseDate(value: Cell) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20000) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  const text = cellText(value).toLowerCase().replace(/\s+/g, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const numeric = text.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/);
  if (numeric) {
    const year = numeric[3]
      ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3])
      : new Date().getFullYear();
    return `${year}-${numeric[2].padStart(2, "0")}-${numeric[1].padStart(2, "0")}`;
  }
  const months: Record<string, number> = {
    jan: 1,
    fev: 2,
    mar: 3,
    abr: 4,
    mai: 5,
    jun: 6,
    jul: 7,
    ago: 8,
    set: 9,
    out: 10,
    nov: 11,
    dez: 12,
  };
  const named = text.match(/^(\d{1,2})[/-]([a-zç]{3})$/);
  if (named && months[named[2]])
    return `${new Date().getFullYear()}-${String(months[named[2]]).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
  return "";
}
function parseTime(value: Cell) {
  if (value instanceof Date)
    return `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
  if (typeof value === "number" && value >= 0 && value < 1) {
    const totalMinutes = Math.round(value * 24 * 60) % (24 * 60);
    return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
  }
  const text = cellText(value);
  const match = text.match(/(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}
function normalizeMachine(value: Cell) {
  const text = cellText(value)
    .toUpperCase()
    .replace(/^PRENSA\s*/i, "")
    .trim();
  return /^\d+[.,]\d+$/.test(text) ? text.replace(/[.,]/g, "") : text;
}
function findHeader(rows: Cell[][]) {
  let best = { index: -1, score: 0 };
  rows.slice(0, 40).forEach((row, index) => {
    const normalized = row.map((cell) => normalize(cellText(cell)));
    const aliasGroups = Object.values(
      aliases,
    ) as readonly (readonly string[])[];
    const score = aliasGroups.filter((names) =>
      normalized.some((value) => names.includes(value)),
    ).length;
    if (score > best.score) best = { index, score };
  });
  return best.score >= 4 ? best.index : -1;
}
function findPlan(rows: Cell[][], headerIndex: number) {
  for (const row of rows.slice(0, Math.max(headerIndex, 8))) {
    for (let index = 0; index < row.length; index += 1) {
      const value = cellText(row[index]);
      const inline = value.match(/plano[\s.:-]*([a-z0-9/_-]+)/i);
      if (inline?.[1]) return inline[1];
      if (normalize(value) === "plano" && row[index + 1])
        return cellText(row[index + 1]);
    }
  }
  return "";
}
function findMachine(rows: Cell[][], headerIndex: number) {
  for (const row of rows.slice(0, Math.max(headerIndex, 10))) {
    const line = row.map(cellText).join(" ");
    const match = line.match(/prensa\s*[-:]*\s*([a-z0-9.,_-]+)/i);
    if (match?.[1]) return normalizeMachine(match[1]);
  }
  return "";
}
function filePlan(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim();
}
function normalizePlanCode(value: string) {
  const trimmed = value.trim();
  if (/^[\d.\-\s]+$/.test(trimmed)) return trimmed.replace(/\D/g, "");
  return trimmed.toUpperCase().replace(/\s+/g, "-").slice(0, 40);
}
function localIsoDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function displayDate(value: string) {
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : "—";
}
function displayMachine(code: string) {
  if (code === "18") return "1.8";
  if (code === "19") return "1.9";
  return code;
}
function generatedOrder(
  plan: string,
  item: string,
  sequence: string,
  rowNumber: number,
) {
  const base = (plan || "PLANO")
    .toUpperCase()
    .replace(/\s+/g, "-")
    .replace(/[^A-Z0-9._-]/g, "");
  const identity =
    [item, sequence].filter(Boolean).join("-") || String(rowNumber);
  return `${base}-${/^\d+$/.test(identity) ? identity.padStart(3, "0") : identity.toUpperCase()}`;
}
function mapRows(rows: Cell[][], fileName: string) {
  const headerIndex = findHeader(rows);
  if (headerIndex < 0)
    throw new Error(
      "Não encontrei o cabeçalho. Na Simplificada antiga, são esperadas as colunas Item, Seq., Cód. Ferr, Trat, Certif. e Kg.",
    );
  const headers = rows[headerIndex].map((cell) => normalize(cellText(cell)));
  const titlePlan = findPlan(rows, headerIndex) || filePlan(fileName);
  const titleMachine = findMachine(rows, headerIndex);
  const column = (key: ColumnKey) =>
    headers.findIndex((header) =>
      aliases[key].some((alias) => alias === header),
    );
  const indexes = Object.fromEntries(
    (Object.keys(aliases) as ColumnKey[]).map((key) => [key, column(key)]),
  ) as Record<ColumnKey, number>;
  const value = (row: Cell[], key: ColumnKey) =>
    indexes[key] >= 0 ? row[indexes[key]] : null;
  const mapped = rows
    .slice(headerIndex + 1)
    .map((row, index) => {
      const item = cellText(value(row, "item"));
      const sequencia = cellText(value(row, "sequencia"));
      const plano = cellText(value(row, "plano")) || titlePlan;
      const observacao = cellText(value(row, "observacao"));
      const explicitCustomer = cellText(value(row, "cliente"));
      const customerFromObservation =
        observacao && !/chamar\s+qualidade|\*{2,}/i.test(observacao)
          ? observacao
          : "";
      const kg = parseNumber(value(row, "kg"));
      const pieces = parseNumber(value(row, "pc"));
      const inferredUnit = parseUnit(
        value(row, "unidade"),
        indexes.quantidade >= 0 ? headers[indexes.quantidade] : "",
      );
      const quantidade = parseNumber(value(row, "quantidade")) || pieces;
      const unidade =
        pieces > 0 && (kg <= 0 || inferredUnit === "pieces")
          ? ("pieces" as const)
          : inferredUnit;
      return {
        ordem:
          cellText(value(row, "ordem")) ||
          generatedOrder(plano, item, sequencia, headerIndex + index + 2),
        plano,
        prensa: normalizeMachine(value(row, "prensa")) || titleMachine,
        ferramenta: cellText(value(row, "ferramenta")).toUpperCase(),
        perfil: cellText(value(row, "perfil")).toUpperCase(),
        cliente: explicitCustomer || customerFromObservation,
        liga: cellText(value(row, "liga")).toUpperCase(),
        tempera: cellText(value(row, "tempera")).toUpperCase(),
        kg,
        data: parseDate(value(row, "data")),
        item,
        sequencia,
        furos: parseNumber(value(row, "furos")),
        bo: cellText(value(row, "bo")),
        bat: cellText(value(row, "bat")),
        box: cellText(value(row, "box")),
        pc: cellText(value(row, "pc")),
        st: cellText(value(row, "st")),
        departamento: cellText(value(row, "departamento")),
        observacao,
        entradaForno: parseTime(value(row, "entradaForno")),
        saidaForno: parseTime(value(row, "saidaForno")),
        ativa: parseActive(value(row, "ativa"), indexes.ativa >= 0),
        unidade,
        quantidade: quantidade > 0 ? quantidade : undefined,
        sourceRow: headerIndex + index + 2,
      } satisfies SimplifiedRow;
    })
    .filter((row) => row.ferramenta);
  const identities = new Map<string, number>();
  return mapped.map((row) => {
    const seen = identities.get(row.ordem) ?? 0;
    identities.set(row.ordem, seen + 1);
    return seen === 0
      ? row
      : { ...row, ordem: `${row.ordem}-${row.sourceRow}` };
  });
}

async function readExcelWorkbook(file: File) {
  const [XLSX, codepage] = await Promise.all([
    import("xlsx"),
    import("xlsx/dist/cpexcel.full.mjs"),
  ]);
  XLSX.set_cptable(codepage);
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: true,
  });
  let fallback: Cell[][] = [];
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    if (!worksheet) continue;
    const sheetRows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    }) as Cell[][];
    if (!fallback.length) fallback = sheetRows;
    if (findHeader(sheetRows) >= 0) return sheetRows;
  }
  return fallback;
}

async function readDelimitedFile(file: File, extension: string) {
  return new Promise<Cell[][]>((resolve, reject) => {
    Papa.parse<Cell[]>(file, {
      delimiter: extension === "tsv" ? "\t" : "",
      skipEmptyLines: true,
      complete: (result) => resolve(result.data as Cell[][]),
      error: reject,
    });
  });
}

export function SimplifiedImport() {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileHash, setFileHash] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [referenceDate, setReferenceDate] = useState("");
  const [rows, setRows] = useState<SimplifiedRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reading, setReading] = useState(false);
  const [done, setDone] = useState(false);

  function reset(keepPlan = false) {
    setFile(null);
    setFileHash("");
    if (!keepPlan) setPlanCode("");
    setReferenceDate("");
    setRows([]);
    setError("");
    setDone(false);
    if (input.current) input.current.value = "";
  }
  async function read(selected?: File) {
    if (!selected) return;
    const extension = selected.name.toLowerCase().split(".").pop();
    if (!extension || !supportedExtensions.includes(extension)) {
      setError(
        "Formato não reconhecido. Use XLS, XLSX, XLSM, XLSB, XLTX, XLTM, ODS, CSV ou TSV.",
      );
      return;
    }
    if (selected.size > maxFileSize) {
      setError("O arquivo excede o limite de 10 MB.");
      return;
    }
    setReading(true);
    setFile(selected);
    setReferenceDate(localIsoDate());
    setRows([]);
    setError("");
    try {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await selected.arrayBuffer(),
      );
      setFileHash(
        [...new Uint8Array(digest)]
          .map((value) => value.toString(16).padStart(2, "0"))
          .join(""),
      );
      const rawRows = excelExtensions.includes(extension)
        ? await readExcelWorkbook(selected)
        : await readDelimitedFile(selected, extension);
      const mapped = mapRows(rawRows, selected.name);
      if (
        !mapped.length ||
        mapped.some(
          (row) =>
            !row.ordem ||
            !row.prensa ||
            !row.ferramenta ||
            !row.liga ||
            (row.unidade === "kg"
              ? row.kg <= 0
              : !row.quantidade || row.quantidade <= 0),
        )
      )
        throw new Error(
          "Existem linhas inválidas. Confira Cód. Ferr, Certif., quantidade e a prensa no título da Simplificada.",
        );
      if (new Set(mapped.map((row) => row.prensa)).size !== 1)
        throw new Error(
          "A Simplificada deve representar uma única prensa. Separe as programações por prensa antes de importar.",
        );
      setRows(mapped);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : "";
      setError(
        detail.toLowerCase().includes("password") ||
          detail.toLowerCase().includes("encrypt")
          ? "A planilha está protegida por senha. Remova a proteção e tente novamente."
          : detail || "Não foi possível ler a planilha.",
      );
    } finally {
      setReading(false);
    }
  }

  async function commit() {
    setLoading(true);
    setError("");
    try {
      const normalizedPlan = normalizePlanCode(planCode);
      if (!normalizedPlan)
        throw new Error(
          "Informe o número da Simplificada (Plano) antes de importar.",
        );
      if (isSupabaseConfigured()) {
        const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
        if (!organizationId)
          throw new Error("Organizacao padrao nao configurada.");
        const supabase = createClient();
        const { data: previousFile, error: previousFileError } = await supabase
          .from("simplified_imports")
          .select("id,file_name,created_at")
          .eq("organization_id", organizationId)
          .eq("file_hash", fileHash)
          .eq("status", "processed")
          .maybeSingle();
        if (previousFileError) throw previousFileError;
        if (previousFile)
          throw new Error(
            `Este mesmo arquivo já foi importado em ${new Date(previousFile.created_at).toLocaleString("pt-BR")}. Use Reprogramar na Produção ou importe uma versão atualizada.`,
          );
        const machinePayload = [...new Set(rows.map((row) => row.prensa))].map(
          (code) => ({
            organization_id: organizationId,
            code,
            name: `Prensa ${code}`,
            is_active: true,
          }),
        );
        const { error: machinesError } = await supabase
          .from("machines")
          .upsert(machinePayload, {
            onConflict: "organization_id,code",
            ignoreDuplicates: true,
          });
        if (machinesError) throw machinesError;
        const { data: batch, error: batchError } = await supabase
          .from("simplified_imports")
          .insert({
            organization_id: organizationId,
            file_name: file?.name,
            file_hash: fileHash,
            machine_code: rows[0].prensa,
            plan_code: normalizedPlan,
            row_count: rows.length,
            status: "processing",
            is_active: false,
          })
          .select("id")
          .single();
        if (batchError) throw batchError;
        const generatedIdentities = new Map<string, number>();
        const payload = rows.map((row, index) => {
          const baseOrder = generatedOrder(
            normalizedPlan,
            row.item || String(index + 1),
            row.sequencia || "",
            row.sourceRow || index + 1,
          );
          const occurrence = generatedIdentities.get(baseOrder) ?? 0;
          generatedIdentities.set(baseOrder, occurrence + 1);
          const orderNumber =
            occurrence === 0 ? baseOrder : `${baseOrder}-${index + 1}`;
          return {
            organization_id: organizationId,
            import_batch_id: batch.id,
            order_number: orderNumber,
            plan_code: normalizedPlan,
            machine_code: row.prensa,
            tool_code: row.ferramenta,
            product_code: row.perfil || null,
            customer_name: row.cliente || null,
            alloy_code: row.liga,
            temper: row.tempera || null,
            target_kg: row.kg > 0 ? row.kg : null,
            target_quantity: row.quantidade || null,
            demand_unit: row.unidade,
            is_active: row.ativa,
            due_date: /^\d{4}-\d{2}-\d{2}$/.test(row.data) ? row.data : null,
            sequence: index + 1,
            status: "planned",
            requires_tool_heating: true,
            notes: row.observacao || null,
            source_data: {
              ...row,
              plano: normalizedPlan,
              ordem: orderNumber,
              importDate: referenceDate,
            },
          };
        });
        const { error: orderError } = await supabase
          .from("production_orders")
          .insert(payload);
        if (orderError) {
          await supabase
            .from("simplified_imports")
            .update({
              status: "failed",
              is_active: false,
              error_details: orderError,
              processed_at: null,
            })
            .eq("id", batch.id);
          throw orderError;
        }
        const { error: finishError } = await supabase
          .from("simplified_imports")
          .update({
            status: "processed",
            is_active: rows.some((row) => row.ativa),
            row_count: rows.length,
            processed_at: new Date().toISOString(),
          })
          .eq("id", batch.id);
        if (finishError) throw finishError;
      }
      requestOfflineSync();
      setDone(true);
    } catch (cause) {
      const detail =
        typeof cause === "object" && cause !== null
          ? ["message", "details", "hint", "code"]
              .map((key) =>
                String((cause as Record<string, unknown>)[key] ?? ""),
              )
              .filter(Boolean)
              .join(" · ")
          : "";
      setError(
        detail ||
          (cause instanceof Error
            ? cause.message
            : "Falha ao importar ordens."),
      );
    } finally {
      setLoading(false);
    }
  }

  if (done)
    return (
      <div className="rounded-xl border bg-white p-8 text-center shadow-sm">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="size-6" />
        </span>
        <h2 className="font-heading mt-3 text-lg font-bold">
          Programação importada
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Plano {normalizePlanCode(planCode)} · {rows.length} itens criados;{" "}
          {rows.filter((row) => row.ativa).length} ativos para produção.
        </p>
        <Button onClick={() => reset()} variant="outline" className="mt-4">
          <RotateCcw className="size-4" />
          Nova importação
        </Button>
      </div>
    );
  const activeCount = rows.filter((row) => row.ativa).length;
  return (
    <section className="rounded-xl border bg-white shadow-sm">
      <div className="grid gap-3 border-b p-4 lg:grid-cols-[220px_220px_1fr] lg:items-center">
        <div>
          <h2 className="font-heading font-bold">Arquivo da Simplificada</h2>
          <p className="text-xs text-slate-500">Excel do PCP, até 10 MB.</p>
        </div>
        <label className="rounded-xl border border-orange-200 bg-orange-50/50 px-3 py-2">
          <span className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-orange-700">
            <ClipboardList className="size-3.5" /> Plano obrigatório
          </span>
          <Input
            value={planCode}
            onChange={(event) => setPlanCode(event.target.value)}
            inputMode="numeric"
            aria-required="true"
            className="h-9 border-orange-200 bg-white text-base font-bold"
            placeholder="Ex.: 17243"
          />
        </label>
        <input
          ref={input}
          type="file"
          accept={fileAccept}
          className="hidden"
          onChange={(event) => void read(event.target.files?.[0])}
        />
        <button
          onClick={() => input.current?.click()}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            void read(event.dataTransfer.files[0]);
          }}
          className="flex min-h-20 flex-1 items-center gap-4 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50/60 px-5 text-left transition hover:border-orange-300 hover:bg-orange-50/30"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-orange-50 text-orange-600">
            {reading ? (
              <Loader2 className="size-5 animate-spin" />
            ) : (
              <UploadCloud className="size-5" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <b className="block truncate text-sm">
              {file?.name || "Arraste o arquivo ou clique para selecionar"}
            </b>
            <span className="text-xs text-slate-400">
              XLS · XLSX · XLSM · XLSB · ODS · CSV · TSV
            </span>
          </span>
          {file && (
            <span
              onClick={(event) => {
                event.stopPropagation();
                reset(true);
              }}
              className="grid size-8 place-items-center rounded-md hover:bg-white"
            >
              <X className="size-4" />
            </span>
          )}
        </button>
      </div>
      {error && (
        <Alert variant="destructive" className="m-4">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {!rows.length ? (
        <div className="grid min-h-64 place-items-center p-8 text-center text-slate-400">
          <div>
            <FileSpreadsheet className="mx-auto size-9 stroke-1" />
            <p className="mt-3 text-sm">
              Selecione a Simplificada para validar os itens.
            </p>
            <p className="mt-1 text-xs">
              A prensa é reconhecida pelo título e a coluna “Ativa” define a
              programação vigente.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-4 gap-3 border-b bg-slate-50/70 px-4 py-3">
            <Summary label="Itens encontrados" value={rows.length} />
            <Summary label="Programações ativas" value={activeCount} accent />
            <Summary
              label="Inativas (histórico)"
              value={rows.length - activeCount}
            />
            <SummaryText
              label="Plano informado"
              value={normalizePlanCode(planCode) || "Obrigatório"}
              accent={Boolean(normalizePlanCode(planCode))}
            />
          </div>
          <div className="max-h-[calc(100dvh-390px)] min-h-52 overflow-auto">
            <table className="w-full min-w-[900px] text-left text-[11px]">
              <thead className="sticky top-0 z-10 bg-slate-50 text-[9px] uppercase tracking-wider text-slate-500">
                <tr>
                  {[
                    "Ativa",
                    "Ordem gerada",
                    "Item / Seq.",
                    "Prensa",
                    "Ferramenta",
                    "Cliente / observação",
                    "Liga",
                    "Demanda",
                  ].map((header) => (
                    <th key={header} className="px-3 py-2.5">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={`${row.ordem}-${index}`}
                    className={
                      row.ativa
                        ? "border-t"
                        : "border-t bg-slate-50 text-slate-400"
                    }
                  >
                    <td className="px-3 py-2.5">
                      <span
                        className={
                          row.ativa
                            ? "rounded-full bg-emerald-50 px-2 py-1 font-bold text-emerald-700"
                            : "rounded-full bg-slate-100 px-2 py-1 font-bold text-slate-500"
                        }
                      >
                        {row.ativa ? "ATIVA" : "INATIVA"}
                      </span>
                    </td>
                    <td className="px-3 font-mono font-semibold">
                      {displayDate(referenceDate)} | Prensa{" "}
                      {displayMachine(row.prensa)} | Plano{" "}
                      {normalizePlanCode(planCode) || "—"}
                    </td>
                    <td className="px-3">
                      {row.item || "—"} / {row.sequencia || "—"}
                    </td>
                    <td className="px-3 font-semibold">{row.prensa}</td>
                    <td className="px-3 font-mono font-semibold text-orange-600">
                      {row.ferramenta}
                    </td>
                    <td
                      className="max-w-64 truncate px-3"
                      title={row.observacao || row.cliente}
                    >
                      {row.observacao || row.cliente || "—"}
                    </td>
                    <td className="px-3">
                      {row.liga} {row.tempera}
                    </td>
                    <td className="px-3 font-semibold">{formatDemand(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-4 border-t p-4">
            <p className="text-xs text-slate-500">
              Somente itens ativos aparecerão normalmente para o operador.
            </p>
            <Button
              onClick={commit}
              disabled={
                loading || Boolean(error) || !normalizePlanCode(planCode)
              }
              className="min-w-56 bg-orange-500 font-semibold hover:bg-orange-600"
            >
              {loading ? (
                <>
                  <Loader2 className="animate-spin" />
                  Importando...
                </>
              ) : (
                <>
                  Importar {rows.length} itens · {activeCount} ativos
                </>
              )}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function Summary({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p
        className={
          accent
            ? "text-lg font-black text-emerald-600"
            : "text-lg font-black text-slate-800"
        }
      >
        {value}
      </p>
    </div>
  );
}
function SummaryText({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <p
        className={
          accent
            ? "text-lg font-black text-orange-600"
            : "text-lg font-black text-slate-500"
        }
      >
        {value}
      </p>
    </div>
  );
}
function formatDemand(row: SimplifiedRow) {
  return row.unidade === "kg"
    ? `${row.kg.toLocaleString("pt-BR")} kg`
    : `${(row.quantidade ?? 0).toLocaleString("pt-BR")} ${row.unidade === "bars" ? "barras" : "peças"}`;
}
