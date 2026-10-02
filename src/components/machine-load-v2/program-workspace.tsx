"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ClipboardList, FlaskConical, RefreshCw, Search, ShieldCheck } from "lucide-react";
import { generateRulePreview, moveScenarioRow, type ProgramSnapshot, type ProgramRow, type RuleScenario } from "@/modules/machine-load-v2/domain";
import { evaluateTemporalResources } from "@/modules/machine-load-v2/evaluator";

const number = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const statusNames: Record<string, string> = { planned: "Programada", released: "Liberada no cadastro", in_progress: "Em produção", paused: "Pausada" };
const button = "rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500";
function timestamp(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(date) : "Não informado";
}
function RowDetails({ row }: { row: ProgramRow }) {
  return <div className="grid gap-5 p-5 text-sm md:grid-cols-3">
    <section><h4 className="font-semibold">Acessórios exigidos</h4><p className="mt-2">Carcaça: <strong>{row.carcass ?? "A confirmar"}</strong></p><p className="text-xs text-slate-500">Fonte: {row.carcassSource}</p><p className="mt-2">BO: <strong>{row.bo ?? "A confirmar"}</strong></p><p className="text-xs text-slate-500">Fonte: {row.boSource}</p></section>
    <section><h4 className="font-semibold">Tempo e produtividade</h4><p className="mt-2">{number(row.productivity)} kg/h · {row.productivitySource}</p><p className="mt-2">Produção líquida estimada: {row.productiveMinutes === null ? "A confirmar" : number(row.productiveMinutes) + " min"}</p><p className="mt-1 text-xs text-slate-500">Não inclui montagem, aquecimento, esperas nem pausas. Não determina o horário de saída.</p><p className="mt-2">Início real: {row.actualStart ? timestamp(row.actualStart) : "Não registrado"}</p></section>
    <section><h4 className="font-semibold">O que ainda precisa ser conferido</h4><ul className="mt-2 list-disc space-y-1 pl-4 text-slate-600">{row.issues.map(issue => <li key={issue}>{issue}</li>)}{row.toolType === "unknown" && <li>Tipo sólida/tubular a confirmar no cadastro.</li>}</ul></section>
  </div>;
}
export function ProgramWorkspace({ snapshot }: { snapshot: ProgramSnapshot }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<"program" | "scenarios">("program");
  const [press, setPress] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [scenario, setScenario] = useState<RuleScenario | null>(null);
  const [scenarioOnlyProblems, setScenarioOnlyProblems] = useState(false);
  const [scenarioMoveReason, setScenarioMoveReason] = useState("");
  const [scenarioName, setScenarioName] = useState("");
  const [scenarioSaving, setScenarioSaving] = useState(false);
  const [scenarioNotice, setScenarioNotice] = useState("");
  const [scenarioError, setScenarioError] = useState("");
  const presses = [...new Set(snapshot.rows.map(row => row.press))];
  const normalized = search.trim().toLocaleLowerCase("pt-BR");
  const rows = snapshot.rows.filter(row => (!press || row.press === press) && (!normalized || [row.tool, row.order, row.alloy ?? ""].some(value => value.toLocaleLowerCase("pt-BR").includes(normalized))));
  const knownKg = rows.reduce((sum, row) => sum + (row.remainingKg ?? 0), 0);
  const missingVolumes = rows.filter(row => row.remainingKg === null).length;
  const issues = new Map<string, number>();
  rows.forEach(row => row.issues.forEach(issue => issues.set(issue, (issues.get(issue) ?? 0) + 1)));

  const scenarioRows = scenario?.rows.filter(row => {
    if (press && row.press !== press) return false;
    if (normalized && ![row.tool, row.order, row.alloy ?? ""].some(value => value.toLocaleLowerCase("pt-BR").includes(normalized))) return false;
    if (scenarioOnlyProblems) return scenario.evaluation?.rows.find(item => item.id === row.id)?.availability !== "available";
    return true;
  }) ?? [];
  const scenarioEvaluationRows = scenario?.evaluation?.rows ?? [];
  const scenarioIssueCounts = scenarioEvaluationRows.flatMap(item => item.issues).reduce((counts, issue) => counts.set(issue, (counts.get(issue) ?? 0) + 1), new Map<string, number>());
  const activeRows = tab === "scenarios" && scenario ? scenarioRows : rows;
  const moveScenario = (rowId: string, direction: -1 | 1) => {
    if (!scenario || !scenarioMoveReason.trim()) return;
    const moved = moveScenarioRow(scenario, rowId, direction, scenarioMoveReason);
    if (moved === scenario) return;
    moved.evaluation = evaluateTemporalResources(moved.rows, new Date(), snapshot.resources ?? { carcaças: [], bos: [], fornos: [] });
    setScenario(moved);
  };
  const saveScenarioDraft = async () => {
    if (!scenario || scenarioSaving || scenarioName.trim().length < 3) return;
    setScenarioSaving(true); setScenarioNotice(""); setScenarioError("");
    try {
      const response = await fetch("/api/simulation-scenarios", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        scenarioId: null,
        name: scenarioName.trim(),
        description: "Prévia operacional da nova Carga Máquina. Não aplicada à sequência oficial.",
        machineCode: press || snapshot.rows[0]?.press || "multi-prensa",
        mode: "manual",
        requestedStartAt: scenario.generatedAt,
        inputSnapshot: { source: "machine-load-v2", rows: snapshot.rows },
        rulesSnapshot: { modelVersion: "alupilot-v2.0", source: "rule-preview", press: press || null },
        resultSnapshot: { title: scenario.title, rows: scenario.rows, changes: scenario.changes, evaluation: scenario.evaluation ?? null, feasible: scenario.evaluation?.status === "viable" },
        analysisSnapshot: { recommendations: scenario.changes.map(change => ({ order: change.order, reason: change.reason })) },
      }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(payload?.error || "Não foi possível salvar o cenário.");
      setScenarioNotice(`Cenário salvo para revisão${payload?.versionNumber ? ` · versão ${payload.versionNumber}` : ""}. A programação oficial não foi alterada.`);
    } catch (error) { setScenarioError(error instanceof Error ? error.message : "Não foi possível salvar o cenário."); }
    finally { setScenarioSaving(false); }
  };

  return <div className="space-y-5" aria-busy={pending}>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
      <nav aria-label="Áreas da nova Carga Máquina" className="flex gap-2">
        <button type="button" aria-pressed={tab === "program"} onClick={() => setTab("program")} className={tab === "program" ? button + " !bg-slate-900 !text-white" : button}><ClipboardList className="mr-2 inline size-4" />Programação</button>
        <button type="button" aria-pressed={tab === "scenarios"} onClick={() => setTab("scenarios")} className={tab === "scenarios" ? button + " !bg-slate-900 !text-white" : button}><FlaskConical className="mr-2 inline size-4" />Cenários</button>
      </nav>
      <span className="flex items-center gap-2 text-xs text-slate-500"><ShieldCheck className="size-4" />Somente leitura · sequência oficial preservada</span>
    </div>
    {tab === "scenarios" ? <section className="space-y-5 rounded-2xl border bg-white p-6 md:p-8">
      <div><span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-semibold text-orange-700">Cenário separado</span><h2 className="mt-4 text-2xl font-bold">Testar antes de mudar.</h2><p className="mt-2 max-w-3xl text-sm text-slate-600">A prévia reorganiza apenas a cópia local por agrupamento de liga. A programação oficial continua intacta.</p></div>
      {!scenario ? <><ol className="grid gap-4 md:grid-cols-3">{["Ler a sequência oficial", "Agrupar ligas elegíveis", "Reavaliar recursos e impactos"].map((title, index) => <li key={title} className="rounded-xl bg-slate-50 p-5"><span className="text-xs font-semibold text-orange-600">0{index + 1}</span><h3 className="mt-2 font-semibold">{title}</h3></li>)}</ol><button className={button} onClick={() => { const preview = generateRulePreview(snapshot.rows); preview.evaluation = evaluateTemporalResources(preview.rows, new Date(), snapshot.resources ?? { carcaças: [], bos: [], fornos: [] }); setScenario(preview); }}>Gerar prévia por regras <ArrowRight className="ml-2 inline size-4" /></button><p className="text-xs text-slate-500">Não usa IA, não grava cenário e não aplica mudanças.</p></> :
        <><div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><div><strong>{scenario.title}</strong><p className="mt-1">Gerada em {timestamp(scenario.generatedAt)} · {scenario.changes.length} alteração(ões) de posição.</p></div><div className="flex gap-2"><button className={button} onClick={() => setScenario(null)}>Limpar prévia</button></div></div>
        <section className="flex flex-wrap items-end gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4"><label className="min-w-64 flex-1 text-xs font-semibold text-blue-950">Nome para o histórico<input value={scenarioName} onChange={event => setScenarioName(event.target.value)} className="mt-1 block w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm font-normal" placeholder="Ex.: Ajuste prensa 18 · turno manhã" /></label><button type="button" className={button} disabled={scenarioSaving || scenarioName.trim().length < 3} onClick={() => void saveScenarioDraft()}>{scenarioSaving ? "Salvando…" : "Salvar como rascunho"}</button><p className="basis-full text-xs text-blue-800">Salva uma cópia para revisão e auditoria. Não aprova nem altera a fila oficial.</p>{scenarioNotice && <p role="status" className="basis-full text-sm text-emerald-700">{scenarioNotice}</p>}{scenarioError && <p role="alert" className="basis-full text-sm text-red-700">{scenarioError}</p>}</section>
        {scenario.blockedReasons.length > 0 && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"><strong>Não validada fisicamente:</strong><ul className="mt-2 list-disc pl-5">{scenario.blockedReasons.slice(0, 6).map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
        {scenario.evaluation && <><div className={"rounded-xl border p-4 text-sm " + (scenario.evaluation.status === "blocked" ? "border-red-200 bg-red-50 text-red-900" : "border-amber-200 bg-amber-50 text-amber-900")}><strong>Reavaliação da proposta: {scenario.evaluation.status === "blocked" ? "conflitos encontrados" : scenario.evaluation.status === "incomplete" ? "dados incompletos" : "sem conflitos conhecidos"}</strong><p className="mt-1">{scenario.evaluation.conflicts} conflito(s) · {scenario.evaluation.unknowns} pendência(s) · {Math.round(scenario.evaluation.calendarWaitMinutes)} min de espera por calendário · {scenario.evaluation.lunchInterventions} intervenção(ões) na janela de almoço.</p></div><section className="space-y-3 rounded-xl border bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Onde estão os conflitos?</h3><p className="text-xs text-slate-500">A análise explica cada pendência por ordem. Nenhuma alteração foi aplicada.</p></div><button type="button" className={button} onClick={() => setScenarioOnlyProblems(value => !value)}>{scenarioOnlyProblems ? "Mostrar todas" : "Mostrar só pendências"}</button></div><div className="grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-red-50 p-3 text-sm text-red-900"><strong>{scenario.evaluation.conflicts}</strong><span className="ml-1">ordem(ns) com conflito</span></div><div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900"><strong>{scenario.evaluation.unknowns}</strong><span className="ml-1">ordem(ns) com dado pendente</span></div><div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"><strong>{scenario.evaluation.rows.filter(item => item.availability === "available").length}</strong><span className="ml-1">ordem(ns) sem conflito conhecido</span></div></div>{scenarioIssueCounts.size > 0 && <ul className="grid gap-2 text-xs text-slate-600 md:grid-cols-2">{[...scenarioIssueCounts].sort((left, right) => right[1] - left[1]).slice(0, 8).map(([issue, count]) => <li key={issue} className="rounded-lg border bg-slate-50 px-3 py-2"><strong>{count}×</strong> {issue}</li>)}</ul>}</section></>}
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4"><div className="flex-1"><label className="text-xs font-semibold text-violet-900">Motivo do ajuste manual<input value={scenarioMoveReason} onChange={event => setScenarioMoveReason(event.target.value)} className="mt-1 block w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm" placeholder="Ex.: carcaça liberada para antecipar esta ordem" /></label></div><p className="max-w-sm text-xs text-violet-800">Use as setas na tabela para testar uma troca. Ordens já iniciadas não podem ser movidas.</p></div>
        <div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-sm"><thead className="border-b bg-slate-50 text-xs text-slate-500"><tr>{["Nova posição", "Ferramenta / ordem", "Liga", "Posição oficial", "Validação", "Motivo", "Ajustar"].map(label => <th key={label} className="whitespace-nowrap px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{activeRows.map(row => { const change = scenario.changes.find(item => item.id === row.id); const result = scenario.evaluation?.rows.find(item => item.id === row.id); return <tr key={row.id} className="border-b"><td className="px-4 py-3 font-mono">{row.position ?? "—"}</td><td className="px-4 py-3"><strong>{row.tool}</strong><p className="text-xs text-slate-500">{row.order}</p></td><td className="px-4 py-3">{row.alloy ?? "A confirmar"}</td><td className="px-4 py-3">{change?.from ?? row.position ?? "—"}</td><td className="px-4 py-3"><span className={"whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium " + (result?.availability === "conflict" ? "bg-red-100 text-red-800" : result?.availability === "unknown" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")}>{result?.availability === "conflict" ? "Conflito" : result?.availability === "unknown" ? "Pendente" : "Sem conflito"}</span></td><td className="px-4 py-3 text-xs text-slate-600">{result?.issues.slice(-2).join(" · ") || change?.reason || "Mantida"}</td><td className="px-4 py-3"><div className="flex gap-1"><button type="button" disabled={!scenarioMoveReason.trim() || Boolean(row.actualStart)} className="rounded border px-2 py-1 text-xs disabled:opacity-40" onClick={() => moveScenario(row.id, -1)} aria-label={`Mover ${row.tool} para cima`}>↑</button><button type="button" disabled={!scenarioMoveReason.trim() || Boolean(row.actualStart)} className="rounded border px-2 py-1 text-xs disabled:opacity-40" onClick={() => moveScenario(row.id, 1)} aria-label={`Mover ${row.tool} para baixo`}>↓</button></div></td></tr>})}</tbody></table></div>
        <p className="text-xs text-slate-500">A prévia é somente leitura. Para aplicar uma troca, será necessário corrigir as pendências e registrar uma aprovação explícita; a sequência oficial continua preservada.</p></>}
      <button className={button} onClick={() => setTab("program")}>Voltar à programação <ArrowRight className="ml-2 inline size-4" /></button>
    </section> : <>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-slate-600">Prensa<select className="mt-1 block min-w-40 rounded-xl border bg-white p-2.5 text-sm text-slate-900" value={press} onChange={event => { setPress(event.target.value); setSelected(null); }}><option value="">Todas as prensas</option>{presses.map(code => <option key={code} value={code}>Prensa {code}</option>)}</select></label>
        <label className="min-w-60 flex-1 text-xs font-medium text-slate-600">Ferramenta, ordem ou liga<div className="mt-1 flex items-center gap-2 rounded-xl border bg-white px-3"><Search className="size-4 text-slate-400" /><input value={search} onChange={event => { setSearch(event.target.value); setSelected(null); }} className="w-full bg-transparent py-2.5 text-sm outline-none focus:ring-2 focus:ring-orange-300" placeholder="Buscar na sequência…" /></div></label>
        <button className={button} disabled={pending} onClick={() => startTransition(() => router.refresh())}><RefreshCw className={"mr-2 inline size-4 " + (pending ? "animate-spin" : "")} />{pending ? "Atualizando…" : "Atualizar"}</button>
      </div>
      <p role="status" className="text-xs text-slate-500">Leitura em {timestamp(snapshot.readAt)} · horário de Brasília. Atualizar consulta os registros; não recalcula nem reordena a fila.</p>
      {snapshot.error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-red-800">{snapshot.error}</div> : <>
        {snapshot.warnings.map(warning => <div key={warning} role="status" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">{warning}</div>)}
        {snapshot.evaluation && <div className={"rounded-xl border p-4 text-sm " + (snapshot.evaluation.status === "blocked" ? "border-red-200 bg-red-50 text-red-900" : snapshot.evaluation.status === "incomplete" ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-900")}>
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>Validação temporal · {snapshot.evaluation.status === "viable" ? "sem conflitos conhecidos" : snapshot.evaluation.status === "blocked" ? "conflitos encontrados" : "dados incompletos"}</strong><span>{snapshot.evaluation.conflicts} conflito(s) · {snapshot.evaluation.unknowns} pendência(s) de confirmação</span></div>
          <p className="mt-1 text-xs opacity-80">Reservas físicas e paradas cadastradas foram consideradas nesta leitura. {snapshot.evaluation.calendarWaitMinutes > 0 ? String(Math.round(snapshot.evaluation.calendarWaitMinutes)) + " min foram deslocados por parada." : "Nenhuma parada deslocou a fila."} {snapshot.evaluation.lunchInterventions > 0 ? String(snapshot.evaluation.lunchInterventions) + " ordem(ns) atravessam a janela de almoço." : "Nenhuma ordem atravessa a janela de almoço."}</p>
        </div>}
        <div className="grid gap-3 sm:grid-cols-3">
          {[["Ordens na seleção", String(rows.length)], [missingVolumes ? "Kg conhecidos · soma parcial" : "Kg restantes na seleção", number(knownKg) + " kg"], ["Término previsto", "A calcular"]].map(([label, value]) => <div key={label} className="rounded-2xl border bg-white p-5"><p className="text-xs text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold tracking-tight">{value}</p></div>)}
        </div>
        <details className="rounded-xl border bg-white px-4 py-3"><summary className="cursor-pointer text-sm font-medium">O que está pendente nesta leitura? {issues.size > 0 ? "(" + issues.size + " tipos de pendência cadastral)" : ""}</summary>
          <p className="mt-3 text-sm text-slate-600">A validação temporal usa as reservas e paradas cadastradas nesta leitura. “A confirmar” significa que o cadastro não permitiu concluir, não que o recurso esteja necessariamente em falta.</p>
          <ul className="mt-3 space-y-2 text-sm">{[...issues].map(([issue, count]) => <li key={issue}>{issue} <span className="text-slate-500">· {count} ordem(ns)</span></li>)}</ul>
        </details>
        {rows.length === 0 ? <div className="rounded-2xl border bg-white p-10 text-center"><h2 className="font-semibold">{snapshot.rows.length ? "Nenhuma ordem corresponde aos filtros" : "Nenhuma ordem ativa neste escopo"}</h2><p className="mt-2 text-sm text-slate-500">Somente ordens programadas, liberadas, em produção ou pausadas são exibidas.</p>{snapshot.rows.length > 0 && <button className={button + " mt-4"} onClick={() => { setPress(""); setSearch(""); }}>Limpar filtros</button>}</div> :
          presses.filter(code => rows.some(row => row.press === code)).map(code => <section key={code} className="overflow-hidden rounded-2xl border bg-white">
            <header className="flex items-center justify-between bg-slate-50 px-5 py-4"><h2 className="font-bold">Prensa {code}</h2><span className="text-xs text-slate-500">{rows.filter(row => row.press === code).length} ordens · sequência cadastrada</span></header>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="sr-only">Programação oficial da prensa {code}</caption><thead className="border-y text-xs text-slate-500"><tr>{["Posição", "Ferramenta / ordem", "Liga", "Kg restantes", "Disponibilidade", "Entrada / saída prevista", "Detalhes"].map(label => <th scope="col" key={label} className="whitespace-nowrap px-5 py-3 font-medium">{label}</th>)}</tr></thead>
              <tbody>{rows.filter(row => row.press === code).map(row => <ProgramLine key={row.id} row={row} selected={selected === row.id} onSelect={() => setSelected(selected === row.id ? null : row.id)} />)}</tbody>
            </table></div>
          </section>)}
      </>}
    </>}
  </div>;
}
function ProgramLine({ row, selected, onSelect }: { row: ProgramRow; selected: boolean; onSelect: () => void }) {
  return <><tr className={"border-b align-top " + (selected ? "bg-orange-50/50" : "hover:bg-slate-50/50")}>
    <td className="px-5 py-4 font-mono text-slate-500">{row.position ?? "—"}</td>
    <td className="min-w-52 px-5 py-4"><strong>{row.tool}</strong><span className="ml-2 text-xs text-slate-500">{row.physicalSequence !== null ? "Seq. física " + row.physicalSequence : "Seq. física a confirmar"}</span><p className="mt-1 text-xs text-slate-500">{row.order} · {statusNames[row.status] ?? row.status}</p><p className="mt-1 text-xs text-slate-500">Tipo: {row.toolType === "unknown" ? "a confirmar" : row.toolType === "solid" ? "sólida" : "tubular"}</p></td>
    <td className="px-5 py-4">{row.alloy ?? "A confirmar"}</td>
    <td className="whitespace-nowrap px-5 py-4 font-semibold">{row.remainingKg === null ? "A confirmar" : number(row.remainingKg)}</td>
    <td className="px-5 py-4"><span className="whitespace-nowrap rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">A confirmar</span></td>
    <td className="px-5 py-4 text-slate-500">A calcular</td>
    <td className="px-5 py-4"><button className="whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-orange-500" aria-expanded={selected} aria-controls={"detail-" + row.id} onClick={onSelect}>{selected ? "Recolher" : "Conferir"}<span className="sr-only"> ordem {row.order}</span></button></td>
  </tr><tr id={"detail-" + row.id} hidden={!selected} className="border-b bg-slate-50"><td colSpan={7}>{selected && <RowDetails row={row} />}</td></tr></>;
}
