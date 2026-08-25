"use client";

import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { createClient } from "@/lib/supabase/client";

type Cell = string | number | boolean | Date | null;
type RawRow = Record<string, Cell>;
type PreviewRow = {
  code: string;
  matrix_code: string;
  sequence_number: number;
  holes: number | null;
  theoretical_linear_weight_kg_m: number | null;
  useful_life_kg: number | null;
  produced_kg: number | null;
  remaining_kg: number | null;
  source_status: string | null;
  source_available: boolean;
  machine_codes: string | null;
  payload: Record<string, unknown>;
};

const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const text = (value: Cell) => String(value ?? "").trim();
const number = (value: Cell) => {
  if (value === null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Number(text(value).replace(/\./g, "").replace(",", ".").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
};
const bool = (value: Cell) => /^(sim|s|yes|true|1)$/i.test(text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
const date = (value: Cell) => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && value > 20000) return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  const candidate = text(value);
  if (!candidate) return null;
  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
};
const serializable = (row: RawRow) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));

function value(row: RawRow, ...aliases: string[]) {
  const keys = Object.keys(row);
  const match = keys.find(key => aliases.includes(normalize(key)));
  return match ? row[match] : null;
}

async function parseWorkbook(file: File) {
  const [XLSX, codepage] = await Promise.all([import("xlsx"), import("xlsx/dist/cpexcel.full.mjs")]);
  XLSX.set_cptable(codepage);
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheets = workbook.SheetNames.map(name => ({ name, rows: XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: null, raw: true }) as RawRow[] }));
  const main = sheets.find(sheet => sheet.rows.some(row => value(row, "matriz") != null && value(row, "seq", "sequencia") != null));
  if (!main) throw new Error("Não encontrei as colunas Matriz e Seq no relatório.");

  const availability = new Map<string, boolean>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      const status = text(value(row, "statusdaferram", "statusdaferramenta", "tipo"));
      const available = value(row, "disponivel", "ativo");
      if (status && available != null) availability.set(normalize(status), bool(available));
    }
  }

  const mapped = main.rows.map((row, index) => {
    const matrix = text(value(row, "matriz")).toUpperCase();
    const sequence = Math.trunc(number(value(row, "seq", "sequencia")) ?? 0);
    const sourceStatus = text(value(row, "statusdaferram", "statusdaferramenta"));
    const available = availability.get(normalize(sourceStatus)) ?? bool(value(row, "ativa"));
    const producedKg = number(value(row, "qteprod", "quantidadeproduzida"));
    const payload = {
      organization_id: organizationId,
      code: `HIST:${matrix}:${String(sequence).padStart(3, "0")}`,
      description: `Matriz ${matrix} · Seq. ${sequence}`,
      matrix_code: matrix,
      sequence_number: sequence,
      holes: number(value(row, "furos")),
      ba_cp: text(value(row, "bacp")) || null,
      bo: text(value(row, "bo")) || null,
      bat: text(value(row, "bat")) || null,
      ft: text(value(row, "ft")) || null,
      theoretical_linear_weight_kg_m: number(value(row, "pslinear")),
      actual_linear_weight_kg_m: number(value(row, "psreal")),
      useful_life_kg: number(value(row, "vidautil")),
      produced_kg: producedKg,
      lifecycle_kg: producedKg ?? 0,
      remaining_kg: number(value(row, "qterest")),
      useful_life_pct: number(value(row, "vdutil")),
      actual_efficiency_pct: number(value(row, "eficreal")),
      productivity_kg_h: text(value(row, "kghora")) || null,
      source_status: sourceStatus || null,
      source_available: available,
      status: available ? "available" : "inactive",
      observation: text(value(row, "observacao")) || null,
      machine_codes: text(value(row, "pren")) || null,
      last_used_at: date(value(row, "datauso")),
      registered_at: date(value(row, "dtcadastro")),
      supplier: text(value(row, "corretor")) || null,
      nitriding_life_kg: number(value(row, "vdnitret")),
      box: text(value(row, "box")) || null,
      package_width_mm: number(value(row, "medidapacote")),
      package_height_mm: number(value(row, "diametro")),
      source_active: bool(value(row, "ativa")),
      production_line: text(value(row, "linha")) || null,
      programming_notes: text(value(row, "obsprog")) || null,
      approved_at: date(value(row, "dtaprov")),
      delivered_at: date(value(row, "dtentrega")),
      customer: text(value(row, "cliente")) || null,
      allocated_balance_kg: number(value(row, "sldaloc")),
      source_file: file.name,
      source_row: index + 2,
      source_data: serializable(row),
    };
    return { code: payload.code, matrix_code: matrix, sequence_number: sequence, holes: payload.holes, theoretical_linear_weight_kg_m: payload.theoretical_linear_weight_kg_m, useful_life_kg: payload.useful_life_kg, produced_kg: producedKg, remaining_kg: payload.remaining_kg, source_status: payload.source_status, source_available: available, machine_codes: payload.machine_codes, payload } satisfies PreviewRow;
  }).filter(row => row.matrix_code && row.sequence_number >= 0);

  if (!mapped.length) throw new Error("O relatório não possui linhas válidas de ferramentas.");
  return mapped;
}

