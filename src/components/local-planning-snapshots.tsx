"use client";

import { useRef, useState, type FormEvent } from "react";
import { Archive, CalendarClock, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  LocalPlanningSnapshotKind,
  LocalPlanningSnapshotSummary,
  LocalPlanningSnapshotView,
} from "@/lib/local-db/planning-snapshots";

type SnapshotRecord = Record<string, unknown>;
type SnapshotResult = {
  page: number;
  pageSize: number;
  total: number;
  records: SnapshotRecord[];
};

function value(record: SnapshotRecord, key: string) {
  const entry = record[key];
  return entry === null || entry === undefined || entry === "" ? "—" : String(entry);
}

function number(valueToFormat: unknown) {
  return (Number(valueToFormat) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 1 });
}

function formatDate(valueToFormat: unknown) {
  if (typeof valueToFormat !== "string" || !valueToFormat) return "—";
  const date = new Date(valueToFormat);
  return Number.isNaN(date.getTime())
    ? valueToFormat
    : new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
}

export function LocalPlanningSnapshots({
  kind,
  initialSummary,
  initialResult,
}: {
  kind: LocalPlanningSnapshotKind;
  initialSummary: LocalPlanningSnapshotSummary;
  initialResult: SnapshotResult;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [result, setResult] = useState(initialResult);
  const [view, setView] = useState<LocalPlanningSnapshotView>("current");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const title = kind === "portfolio" ? "Carteira" : "Simplificadas";
  const activeCount = kind === "portfolio" ? summary.currentPortfolioRows : summary.activeSimplifiedOrders;
  const allCount = kind === "portfolio" ? summary.portfolioRows : summary.simplifiedBaselineRows;
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  async function load(nextView: LocalPlanningSnapshotView, nextPage: number, nextSearch: string) {
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ kind, view: nextView, page: String(nextPage) });
      if (nextSearch) params.set("search", nextSearch);
      const response = await fetch(`/api/local/planning-snapshots?${params}`, {
        cache: "no-store",
        signal: nextController.signal,
      });
      const payload = await response.json() as {
        error?: string;
        summary?: LocalPlanningSnapshotSummary;
        page: number;
        pageSize: number;
        total: number;
        records: SnapshotRecord[];
      };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar os registros.");
      if (nextController.signal.aborted) return;
      if (payload.summary) setSummary(payload.summary);
      setResult({ page: payload.page, pageSize: payload.pageSize, total: payload.total, records: payload.records });
      setView(nextView);
      setAppliedSearch(nextSearch);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar os registros.");
    } finally {
      if (!nextController.signal.aborted) setLoading(false);
    }
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(view, 0, search.trim().slice(0, 100));
  }

  const formatAmount = (record: SnapshotRecord, prefix: string) => {
    const serviceUnit = String(record.service_unit ?? "kg");
    if (serviceUnit === "pieces") return `${number(record[`${prefix}_pieces`])} peças`;
    return `${number(record[`${prefix}_kg`])} kg`;
  };

  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-3">
      <article className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{kind === "portfolio" ? "Pedidos no snapshot atual" : "Ordens da Simplificada ativa"}</p><p className="mt-2 text-2xl font-extrabold text-slate-900">{activeCount.toLocaleString("pt-BR")}</p></article>
      <article className="rounded-2xl border bg-white p-4 shadow-sm"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{kind === "portfolio" ? "Pedidos históricos preservados" : "Ordens históricas preservadas"}</p><p className="mt-2 text-2xl font-extrabold text-slate-900">{allCount.toLocaleString("pt-BR")}</p></article>
      <article className="rounded-2xl border bg-white p-4 shadow-sm"><p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500"><CalendarClock className="size-4" />Importação mais recente</p><p className="mt-2 text-sm font-bold text-slate-900">{kind === "portfolio" ? formatDate(summary.currentPortfolioImportedAt) : `${summary.activeSimplifiedImports.toLocaleString("pt-BR")} Simplificada(s) ativa(s)`}</p></article>
    </section>

    <section className="rounded-2xl border bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-heading text-lg font-bold text-slate-900">{title} importadas</h2><p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">Consulta dos dados da versão web preservados neste computador. A Simplificada original é mantida como baseline; esta tela não grava nem altera a programação.</p></div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(view, result.page, appliedSearch)}><RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`} />Atualizar</Button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Escolher conjunto de registros">
        <Button size="sm" variant={view === "current" ? "default" : "outline"} disabled={loading} onClick={() => void load("current", 0, appliedSearch)}>{kind === "portfolio" ? "Snapshot atual" : "Simplificadas ativas"} ({activeCount.toLocaleString("pt-BR")})</Button>
        <Button size="sm" variant={view === "all" ? "default" : "outline"} disabled={loading} onClick={() => void load("all", 0, appliedSearch)}>Todo o histórico ({allCount.toLocaleString("pt-BR")})</Button>
        <form className="ml-auto flex min-w-[min(100%,22rem)] flex-1 gap-2 sm:flex-none" onSubmit={submitSearch}>
          <Input aria-label={`Pesquisar em ${title.toLocaleLowerCase("pt-BR")}`} value={search} onChange={(event) => setSearch(event.target.value)} maxLength={100} placeholder="Pedido, cliente, prensa ou ferramenta" />
          <Button type="submit" disabled={loading}><Search className="mr-2 size-4" />Buscar</Button>
        </form>
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {loading ? <p role="status" className="py-10 text-center text-sm text-slate-500">Carregando registros…</p> : <>
        <div className="mt-4 overflow-auto rounded-xl border">
          {kind === "portfolio" ? <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Pedido / cliente</th><th className="px-3 py-3">Ferramenta</th><th className="px-3 py-3">Produto / liga</th><th className="px-3 py-3">Implantação</th><th className="px-3 py-3">Entrega</th><th className="px-3 py-3 text-right">Solicitado</th><th className="px-3 py-3 text-right">Saldo</th><th className="px-3 py-3">Situação</th></tr></thead>
            <tbody>{result.records.map((record) => <tr key={String(record.id)} className="border-t align-top hover:bg-orange-50/30"><td className="px-3 py-3"><strong className="block">{value(record, "order_number")}</strong><span className="text-xs text-slate-500">{value(record, "customer_name")} · {value(record, "customer_order_number")}</span></td><td className="px-3 py-3 font-mono font-bold text-orange-700">{value(record, "tool_code")}</td><td className="px-3 py-3">{value(record, "product_code")}<span className="block text-xs text-slate-500">Liga {value(record, "alloy_code")} · {value(record, "temper")}</span></td><td className="px-3 py-3">{formatDate(record.implantation_date)}</td><td className="px-3 py-3">{formatDate(record.due_date)}</td><td className="px-3 py-3 text-right tabular-nums">{formatAmount(record, "ordered")}</td><td className="px-3 py-3 text-right font-semibold tabular-nums">{formatAmount(record, "balance")}</td><td className="px-3 py-3">{value(record, "status")}</td></tr>)}</tbody>
          </table> : <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Plano / ordem</th><th className="px-3 py-3">Prensa</th><th className="px-3 py-3">Ferramenta</th><th className="px-3 py-3">Liga / têmpera</th><th className="px-3 py-3">Entrega</th><th className="px-3 py-3 text-right">Meta</th><th className="px-3 py-3 text-right">Produzido</th><th className="px-3 py-3">Situação</th></tr></thead>
            <tbody>{result.records.map((record) => <tr key={String(record.id)} className="border-t align-top hover:bg-orange-50/30"><td className="px-3 py-3"><strong className="block">{value(record, "plan_code")}</strong><span className="text-xs text-slate-500">#{value(record, "sequence_number")} · OP {value(record, "order_number")}</span>{record.customer_name ? <span className="block text-xs text-slate-500">{value(record, "customer_name")}</span> : null}</td><td className="px-3 py-3">{value(record, "machine_code")}</td><td className="px-3 py-3 font-mono font-bold text-orange-700">{value(record, "tool_code")}</td><td className="px-3 py-3">{value(record, "alloy_code")}<span className="block text-xs text-slate-500">{value(record, "temper")}</span></td><td className="px-3 py-3">{formatDate(record.due_date)}</td><td className="px-3 py-3 text-right tabular-nums">{number(record.target_kg)} kg</td><td className="px-3 py-3 text-right tabular-nums">{number(record.produced_kg)} kg</td><td className="px-3 py-3"><span className={record.is_current_plan ? "font-semibold text-emerald-700" : "text-slate-600"}>{record.is_current_plan ? "Ativa · baseline" : value(record, "status")}</span></td></tr>)}</tbody>
          </table>}
          {!result.records.length && <div className="grid min-h-40 place-items-center gap-2 p-6 text-center text-sm text-slate-500"><Archive className="size-5" />Nenhum registro corresponde à consulta.</div>}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <span>{result.total.toLocaleString("pt-BR")} registro(s) · página {result.page + 1} de {totalPages}</span>
          <div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading || result.page <= 0} onClick={() => void load(view, result.page - 1, appliedSearch)}>Anterior</Button><Button size="sm" variant="outline" disabled={loading || result.page + 1 >= totalPages} onClick={() => void load(view, result.page + 1, appliedSearch)}>Próxima</Button></div>
        </div>
      </>}
    </section>
  </div>;
}
