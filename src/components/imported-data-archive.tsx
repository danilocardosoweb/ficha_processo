"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Archive, CheckCircle2, ChevronLeft, ChevronRight, Database, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LocalWebArchiveRecord, LocalWebArchiveSummary } from "@/lib/local-db/web-archive";

type ArchiveResult = {
  total: number;
  page: number;
  pageSize: number;
  records: LocalWebArchiveRecord[];
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(date);
}

function fieldSummary(payload: Record<string, unknown>) {
  const preferred = ["code", "tool_code", "matrix_code", "order_number", "machine_code", "name", "product_code", "alloy_code", "status", "created_at"];
  const keys = [...preferred.filter((key) => key in payload), ...Object.keys(payload).filter((key) => !preferred.includes(key))].slice(0, 5);
  return keys.map((key) => {
    const value = payload[key];
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return `${key.replaceAll("_", " ")}: ${(text ?? "—").slice(0, 90)}`;
  }).join(" · ");
}

export function ImportedDataArchive({ initialSummary }: { initialSummary: LocalWebArchiveSummary }) {
  const [summary, setSummary] = useState(initialSummary);
  const [selectedTable, setSelectedTable] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<ArchiveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!selectedTable) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ table: selectedTable, page: String(page) });
    if (appliedSearch) params.set("search", appliedSearch);

    async function loadRows() {
      try {
        const response = await fetch(`/api/local/imported-data?${params.toString()}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json() as { error?: string; summary?: LocalWebArchiveSummary } & ArchiveResult;
        if (!response.ok) throw new Error(data.error ?? "Falha ao consultar os registros.");
        if (data.summary) setSummary(data.summary);
        setResult({ total: data.total, page: data.page, pageSize: data.pageSize, records: data.records });
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError(cause instanceof Error ? cause.message : "Falha ao consultar os registros.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadRows();
    return () => controller.abort();
  }, [selectedTable, page, appliedSearch, refreshKey]);

  const normalizedTableSearch = tableSearch.trim().toLocaleLowerCase("pt-BR");
  const filteredTables = summary.tables.filter((table) => !normalizedTableSearch || table.key.toLocaleLowerCase("pt-BR").includes(normalizedTableSearch));
  const totalPages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 0;

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPage(0);
    setAppliedSearch(search.trim().slice(0, 100));
    setResult(null);
    setLoading(Boolean(selectedTable));
    setError("");
    setRefreshKey((value) => value + 1);
  }

  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-3">
      <article className="rounded-2xl border bg-white p-5"><Database className="size-5 text-emerald-600" /><p className="mt-3 text-sm font-bold text-slate-900">Registros preservados</p><p className="mt-1 text-2xl font-extrabold text-slate-900">{summary.archivedRows.toLocaleString("pt-BR")}</p></article>
      <article className="rounded-2xl border bg-white p-5"><Archive className="size-5 text-blue-600" /><p className="mt-3 text-sm font-bold text-slate-900">Tabelas da origem</p><p className="mt-1 text-2xl font-extrabold text-slate-900">{summary.tables.length}</p><p className="mt-1 text-xs text-slate-500">{summary.tables.filter((table) => table.expectedRows > 0).length} com registros</p></article>
      <article className="rounded-2xl border bg-white p-5"><CheckCircle2 className={`size-5 ${summary.integrityOk ? "text-emerald-600" : "text-amber-600"}`} /><p className="mt-3 text-sm font-bold text-slate-900">Conferência</p><p className="mt-1 text-sm font-semibold text-slate-700">{summary.integrityOk ? "Contagens conferidas" : "Sem importação validada"}</p><p className="mt-1 text-xs text-slate-500">{summary.sourceProjectName ?? "Origem indisponível"} · {formatDate(summary.importedAt)}</p></article>
    </div>

    {!summary.imported ? <div role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Ainda não existe uma importação registrada neste banco local.</div> : <div className="grid gap-5 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.7fr)]">
      <section className="rounded-2xl border bg-white p-5 shadow-sm">
        <h2 className="font-bold text-slate-900">Escolha uma tabela</h2>
        <p className="mt-1 text-sm text-slate-500">Inclui tabelas vazias; as contagens mostram quantos registros foram preservados.</p>
        <label className="mt-4 block text-sm font-semibold text-slate-700" htmlFor="archive-table-search">Filtrar tabelas</label>
        <Input id="archive-table-search" className="mt-1" value={tableSearch} onChange={(event) => setTableSearch(event.target.value)} placeholder="Ex.: process_sheets" />
        <ul className="mt-3 max-h-[35rem] space-y-1 overflow-y-auto pr-1" aria-label="Tabelas importadas">
          {filteredTables.map((table) => <li key={table.key}>
            <button
              type="button"
              aria-pressed={selectedTable === table.key}
              onClick={() => { setSelectedTable(table.key); setPage(0); setSearch(""); setAppliedSearch(""); setResult(null); setLoading(true); setError(""); setRefreshKey((value) => value + 1); }}
              className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${selectedTable === table.key ? "border-orange-300 bg-orange-50 text-orange-900" : "border-transparent hover:border-slate-200 hover:bg-slate-50"}`}
            >
              <span className="min-w-0 truncate font-medium">{table.key}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${table.expectedRows ? "bg-slate-100 text-slate-700" : "bg-slate-50 text-slate-400"}`}>{table.archivedRows.toLocaleString("pt-BR")}</span>
            </button>
          </li>)}
          {filteredTables.length === 0 && <li className="px-3 py-4 text-sm text-slate-500">Nenhuma tabela corresponde ao filtro.</li>}
        </ul>
      </section>

      <section className="min-w-0 rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-bold text-slate-900">{selectedTable || "Registros"}</h2><p className="mt-1 text-sm text-slate-500">Consulta somente leitura; os dados originais são mantidos como foram recebidos.</p></div>
          <Button variant="outline" size="sm" onClick={() => { setLoading(true); setError(""); setRefreshKey((value) => value + 1); }} disabled={!selectedTable || loading}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
        </div>
        <form className="mt-4 flex gap-2" onSubmit={submitSearch}>
          <Input aria-label="Pesquisar dentro da tabela selecionada" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Pesquisar nos registros desta tabela" maxLength={100} disabled={!selectedTable} />
          <Button type="submit" disabled={!selectedTable || loading}><Search className="mr-2 size-4" />Pesquisar</Button>
        </form>
        {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
        {!selectedTable && <div className="mt-8 rounded-2xl border border-dashed p-8 text-center text-sm text-slate-500">Selecione uma tabela para consultar os registros preservados.</div>}
        {selectedTable && loading && <p className="mt-6 text-sm text-slate-500" role="status">Carregando registros…</p>}
        {selectedTable && !loading && result && <>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500"><span>{result.total.toLocaleString("pt-BR")} registro(s) encontrados</span><span>Página {result.page + 1} de {totalPages}</span></div>
          <div className="mt-3 space-y-2">
            {result.records.map((record) => <details key={record.sourceKey} className="group rounded-xl border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer list-none px-4 py-3 marker:hidden">
                <span className="block break-all font-mono text-xs font-semibold text-slate-800">{record.sourceKey}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">{fieldSummary(record.payload)}</span>
              </summary>
              <pre className="max-h-96 overflow-auto border-t bg-white p-4 text-xs leading-5 text-slate-700">{JSON.stringify(record.payload, null, 2)}</pre>
            </details>)}
            {result.records.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center text-sm text-slate-500">Nenhum registro corresponde à pesquisa.</div>}
          </div>
          {totalPages > 1 && <div className="mt-4 flex items-center justify-between">
            <Button variant="outline" size="sm" onClick={() => { setPage((value) => Math.max(0, value - 1)); setResult(null); setLoading(true); setError(""); }} disabled={page === 0 || loading}><ChevronLeft className="mr-1 size-4" />Anterior</Button>
            <span className="text-xs text-slate-500">{result.page * result.pageSize + 1}–{Math.min((result.page + 1) * result.pageSize, result.total)} de {result.total.toLocaleString("pt-BR")}</span>
            <Button variant="outline" size="sm" onClick={() => { setPage((value) => Math.min(totalPages - 1, value + 1)); setResult(null); setLoading(true); setError(""); }}>Próxima<ChevronRight className="ml-1 size-4" /></Button>
          </div>}
        </>}
      </section>
    </div>}
  </div>;
}