export function ToolHistoryImport({ onImported }: { onImported: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  function reset() { setFileName(""); setRows([]); setError(""); setDone(false); setProgress(0); if (inputRef.current) inputRef.current.value = ""; }
  async function read(file?: File) {
    if (!file) return;
    setReading(true); setError(""); setDone(false); setRows([]); setFileName(file.name);
    try {
      if (!/\.(xlsx|xls|xlsm|xlsb)$/i.test(file.name)) throw new Error("Use um arquivo Excel XLSX, XLS, XLSM ou XLSB.");
      setRows(await parseWorkbook(file));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível ler o relatório."); }
    finally { setReading(false); }
  }
  async function commit() {
    if (!organizationId) { setError("Organização padrão não configurada."); return; }
    setImporting(true); setError(""); setProgress(0);
    try {
      const supabase = createClient();
      const chunkSize = 200;
      for (let start = 0; start < rows.length; start += chunkSize) {
        const chunk = rows.slice(start, start + chunkSize).map(row => row.payload);
        const { error: importError } = await supabase.from("tools").upsert(chunk, { onConflict: "organization_id,code" });
        if (importError) throw importError;
        setProgress(Math.round(Math.min(rows.length, start + chunkSize) / rows.length * 100));
      }
      setDone(true); onImported();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível importar o histórico."); }
    finally { setImporting(false); }
  }

  return <>
    <Button type="button" className="bg-orange-500 font-semibold hover:bg-orange-600" onClick={() => setOpen(true)}><Upload className="size-4" />Importar histórico Excel</Button>
    <Sheet open={open} onOpenChange={value => { setOpen(value); if (!value && !importing) reset(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-3xl">
        <SheetHeader className="border-b px-6 py-5 pr-16"><SheetTitle>Importar histórico de ferramentas</SheetTitle><SheetDescription>Use o relatório F_Historico_Ferramentas. A combinação Matriz + Seq. identifica cada ferramenta física.</SheetDescription><Button type="button" variant="ghost" size="icon" className="absolute right-4 top-4" onClick={() => setOpen(false)} disabled={importing} aria-label="Fechar"><X className="size-4" /></Button></SheetHeader>
        <div className="space-y-5 p-6">
          <input ref={inputRef} className="hidden" type="file" accept=".xlsx,.xls,.xlsm,.xlsb" onChange={event => void read(event.target.files?.[0])} />
          <button type="button" onClick={() => inputRef.current?.click()} disabled={reading || importing} className="flex min-h-36 w-full flex-col items-center justify-center rounded-xl border border-dashed border-orange-200 bg-orange-50/40 text-center hover:bg-orange-50 disabled:opacity-60">
            {reading ? <Loader2 className="size-8 animate-spin text-orange-500" /> : <FileSpreadsheet className="size-8 text-orange-500" />}<strong className="mt-3 text-sm">{fileName || "Selecionar F_Historico_Ferramentas.xlsx"}</strong><span className="mt-1 text-xs text-slate-500">Matriz, Seq, Furos, pesos, vida útil, status, prensas e histórico</span>
          </button>
          {error && <div role="alert" className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</div>}
          {done && <div role="status" className="flex gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{rows.length.toLocaleString("pt-BR")} registros importados ou atualizados.</div>}
          {rows.length > 0 && <>
            <div className="flex items-center justify-between"><div><h3 className="font-semibold">Pré-visualização</h3><p className="text-xs text-slate-500">{rows.length.toLocaleString("pt-BR")} registros válidos encontrados.</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">Matriz + sequência</span></div>
            <div className="max-h-[360px] overflow-auto rounded-xl border"><table className="w-full min-w-[760px] text-left text-xs"><thead className="sticky top-0 bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-2">Matriz</th><th className="px-3 py-2">Seq.</th><th className="px-3 py-2">Furos</th><th className="px-3 py-2">Ps. linear</th><th className="px-3 py-2">Produzido</th><th className="px-3 py-2">Vida útil</th><th className="px-3 py-2">Prensas</th><th className="px-3 py-2">Situação</th></tr></thead><tbody>{rows.slice(0, 100).map(row => <tr key={row.code} className="border-t"><td className="px-3 py-2 font-mono font-bold text-orange-600">{row.matrix_code}</td><td className="px-3 py-2">{row.sequence_number}</td><td className="px-3 py-2">{row.holes ?? "—"}</td><td className="px-3 py-2">{row.theoretical_linear_weight_kg_m?.toLocaleString("pt-BR") ?? "—"}</td><td className="px-3 py-2">{row.produced_kg?.toLocaleString("pt-BR") ?? "—"} kg</td><td className="px-3 py-2">{row.useful_life_kg?.toLocaleString("pt-BR") ?? "—"} kg</td><td className="px-3 py-2">{row.machine_codes || "—"}</td><td className="max-w-44 truncate px-3 py-2" title={row.source_status || ""}>{row.source_status || (row.source_available ? "Disponível" : "Inativa")}</td></tr>)}</tbody></table></div>
            {importing && <div><div className="mb-2 flex justify-between text-xs text-slate-500"><span>Gravando no cadastro...</span><span>{progress}%</span></div><Progress value={progress} /></div>}
            <Button type="button" onClick={() => void commit()} disabled={importing || done} className="h-11 w-full bg-orange-500 font-semibold hover:bg-orange-600">{importing ? <><Loader2 className="animate-spin" />Importando...</> : done ? <><CheckCircle2 />Importação concluída</> : <>Importar {rows.length.toLocaleString("pt-BR")} ferramentas</>}</Button>
          </>}
        </div>
      </SheetContent>
    </Sheet>
  </>;
}
