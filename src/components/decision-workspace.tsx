"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FieldHelp, HelpLabel, LoadHelpGuide } from "@/components/load-help";
import { PlanningOverview } from "@/components/planning-overview";
import { ProductionControlRoom } from "@/components/production-control-room";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { graphForProfile } from "@/modules/planning/decision-system/catalog";
import { evaluateDecision } from "@/modules/planning/decision-system/engine";
import { dueAt } from "@/modules/planning/decision-system/dates";
import { operationalTimes } from "@/modules/planning/decision-system/times";
import { pressPlansForSimulation, runCandidate, type DecisionCandidate, type DecisionContext, type ScenarioComparison, type ScenarioPressKpi, type ScenarioProgress, type ScenarioResult } from "@/modules/planning/decision-system/optimizer";
import { decisionPresets, factKeys, factLabels, metricKeys, metricLabels, profileSchema, type DecisionProfile, type CustomCriterion } from "@/modules/planning/decision-system/schema";
import type { PressProductivityResult, ShiftGoalResult } from "@/modules/planning/decision-system/shift-goals";

interface SavedVersion {
  id: string; name: string; version: number; current_version: number; document: DecisionProfile;
  reason: string; actor_name: string; created_at: string;
}
interface Props {
  context: DecisionContext;
  profile: DecisionProfile;
  canEdit: boolean;
  canAdjust: boolean;
  onProfile: (profile: DecisionProfile) => void;
  onApply: (candidate: DecisionCandidate) => void;
}
const fieldClass = "w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-950 focus:outline-2 focus:outline-orange-500";
const number = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const duration = (value: number) => { const minutes = Math.round(Math.max(value, 0)); return `${Math.floor(minutes / 60)}h ${minutes % 60}min`; };
const secondsLabel = (value: number) => value < 60 ? `${value}s` : `${Math.floor(value / 60)}min ${value % 60}s`;
const date = (value: Date | null) => value ? value.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "Não informado";
const pressName = (machineCode: string) => machineCode === "18" ? "P1.8" : machineCode === "19" ? "P1.9" : `P${machineCode}`;
const scenarioSignature = (scenario: ScenarioResult) => JSON.stringify({
  sequence: Object.entries(scenario.sequence).sort(([left], [right]) => left.localeCompare(right)),
  pressPlans: scenario.kpis.pressPlans.map((press) => ({
    machineCode: press.machineCode,
    plannedKg: press.plannedKg,
    plannedVolumeKgH: press.plannedVolumeKgH,
    workMinutes: press.workMinutes,
    scheduledMinutes: press.scheduledMinutes,
    turnsRequired: press.turnsRequired,
    toolChanges: press.toolChanges,
    toolChangeMinutes: press.toolChangeMinutes,
    setupMinutes: press.setupMinutes,
    waitingMinutes: press.waitingMinutes,
  })),
  totals: {
    projectedKg: scenario.kpis.projectedKg,
    totalBars: scenario.kpis.totalBars,
    endingBilletKg: scenario.kpis.endingBilletKg,
    lateOrders: scenario.kpis.lateOrders,
    setupMinutes: scenario.kpis.setupMinutes,
    thermalWaitMinutes: scenario.kpis.thermalWaitMinutes,
    resourceWaitMinutes: scenario.kpis.resourceWaitMinutes,
    remainderKg: scenario.candidate.evaluation.metrics.remainderKg,
  },
  excludedOrders: scenario.excludedOrders.map((item) => `${item.machineCode}:${item.orderId}:${item.reason}`).sort(),
});
const distinctScenarios = (scenarios: ScenarioResult[]) => {
  const original = scenarios.find((scenario) => scenario.id === "original");
  const ordered = original ? [original, ...scenarios.filter((scenario) => scenario.id !== "original")] : scenarios;
  const seen = new Set<string>();
  return ordered.filter((scenario) => {
    const signature = scenarioSignature(scenario);
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
};
const kindLabels = { hard: "Restrição obrigatória", soft: "Regra com penalidade", objective: "Objetivo", preference: "Preferência", informational: "Informação" };
const statusLabels = { viable: "Viável nos dados informados", blocked: "Há impedimentos", unconfirmed: "Falta confirmar dados" };
type Tab = "Resumo" | "Critérios" | "Mapa de decisão" | "Sala de controle" | "Alternativas" | "Por que esta posição?" | "Recursos no tempo" | "Histórico";
// A Central fica focada no que o operador precisa para decidir agora.
// As áreas administrativas e de diagnóstico continuam preservadas no código,
// mas saem da barra principal até haver uma necessidade operacional clara.
const visibleTabs: readonly Tab[] = ["Resumo", "Alternativas", "Recursos no tempo"];
function initialRule(): CustomCriterion {
  return { id: `rule-${crypto.randomUUID()}`, name: "Novo critério", description: "",
    module: "sequencing", kind: "soft", enabled: true, weight: 50, priority: 3, penalty: 40,
    conditions: [{ fact: "remainingKg", operator: "lt", value: 300 }], consecutive: 3 };
}
function PressProductivityCards({ presses }: { presses: PressProductivityResult[] }) {
  if (!presses.length) return null;
  return <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
    {presses.map((press) => <div className={`rounded-lg border bg-white/80 p-3 ${press.meetsProductivityTarget ? "border-emerald-200" : "border-amber-200"}`} key={press.machineCode}>
      <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold uppercase text-slate-500">Prensa {press.machineCode} · {press.shiftCount} turno(s)</span><span className={`text-xs font-bold ${press.meetsProductivityTarget ? "text-emerald-700" : "text-amber-800"}`}>{press.meetsProductivityTarget ? "Média na meta" : "Média abaixo"}</span></div>
      <p className="mt-1 font-black text-slate-950">{number(press.productivity.effectiveKgH)} kg/h</p>
      <p className="text-xs text-slate-600">Média operacional da janela ({press.productivity.basis}): {number(press.productivity.netKg)} kg ÷ {duration(press.productivity.capacityMinutes)} = {number(press.productivity.effectiveKgH)} kg/h</p>
      <p className="mt-1 text-xs text-slate-600">Extrusão {duration(press.productivity.extrusionMinutes)} · setup e esperas {duration(press.productivity.setupMinutes + press.productivity.heatingWaitMinutes + press.productivity.resourceWaitMinutes + press.productivity.laborWaitMinutes)} · sem carga {duration(press.productivity.noLoadMinutes)}</p>
      <p className="mt-1 text-xs font-semibold text-slate-700">{press.productivityGapKgH >= 0 ? "+" : ""}{number(press.productivityGapKgH)} kg/h para a meta por prensa</p>
    </div>)}
  </div>;
}
function PressProductivityByShift({ shifts }: { shifts: ShiftGoalResult[] }) {
  if (!shifts.length) return null;
  return <section className="mt-4 space-y-3">
    <div><h4 className="font-bold text-violet-950">Produtividade por turno e por prensa</h4><p className="text-xs text-violet-900">Cada prensa é medida separadamente em sua própria janela de {duration((shifts[0].endsAt.getTime() - shifts[0].startsAt.getTime()) / 60_000)}. Não há soma de horas entre prensas ou dias.</p></div>
    {shifts.map((shift) => <article className="rounded-lg border border-violet-200 bg-white/75 p-3" key={shift.startsAt.toISOString()}>
      <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm text-slate-950">Turno {shift.startsAt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} · {shift.startsAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}–{shift.endsAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</strong><span className={shift.meetsProductivityTarget ? "text-xs font-bold text-emerald-700" : "text-xs font-bold text-amber-800"}>{shift.meetsProductivityTarget ? "Prensas na meta" : "Há prensa abaixo da meta"}</span></div>
      <PressProductivityCards presses={shift.presses} />
    </article>)}
  </section>;
}
function PlannedVolumeByPress({ presses }: { presses: ScenarioPressKpi[] }) {
  if (!presses.length) return null;
  return <section className="mt-4"><div><h4 className="font-bold text-violet-950">Carga planejada por prensa</h4><p className="text-xs text-violet-900">A previsão de produtividade é a média simples das produtividades informadas na Simplificada. O tempo útil considera somente a extrusão; preparo, espera e parada ficam fora dele.</p></div><div className="mt-3 grid gap-3 lg:grid-cols-2">{presses.map((press) => <article className="rounded-xl border border-violet-200 bg-white/80 p-4" key={press.machineCode}><div className="flex items-center justify-between gap-2"><strong className="text-sm text-slate-950">Prensa {press.machineCode === "18" ? "1.8" : press.machineCode === "19" ? "1.9" : press.machineCode}</strong><span className="text-xs font-semibold text-slate-500">{press.turnsRequired} turno(s) útil(is) necessário(s)</span></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><div><span className="text-[11px] font-bold uppercase text-slate-500">Volume planejado</span><p className="font-black text-slate-950">{number(press.plannedKg)} kg</p></div><div><span className="text-[11px] font-bold uppercase text-slate-500">Previsão de término</span><p className="font-black text-slate-950">{date(press.endsAt)}</p><p className="text-xs text-slate-600">inicia {date(press.startsAt)} · inclui preparo e disponibilidade</p></div><div><span className="text-[11px] font-bold uppercase text-slate-500">Previsão de produtividade</span><p className="font-black text-slate-950">{number(press.plannedVolumeKgH)} kg/h</p><p className="text-xs text-slate-600">média de {press.productivitySampleCount} ferramenta(s) da Simplificada</p></div><div><span className="text-[11px] font-bold uppercase text-slate-500">Tempo útil de extrusão</span><p className="font-black text-slate-950">{duration(press.workMinutes)}</p><p className="text-xs text-slate-600">{press.toolChanges} troca(s) · {duration(press.toolChangeMinutes)} de tempo morto</p></div></div></article>)}</div></section>;
}
function ShiftGoalSummary({ evaluation, simulation }: { evaluation: ReturnType<typeof evaluateDecision>; simulation: DecisionCandidate["simulation"] }) {
  const report = evaluation.shiftGoals;
  const goal = report.goals;
  const pressPlans = pressPlansForSimulation(simulation);
  const forecastsAtGoal = pressPlans.filter((press) => press.plannedVolumeKgH >= goal.targetProductivityKgH).length;
  const amount = (value: number, digits = 0) => value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return <section className="rounded-xl border border-violet-200 bg-violet-50 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-violet-950">Objetivo de produtividade por prensa</h3><p className="text-sm text-violet-900">Para cada dia, as Prensas 18 e 19 têm sua própria janela de {goal.startTime} a {goal.endTime} ({duration((new Date(2000, 0, 1, 16, 10).getTime() - new Date(2000, 0, 1, 6, 30).getTime()) / 60_000)}). A referência é {amount(goal.targetProductivityKgH)} kg/h por prensa, comparada à previsão média das ferramentas.</p></div><strong className={forecastsAtGoal === pressPlans.length ? "rounded-full bg-emerald-100 px-3 py-1 text-sm text-emerald-900" : "rounded-full bg-amber-100 px-3 py-1 text-sm text-amber-900"}>{forecastsAtGoal}/{pressPlans.length} prensa(s) na meta prevista</strong></div>
    <PlannedVolumeByPress presses={pressPlans} />
    <details className="mt-4 rounded-lg border border-violet-200 bg-white/75 p-3"><summary className="cursor-pointer text-sm font-bold text-violet-950">Ver desempenho operacional por turno</summary><PressProductivityByShift shifts={report.shifts} /></details>
    <details className="mt-4 rounded-lg border border-violet-200 bg-white/75 p-3"><summary className="cursor-pointer text-sm font-bold text-violet-950">Ver acumulado da programação ({report.shifts.length} turno(s))</summary><div className="mt-3 grid gap-3 sm:grid-cols-5"><div><span className="text-xs font-bold uppercase text-slate-500">Produção acumulada</span><p className="font-black text-slate-950">{amount(report.projectedKg)} kg · {amount(report.projectedTonnes, 1)} t</p></div><div><span className="text-xs font-bold uppercase text-slate-500">Média operacional acumulada ({goal.productivityBasis})</span><p className="font-black text-slate-950">{amount(report.averageProductivityKgH)} kg/h</p><p className="text-xs text-slate-600">janela do turno; não é a previsão da Simplificada</p></div><div><span className="text-xs font-bold uppercase text-slate-500">Técnica</span><p className="font-black text-slate-950">{amount(report.productivity.technicalKgH)} kg/h</p><p className="text-xs text-slate-600">somente extrusão</p></div><div><span className="text-xs font-bold uppercase text-slate-500">Operacional</span><p className="font-black text-slate-950">{amount(report.productivity.operationalKgH)} kg/h</p><p className="text-xs text-slate-600">inclui setup e esperas</p></div><div><span className="text-xs font-bold uppercase text-slate-500">Cobertura / NO_LOAD</span><p className="font-black text-slate-950">{amount(report.productivity.loadCoveragePercent, 1)}% · {amount(report.productivity.noLoadMinutes)} min</p></div></div></details>
  </section>;
}

function ScenarioPressComparison({ machineCode, scenarios }: { machineCode: string; scenarios: ScenarioResult[] }) {
  const press = (scenario: ScenarioResult) => scenario.kpis.pressPlans.find((item) => item.machineCode === machineCode);
  return <section className="overflow-hidden rounded-xl border border-violet-200 bg-white">
    <div className="border-b border-violet-100 bg-violet-50 px-4 py-3"><h4 className="font-bold text-violet-950">Prensa {machineCode === "18" ? "1.8" : machineCode === "19" ? "1.9" : machineCode}</h4><p className="text-xs text-violet-900">A produtividade prevista é a média simples das ferramentas desta prensa na Simplificada. O turno inteiro é avaliado separadamente.</p></div>
    <div className="overflow-auto"><table className="w-full min-w-[900px] text-left text-sm"><thead><tr className="border-b bg-slate-50"><th className="p-3">Indicador</th>{scenarios.map((scenario) => <th className="p-3" key={scenario.id}>{scenario.profile.name}<span className="mt-1 block text-xs font-normal text-slate-500">Nota geral: {scenario.candidate.evaluation.score}/100</span></th>)}</tr></thead><tbody>
      <tr className="border-b"><td className="p-3 font-semibold">Volume planejado</td>{scenarios.map((scenario) => { const value = press(scenario); return <td className="p-3" key={scenario.id}>{value ? <><strong>{number(value.plannedKg)} kg</strong><span className="block text-xs text-slate-600">{number(value.plannedTonnes)} t</span></> : "Sem carga"}</td>; })}</tr>
      <tr className="border-b"><td className="p-3 font-semibold">Previsão de término</td>{scenarios.map((scenario) => { const value = press(scenario); return <td className="p-3" key={scenario.id}>{value ? <><strong>{date(value.endsAt)}</strong><span className="block text-xs text-slate-600">inclui preparo e disponibilidade</span></> : "—"}</td>; })}</tr>
      <tr className="border-b"><td className="p-3 font-semibold">Previsão de produtividade (média da Simplificada)</td>{scenarios.map((scenario) => { const value = press(scenario); return <td className="p-3" key={scenario.id}>{value ? <><strong>{number(value.plannedVolumeKgH)} kg/h</strong><span className="block text-xs text-slate-600">média de {value.productivitySampleCount} ferramenta(s)</span></> : "—"}</td>; })}</tr>
      <tr className="border-b"><td className="p-3 font-semibold">Turnos úteis necessários</td>{scenarios.map((scenario) => { const value = press(scenario); return <td className="p-3" key={scenario.id}>{value ? <><strong>{value.turnsRequired} turno(s)</strong><span className="block text-xs text-slate-600">janelas de 9h40 de extrusão</span></> : "—"}</td>; })}</tr>
      <tr className="border-b"><td className="p-3 font-semibold">Tempo útil de extrusão</td>{scenarios.map((scenario) => { const value = press(scenario); return <td className="p-3" key={scenario.id}>{value ? <><strong>{duration(value.workMinutes)}</strong><span className="block text-xs text-slate-600">volume ÷ produtividade prevista</span></> : "—"}</td>; })}</tr>
      <tr className="border-b"><td className="p-3 font-semibold">Tempo total no relógio</td>{scenarios.map((scenario) => { const value = press(scenario); return <td className="p-3" key={scenario.id}>{value ? <><strong>{duration(value.scheduledMinutes)}</strong><span className="block text-xs text-slate-600">inclui extrusão, preparo e tempo aguardando</span></> : "—"}</td>; })}</tr>
      <tr className="border-b"><td className="p-3 font-semibold">Trocas de ferramenta</td>{scenarios.map((scenario) => { const value = press(scenario); return <td className="p-3" key={scenario.id}>{value ? <><strong>{value.toolChanges} troca(s) · {duration(value.toolChangeMinutes)}</strong><span className="block text-xs text-slate-600">tempo morto estimado entre ferramentas</span></> : "—"}</td>; })}</tr>
      <tr className="border-b"><td className="p-3 font-semibold">Tempo aguardando</td>{scenarios.map((scenario) => { const value = press(scenario); return <td className="p-3" key={scenario.id}>{value ? <><strong>{duration(value.waitingMinutes)}</strong><span className="block text-xs text-slate-600">forno, carcaça, BO ou prensa indisponível</span></> : "—"}</td>; })}</tr>
      <tr className="border-b"><td className="p-3 font-semibold">Referência do turno</td>{scenarios.map((scenario) => <td className="p-3" key={scenario.id}>1.300 kg/h<span className="block text-xs text-slate-600">avaliada sobre 06:30–16:10</span></td>)}</tr>
      <tr><td className="p-3 font-semibold">Sequência desta prensa</td>{scenarios.map((scenario) => { const sequence = scenario.sequence[machineCode] ?? []; return <td className="p-3" key={scenario.id}>{sequence.length ? <><strong>{sequence.length} ordem(ns)</strong><span className="block text-xs text-slate-600">aplicada junto da outra prensa</span></> : "Sem sequência"}</td>; })}</tr>
      <tr><td className="p-3 font-semibold">Validação</td>{scenarios.map((scenario) => <td className="p-3" key={scenario.id}>{scenario.excludedOrders.some((item) => item.machineCode === machineCode) ? <span className="text-xs text-amber-800">Conferir itens bloqueados</span> : <span className="text-xs text-emerald-700">Sequência pronta para validação conjunta</span>}</td>)}</tr>
    </tbody></table></div>
  </section>;
}

function ScenarioComparisonPanel({ comparison, stale, onApply }: { comparison: ScenarioComparison; stale: boolean; onApply: (candidate: DecisionCandidate) => void }) {
  const visibleScenarios = distinctScenarios(comparison.scenarios);
  const hiddenCount = comparison.scenarios.length - visibleScenarios.length;
  const recommended = visibleScenarios.find((scenario) => scenario.id === comparison.recommendedScenarioId) ?? visibleScenarios[0];
  const machineCodes = [...new Set(visibleScenarios.flatMap((scenario) => scenario.kpis.pressPlans.map((press) => press.machineCode)))].sort();
  return <section className="space-y-3 rounded-xl border border-violet-200 bg-violet-50 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold text-violet-950">Cenários calculados a partir da Simplificada</h3><p className="text-sm text-violet-900">Cada perfil usa o mesmo snapshot de ordens, recursos, turnos e restrições.</p>{hiddenCount > 0 && <p className="mt-1 text-xs font-semibold text-violet-800">{hiddenCount} cenário(s) foram ocultados porque geraram o mesmo resultado operacional. Só mostramos opções que mudam a sequência, o volume, o tempo ou o material.</p>}</div>{recommended && <span className="rounded-full bg-violet-700 px-3 py-1 text-xs font-bold text-white">Recomendado: {recommended.profile.name}</span>}</div>
    <div className="space-y-4">{machineCodes.map((machineCode) => <ScenarioPressComparison key={machineCode} machineCode={machineCode} scenarios={visibleScenarios} />)}</div>
    <div className="rounded-lg border border-violet-200 bg-white p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="text-sm font-bold text-violet-950">Aplicar cenário completo</h4><p className="text-xs text-slate-600">A sequência das Prensas 1.8 e 1.9 é aplicada em conjunto para preservar forno, carcaças e demais recursos compartilhados.</p></div><div className="flex flex-wrap gap-2">{visibleScenarios.filter((scenario) => scenario.id !== "original").map((scenario) => <Button key={scenario.id} size="sm" variant={scenario.id === comparison.recommendedScenarioId ? "default" : "outline"} disabled={stale} onClick={() => onApply(scenario.candidate)}>Usar {scenario.profile.name}</Button>)}</div></div></div>
    {comparison.tradeoffs.map((tradeoff) => <p key={tradeoff} className="text-xs text-violet-950">{tradeoff}</p>)}
    <details className="rounded-lg border border-violet-200 bg-white p-3"><summary className="cursor-pointer text-sm font-semibold text-violet-950">Por que as posições mudaram?</summary><div className="mt-3 space-y-2">{visibleScenarios.filter((scenario) => scenario.changes.length).map((scenario) => <div key={scenario.id} className="text-xs text-slate-700"><strong>{scenario.profile.name}:</strong>{scenario.changes.slice(0, 4).map((change) => <p key={change.orderId}>• {change.toolCode}, posição {change.from} → {change.to}. {change.reason} {change.simulatedImpact}</p>)}</div>)}{!visibleScenarios.some((scenario) => scenario.changes.length) && <p className="text-xs text-slate-600">Nenhum perfil encontrou uma mudança de posição útil com os dados atuais.</p>}</div></details>
  </section>;
}

function ScenarioGenerationLoader({ progress, elapsedSeconds }: { progress: ScenarioProgress | null; elapsedSeconds: number }) {
  const steps = ["Validando restrições", "Simulando sequências", "Comparando cenários"] as const;
  const activeStage = progress?.stage === "comparison" ? 2 : progress?.stage === "simulation" ? 1 : 0;
  const completedProfiles = progress?.completedProfiles ?? 0;
  const totalProfiles = progress?.totalProfiles ?? 4;
  const remainingSeconds = completedProfiles > 0 && completedProfiles < totalProfiles
    ? Math.max(1, Math.ceil((elapsedSeconds / completedProfiles) * (totalProfiles - completedProfiles)))
    : null;
  const stageText = progress?.stage === "comparison" ? "Consolidando a recomendação" : progress?.profileName ? `Calculando ${progress.profileName}` : "Preparando a análise";
  return <div role="status" aria-live="polite" aria-busy="true" className="relative overflow-hidden rounded-xl border border-violet-200 bg-gradient-to-r from-violet-50 via-white to-orange-50 p-4">
    <div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700"><Loader2 className="size-5 animate-spin" /></span><div><p className="flex items-center gap-2 font-bold text-violet-950"><Sparkles className="size-4 text-violet-600" />Gerando cenário...</p><p className="text-sm text-slate-600">{stageText}. O motor está calculando uma alternativa segura com os dados atuais.</p></div></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-3">{steps.map((step, index) => <div key={step} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${index < activeStage ? "border-emerald-200 bg-emerald-50 text-emerald-800" : index === activeStage ? "border-violet-200 bg-white text-violet-800 animate-pulse" : "border-violet-100 bg-white/70 text-slate-500"}`} style={{ animationDelay: `${index * 180}ms` }}><span className={`relative flex size-2 shrink-0 ${index === activeStage ? "" : "opacity-70"}`}><span className={`absolute inline-flex size-full rounded-full ${index === activeStage ? "animate-ping bg-violet-400" : index < activeStage ? "bg-emerald-500" : "bg-slate-300"} opacity-60`} /><span className={`relative inline-flex size-2 rounded-full ${index < activeStage ? "bg-emerald-600" : index === activeStage ? "bg-violet-600" : "bg-slate-400"}`} /></span>{step}{index < activeStage && <span className="ml-auto text-[10px] uppercase tracking-wide">ok</span>}</div>)}</div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600"><span>Etapas concluídas: <strong>{Math.min(completedProfiles, totalProfiles)}/{totalProfiles}</strong>{progress?.testedNodes ? ` · ${progress.testedNodes.toLocaleString("pt-BR")} avaliações` : ""}</span><span>Tempo decorrido: <strong>{secondsLabel(elapsedSeconds)}</strong>{remainingSeconds ? ` · restam aprox. ${secondsLabel(remainingSeconds)}` : " · estimando tempo restante"}</span></div>
    <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-violet-100"><div className="h-full rounded-full bg-gradient-to-r from-violet-500 via-fuchsia-500 to-orange-400 transition-[width] duration-700" style={{ width: `${Math.max(8, Math.round((completedProfiles / totalProfiles) * 100))}%` }} /><span className="scenario-loader-shimmer absolute inset-y-0 left-0 w-1/4 rounded-full bg-white/65" /></div>
  </div>;
}

function ScenarioGenerationSummary({ comparison, elapsedSeconds, testedNodes }: { comparison: ScenarioComparison; elapsedSeconds: number; testedNodes: number }) {
  const recommended = comparison.scenarios.find((scenario) => scenario.id === comparison.recommendedScenarioId);
  if (!recommended) return null;
  const goals = recommended.candidate.evaluation.shiftGoals;
  const volumeGap = recommended.kpis.projectedKg - goals.goals.targetKg;
  const pressPlans = recommended.kpis.pressPlans;
  const forecastTargetKgH = goals.goals.targetProductivityKgH;
  const pressesMeetingForecast = pressPlans.filter((press) => press.plannedVolumeKgH >= forecastTargetKgH).length;
  const forecastsMeetGoal = pressPlans.length > 0 && pressesMeetingForecast === pressPlans.length;
  const signed = (value: number, unit: string) => `${value >= 0 ? "+" : ""}${number(value)} ${unit}`;
  return <section role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
    <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" /><div><h3 className="font-bold text-emerald-950">Cenário calculado</h3><p className="text-sm text-emerald-900">Foram comparados {comparison.scenarios.length} cenários em {secondsLabel(elapsedSeconds)}, com {testedNodes.toLocaleString("pt-BR")} avaliações. A recomendação atual é <strong>{recommended.profile.name}</strong>.</p></div></div>
    <div className="mt-3 grid gap-3 sm:grid-cols-4"><div className="rounded-lg border border-emerald-100 bg-white/80 p-3"><span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Produção projetada</span><p className="mt-1 font-black text-slate-950">{number(recommended.kpis.projectedKg)} kg · {number(recommended.kpis.projectedTonnes)} t</p><p className="text-xs text-slate-600">{signed(volumeGap, "kg")} contra a meta</p></div><div className="rounded-lg border border-emerald-100 bg-white/80 p-3"><span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Previsão por prensa</span><p className="mt-1 font-black text-slate-950">{pressPlans.map((press) => `${pressName(press.machineCode)} ${number(press.plannedVolumeKgH)}`).join(" · ")} kg/h</p><p className="text-xs text-slate-600">média das ferramentas da Simplificada</p></div><div className="rounded-lg border border-emerald-100 bg-white/80 p-3"><span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Tempo útil de extrusão</span><p className="mt-1 font-black text-slate-950">{pressPlans.map((press) => `${pressName(press.machineCode)} ${duration(press.workMinutes)}`).join(" · ")}</p><p className="text-xs text-slate-600">não soma horas entre prensas</p></div><div className="rounded-lg border border-emerald-100 bg-white/80 p-3"><span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Resultado da previsão</span><p className="mt-1 font-black text-slate-950">{forecastsMeetGoal ? "Na meta" : "Conferir previsão"}</p><p className="text-xs text-slate-600">{pressesMeetingForecast}/{pressPlans.length} prensa(s) ≥ {number(forecastTargetKgH)} kg/h</p></div></div>
    <PlannedVolumeByPress presses={pressPlans} />
    <p className="mt-3 text-xs text-emerald-950">{recommended.limitingFactors[0] ? `Principal atenção: ${recommended.limitingFactors[0]}` : "Nenhuma limitação adicional foi encontrada nesta comparação."} A programação oficial não foi alterada; use “Usar na simulação” para conferir antes de aplicar.</p>
  </section>;
}

export function DecisionWorkspace({ context, profile, canEdit, canAdjust, onProfile, onApply }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>("Resumo");
  const [draft, setDraft] = useState(profile);
  const [advanced, setAdvanced] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState("");
  const [moveTo, setMoveTo] = useState(1);
  const [moveCandidate, setMoveCandidate] = useState<DecisionCandidate | null>(null);
  const [previewKey, setPreviewKey] = useState("");
  const [candidates, setCandidates] = useState<DecisionCandidate[]>([]);
  const [comparison, setComparison] = useState<ScenarioComparison | null>(null);
  const [jobKey, setJobKey] = useState("");
  const [candidatesKey, setCandidatesKey] = useState("");
  const [moveKey, setMoveKey] = useState("");
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [versions, setVersions] = useState<SavedVersion[]>([]);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [baseVersion, setBaseVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const [generationProgress, setGenerationProgress] = useState<ScenarioProgress | null>(null);
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const [generationSummary, setGenerationSummary] = useState<{ elapsedSeconds: number; testedNodes: number } | null>(null);
  const worker = useRef<Worker | null>(null);
  const generationStartedAt = useRef<number | null>(null);
  useEffect(() => {
    const open = () => setExpanded(true);
    if (window.location.hash === "#central-de-decisoes") open();
    window.addEventListener("open-decision-workspace", open);
    window.addEventListener("hashchange", open);
    return () => {
      window.removeEventListener("open-decision-workspace", open);
      window.removeEventListener("hashchange", open);
    };
  }, []);
  const contextKey = JSON.stringify(context);
  const draftKey = JSON.stringify(draft);
  const currentKey = contextKey + draftKey;
  const busy = jobKey === currentKey;
  useEffect(() => {
    if (!busy || generationStartedAt.current === null) return;
    const timer = window.setInterval(() => {
      setGenerationElapsed(Math.floor((Date.now() - (generationStartedAt.current ?? Date.now())) / 1000));
    }, 250);
    return () => window.clearInterval(timer);
  }, [busy]);
  const evaluation = useMemo(() => {
    const simulation = runCandidate(context, profile).simulation;
    return { simulation, decision: evaluateDecision(simulation, profile, context.stock, context.stockKnown) };
  }, [context, profile]);
  const graph = useMemo(() => graphForProfile(draft), [draft]);
  const selectedTrace = evaluation.decision.traces.find(trace => trace.orderId === selectedOrder) ?? evaluation.decision.traces[0];
  const times = useMemo(() => operationalTimes(evaluation.simulation, context.start, context.shifts, context.unavailable, context.overtimePeriods), [context, evaluation.simulation]);
  const preview = previewKey === currentKey ? evaluateDecision(evaluation.simulation, draft, context.stock, context.stockKnown) : null;
  const totalLate = evaluation.decision.traces.filter(trace => trace.lateMinutes > 0).length;
  const constraints = graph.filter(node => node.protected);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/decision-profiles", { signal: controller.signal })
      .then(async response => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Não foi possível carregar os perfis.");
        setVersions(payload);
      }).catch(error => { if (!controller.signal.aborted) setMessage(String(error.message)); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    return () => { worker.current?.terminate(); worker.current = null; };
  }, [contextKey, draftKey]);
  const staleResults = candidatesKey !== currentKey;
  function testImpact() {
    const parsed = profileSchema.safeParse(draft);
    if (!parsed.success) { setMessage(parsed.error.issues[0].message); return; }
    setPreviewKey(currentKey);
    setMessage("Prévia recalculada. Alterar pesos muda a avaliação; use Gerar alternativas para medir mudanças na sequência e nos horários.");
  }
  function generate() {
    const parsed = profileSchema.safeParse(draft);
    if (!parsed.success) { setMessage(parsed.error.issues[0].message); return; }
    worker.current?.terminate();
    const job = new Worker(new URL("../modules/planning/decision-system/worker.ts", import.meta.url));
    worker.current = job;
    generationStartedAt.current = Date.now();
    setGenerationElapsed(0);
    setGenerationProgress({ stage: "validation", completedProfiles: 0, totalProfiles: 4, testedNodes: 0 });
    setGenerationSummary(null);
    setJobKey(currentKey); setMessage(""); setCandidates([]); setComparison(null); setTab("Alternativas");
    job.onmessage = event => {
      if (worker.current !== job) return;
      if (event.data.progress) { setGenerationProgress(event.data.progress); return; }
      setJobKey("");
      const elapsedSeconds = generationStartedAt.current === null ? generationElapsed : Math.max(0, Math.round((Date.now() - generationStartedAt.current) / 1000));
      generationStartedAt.current = null;
      if (event.data.error) setMessage(event.data.error);
      else {
        const result = event.data.comparison as ScenarioComparison;
        const testedNodes = result?.scenarios?.reduce((total, scenario) => total + scenario.candidate.searched, 0) ?? 0;
        setCandidates(event.data.candidates); setComparison(result ?? null); setCandidatesKey(currentKey); setPreviewKey(currentKey); setGenerationSummary({ elapsedSeconds, testedNodes });
      }
      job.terminate(); worker.current = null;
    };
    job.onerror = () => {
      if (worker.current !== job) return;
      setJobKey(""); setMessage("Não foi possível concluir a busca. A sequência atual foi mantida.");
      generationStartedAt.current = null;
      job.terminate(); worker.current = null;
    };
    job.postMessage({ context, profile: parsed.data });
  }
  function setRule(id: string, patch: Partial<CustomCriterion>) {
    setDraft({ ...draft, customCriteria: draft.customCriteria.map(rule => rule.id === id ? { ...rule, ...patch } : rule) });
  }
  async function save(asNew = false) {
    if (!preview) { setMessage("Teste o impacto com os dados atuais antes de salvar."); return; }
    if (reason.trim().length < 5) { setMessage("Explique o motivo da alteração antes de salvar."); return; }
    setSaving(true);
    try {
      const response = await fetch("/api/decision-profiles", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: asNew ? null : savedId, baseVersion, profile: draft, reason,
          impact: { before: evaluation.decision.metrics, after: preview.metrics, oldScore: evaluation.decision.score, newScore: preview.score,
            at: context.start.toISOString(), orderIds: context.orders.map(order => order.id) } }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error);
      setSavedId(payload.id); setBaseVersion(payload.version);
      const list = await fetch("/api/decision-profiles");
      if (list.ok) setVersions(await list.json());
      setMessage(`Perfil salvo como versão ${payload.version}. Use Aplicar perfil na simulação para avaliá-lo na carga atual.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Não foi possível salvar."); }
    finally { setSaving(false); }
  }
  function simulateMove() {
    if (!selectedTrace) return;
    const target = context.orders.filter(order => order.machineCode === selectedTrace.machineCode).sort((a, b) => a.sequence - b.sequence);
    const index = target.findIndex(order => order.id === selectedTrace.orderId);
    if (index < 0 || !Number.isInteger(moveTo) || moveTo < 1 || moveTo > target.length) { setMessage("Escolha uma posição válida."); return; }
    const lockedCount = target.filter(order => order.status === "in_progress" || order.status === "paused").length;
    if (moveTo <= lockedCount) { setMessage("Mantenha as ordens já iniciadas no começo da sequência."); return; }
    if (target[index]?.status === "in_progress" || target[index]?.status === "paused") { setMessage("Esta ordem já começou; mantenha sua posição."); return; }
    const [item] = target.splice(index, 1);
    target.splice(Math.min(Math.max(moveTo - 1, 0), target.length), 0, item);
    const positions = new Map(target.map((order, index) => [order.id, index + 1]));
    try {
      setMoveCandidate(runCandidate(context, profile, context.orders.map(order => ({ ...order, sequence: positions.get(order.id) ?? order.sequence })), "Mudança de posição"));
      setMoveKey(contextKey + JSON.stringify(profile));
    } catch (error) { setMessage(String(error)); }
  }
  return <section id="central-de-decisoes" className="scroll-mt-5 overflow-hidden rounded-2xl border-2 border-violet-200 bg-white shadow-sm">
    <header className="flex flex-wrap items-center gap-3 p-4">
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-controls="decision-workspace-content" className="flex-1 text-left">
        <span className="text-[10px] font-bold uppercase tracking-wider text-violet-700">Decida qual cenário usar</span>
        <h2 className="text-xl font-black text-slate-950">Central de Decisões</h2>
        <p className="text-sm text-slate-600">{statusLabels[evaluation.decision.status]} · {totalLate} atraso(s) · {evaluation.decision.hardViolations} impedimento(s) · compare alternativas, nota e recursos no tempo.</p>
      </button>
      <LoadHelpGuide />
      <Button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>{expanded ? "Recolher" : "Abrir Central"}</Button>
    </header>
    {expanded && <div id="decision-workspace-content" className="border-t">
      <nav aria-label="Áreas da Central de Decisões" className="flex flex-wrap gap-1 bg-slate-50 p-3">
        {visibleTabs.map(name => <button key={name} onClick={() => setTab(name)} aria-pressed={tab === name} className={`rounded-lg px-3 py-2 text-sm font-semibold ${tab === name ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-white"}`}>{name}</button>)}
      </nav>
      {message && <div role="status" className="m-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950">{message}</div>}
      <div className="p-4">
        {tab === "Resumo" && <div className="space-y-4">
          <p className="text-sm text-slate-600">Esta avaliação usa as regras e os dados da simulação. A nota de preferência ({evaluation.decision.score}/100) compara cenários; a liberação depende dos impedimentos e confirmações.</p>
          <ShiftGoalSummary evaluation={evaluation.decision} simulation={evaluation.simulation} />
          <div className="overflow-auto"><table className="w-full min-w-[980px] text-left text-sm"><caption className="mb-3 text-left font-semibold">Tempos por prensa</caption><thead><tr>{["Prensa", "Produção útil", "Preparação inicial", "Trocas", "Troca de liga", "Tempo aguardando", "Parada programada", "Fora do turno", "Tempo no relógio", "Término"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{times.map(time => <tr key={time.machineCode} className="border-t">{[time.machineCode, duration(time.productive), duration(time.initialPreparation), duration(time.toolChanges), duration(time.alloyChanges), duration(time.thermal + time.resource), duration(time.scheduledStop), duration(time.outsideCalendar), duration(time.calendar), date(time.end)].map((value, index) => <td key={index} className="p-2">{value}</td>)}</tr>)}</tbody></table></div>
          <p className="text-xs text-slate-500">Produção útil conta só a extrusão. Trocas usam o tempo morto configurado (padrão: 1 min por troca); a preparação inicial é aplicada uma vez antes da primeira ferramenta. Tempo no relógio vai da primeira ferramenta programada até o término. Fora do turno são períodos sem operação e não entram na produção útil.</p>
          {evaluation.decision.missingData.length > 0 && <details className="rounded-lg border border-amber-200 p-3"><summary className="cursor-pointer font-semibold">O que falta confirmar ({evaluation.decision.missingData.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{evaluation.decision.missingData.map(item => <li key={item}>{item}</li>)}</ul></details>}
          {evaluation.decision.impacts.length > 0 ? <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-bold">Recursos prioritários para conferir ({evaluation.decision.impacts.length})</summary><div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{evaluation.decision.impacts.slice(0, 5).map(impact => <article key={impact.resource} className="rounded-lg bg-slate-50 p-3 text-sm"><strong>{impact.resource}</strong><p className="mt-1 text-xs text-slate-600">{impact.orders} ordens · {number(impact.kg)} kg · {impact.tools} ferramenta(s)</p><p className="mt-2 text-xs text-slate-700">{impact.steps[0]}</p></article>)}</div>{evaluation.decision.impacts.length > 5 ? <p className="mt-2 text-xs text-slate-500">Mostrando os 5 recursos com maior impacto.</p> : null}</details> : null}
          {evaluation.decision.tradeoffs.length > 0 ? <details className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2"><summary className="cursor-pointer text-sm font-bold text-amber-950">Pontos de atenção ({evaluation.decision.tradeoffs.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-950">{evaluation.decision.tradeoffs.map(item => <li key={item}>{item}</li>)}</ul></details> : null}
          <Button onClick={generate} disabled={busy}>Gerar alternativas calculadas</Button>
        </div>}
        {tab === "Critérios" && <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">Como escolher e guardar um perfil <FieldHelp topic="profile" /><span>Regras avançadas</span><FieldHelp topic="custom" /></div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">Perfil inicial<select className={fieldClass} value="" onChange={event => {
              const preset = decisionPresets.find(item => item.name === event.target.value);
              if (preset) { setDraft(structuredClone(preset)); setSavedId(null); setBaseVersion(0); }
            }}><option value="">Selecionar um perfil...</option>{decisionPresets.map(preset => <option key={preset.name}>{preset.name}</option>)}</select></label>
            <label className="text-sm">Nome do perfil<input className={fieldClass} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={advanced} onChange={event => setAdvanced(event.target.checked)} />Modo avançado</label>
          </div>
          <p className="text-sm text-slate-600">Quanto maior o peso, mais importância o objetivo tem na comparação. Use de 0 a 100; os pesos não precisam somar 100. Zero retira a penalização desse objetivo. Os impedimentos físicos continuam valendo.</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{metricKeys.map(key => <div key={key} className="rounded-lg border p-3 text-sm"><HelpLabel label={metricLabels[key]} topic={key} /><input aria-label={metricLabels[key]} type="number" min="0" max="100" className={fieldClass} value={draft.weights[key]} onChange={event => setDraft({ ...draft, weights: { ...draft.weights, [key]: Number(event.target.value) } })} /></div>)}</div>
          <div className="grid gap-3 md:grid-cols-3">{([
            ["lowVolumeKg", "Volume baixo (kg)"], ["shortRunMinutes", "Corrida curta (min)"],
            ["maxConsecutiveShortRuns", "Máximo de corridas curtas seguidas"], ["highHoles", "Furos considerados altos"],
            ["maxConsecutiveHighHoles", "Máximo de muitos furos seguidos"], ["handoverMaxHoles", "Máximo de furos no revezamento (11:00–13:30)"],
          ] as const).map(([key, label]) => <div key={key} className="text-sm"><HelpLabel label={label} topic={key === "highHoles" ? "highHolesThreshold" : key} /><input aria-label={label} className={fieldClass} type="number" min={key === "handoverMaxHoles" ? "2" : "1"} max={key === "handoverMaxHoles" ? "4" : undefined} value={draft.thresholds[key]} onChange={event => setDraft({ ...draft, thresholds: { ...draft.thresholds, [key]: Number(event.target.value) } })} /></div>)}</div>
          <details className="rounded-lg border p-3"><summary className="cursor-pointer font-semibold">Restrições obrigatórias protegidas ({constraints.length})</summary>{constraints.map(rule => <p key={rule.id} className="mt-2 text-sm"><strong>{rule.name}:</strong> {rule.description}</p>)}</details>
          {advanced && <div className="space-y-3">
            <div className="flex items-center justify-between"><h3 className="font-bold">Editor de critérios: todas as condições precisam ser atendidas</h3><Button variant="outline" onClick={() => setDraft({ ...draft, customCriteria: [...draft.customCriteria, initialRule()] })} disabled={draft.customCriteria.length >= 40}>Novo critério</Button></div>
            {draft.customCriteria.map(rule => <details key={rule.id} className="rounded-xl border p-3" open>
              <summary className="cursor-pointer font-semibold">{rule.name} · {kindLabels[rule.kind]}</summary>
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                <label className="text-sm">Nome<input className={fieldClass} value={rule.name} onChange={event => setRule(rule.id, { name: event.target.value })} /></label>
                <div className="text-sm"><HelpLabel label="Tipo" topic="custom" /><select aria-label="Tipo" className={fieldClass} value={rule.kind} onChange={event => setRule(rule.id, { kind: event.target.value as CustomCriterion["kind"] })}>{Object.entries(kindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
                <label className="text-sm">Módulo<select className={fieldClass} value={rule.module} onChange={event => setRule(rule.id, { module: event.target.value as CustomCriterion["module"] })}>{Object.entries({sequencing:"Sequência",delivery:"Prazo",thermal:"Aquecimento",material:"Material",resources:"Recursos",productivity:"Produtividade"}).map(([module,label]) => <option key={module} value={module}>{label}</option>)}</select></label>
                <label className="text-sm">Descrição<input className={fieldClass} value={rule.description} onChange={event => setRule(rule.id, { description: event.target.value })} /></label>
                <div className="text-sm"><HelpLabel label="Ordens seguidas" topic="custom" /><input aria-label="Ordens seguidas" className={fieldClass} type="number" min="1" max="20" value={rule.consecutive} onChange={event => setRule(rule.id, { consecutive: Number(event.target.value) })} /></div>
                <div className="text-sm"><HelpLabel label="Penalidade" topic="penalty" /><input aria-label="Penalidade" className={fieldClass} type="number" min="0" max="100" value={rule.penalty} onChange={event => setRule(rule.id, { penalty: Number(event.target.value) })} /></div>
                <div className="text-sm"><HelpLabel label="Peso" topic="penalty" /><input aria-label="Peso" className={fieldClass} type="number" min="0" max="100" value={rule.weight} onChange={event => setRule(rule.id, { weight: Number(event.target.value) })} /></div>
                <div className="text-sm"><HelpLabel label="Prioridade (1 = mais urgente)" topic="priority" /><input aria-label="Prioridade (1 = mais urgente)" className={fieldClass} type="number" min="1" max="5" value={rule.priority} onChange={event => setRule(rule.id, { priority: Number(event.target.value) })} /></div>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rule.enabled} onChange={event => setRule(rule.id, { enabled: event.target.checked })} />Ativo</label>
              </div>
              {rule.conditions.map((condition, index) => <div key={index} className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 md:grid-cols-3">
                <select aria-label="Dado usado na condição" className={fieldClass} value={condition.fact} onChange={event => setRule(rule.id, { conditions: rule.conditions.map((c, i) => i === index ? { ...c, fact: event.target.value as typeof c.fact } : c) })}>{factKeys.map(key => <option key={key} value={key}>{factLabels[key]}</option>)}</select>
                <select aria-label="Comparação" className={fieldClass} value={condition.operator} onChange={event => setRule(rule.id, { conditions: rule.conditions.map((c, i) => i === index ? { ...c, operator: event.target.value as typeof c.operator } : c) })}>{Object.entries({ lt: "menor que", lte: "menor ou igual", gt: "maior que", gte: "maior ou igual", eq: "igual a" }).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
                <input aria-label="Valor da condição" type="number" className={fieldClass} value={condition.value} onChange={event => setRule(rule.id, { conditions: rule.conditions.map((c, i) => i === index ? { ...c, value: Number(event.target.value) } : c) })} />
              </div>)}
              <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={rule.conditions.length >= 6} onClick={() => setRule(rule.id, { conditions: [...rule.conditions, { fact: "holes", operator: "gte", value: 4 }] })}>Adicionar condição</Button><Button size="sm" variant="outline" onClick={() => setDraft({ ...draft, customCriteria: [...draft.customCriteria, { ...structuredClone(rule), id: `rule-${crypto.randomUUID()}`, name: `${rule.name} — cópia` }] })}>Duplicar</Button></div>
            </details>)}
          </div>}
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
            <Button variant="outline" onClick={testImpact}>Testar impacto dos critérios</Button><FieldHelp topic="save" />
            {preview && <p className="my-3 text-sm">Mesma sequência: nota {evaluation.decision.score} → {preview.score}; impedimentos {evaluation.decision.hardViolations} → {preview.hardViolations}. Horários só mudam se a sequência ou os parâmetros físicos mudarem.</p>}
            <div className="mt-3 flex flex-wrap gap-2"><Button disabled={!preview} onClick={() => { onProfile(structuredClone(draft)); setMessage("Perfil aplicado somente à simulação. A produção não foi alterada."); }}>Aplicar perfil na simulação</Button><Button variant="outline" disabled={busy} onClick={generate}>Gerar alternativas</Button><Button variant="ghost" onClick={() => { setDraft(structuredClone(profile)); setMessage("Alterações descartadas."); }}>Descartar</Button></div>
            {canEdit && <div className="mt-4 space-y-2"><label className="text-sm">Motivo da alteração<input className={fieldClass} value={reason} onChange={event => setReason(event.target.value)} placeholder="Explique por que o critério precisa mudar" /></label><div className="flex gap-2"><Button disabled={!preview || saving} onClick={() => void save()}>Salvar versão</Button><Button variant="outline" disabled={!preview || saving} onClick={() => void save(true)}>Salvar como novo perfil</Button></div></div>}
          </div>
        </div>}
        {tab === "Mapa de decisão" && <PlanningOverview key={contextKey + JSON.stringify(profile)} context={context} profile={profile} canAdjust={canAdjust} onApply={onApply}
          current={{id:"Atual",name:"Atual",simulation:evaluation.simulation,evaluation:evaluation.decision,orderIds:Object.fromEntries(evaluation.simulation.machines.map(m=>[m.machineCode,m.items.map(i=>i.id)])),searched:1,durationMs:0}} />}
        {tab === "Sala de controle" && <ProductionControlRoom key={contextKey + JSON.stringify(profile)} context={context} profile={profile} canAdjust={canAdjust} onApply={onApply}
          current={{id:"Atual",name:"Atual",simulation:evaluation.simulation,evaluation:evaluation.decision,orderIds:Object.fromEntries(evaluation.simulation.machines.map(m=>[m.machineCode,m.items.map(i=>i.id)])),searched:1,durationMs:0}} />}
        {tab === "Alternativas" && <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3"><Button onClick={generate} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />}{busy ? "Calculando cenário..." : "Gerar alternativas calculadas"}</Button>{busy && <Button variant="outline" onClick={() => { worker.current?.terminate(); worker.current = null; generationStartedAt.current = null; setGenerationProgress(null); setGenerationElapsed(0); setGenerationSummary(null); setJobKey(""); }}>Cancelar busca</Button>}</div>
          {busy && <ScenarioGenerationLoader progress={generationProgress} elapsedSeconds={generationElapsed} />}
          {!busy && generationSummary && comparison && !staleResults && <ScenarioGenerationSummary comparison={comparison} elapsedSeconds={generationSummary.elapsedSeconds} testedNodes={generationSummary.testedNodes} />}
          <p className="text-sm text-slate-600">A busca usa orçamento determinístico de nós e preserva as ordens na própria prensa. Cada perfil avalia alternativas no simulador físico comum; não há IA generativa decidindo a sequência.</p>
          {staleResults && candidates.length > 0 && <p className="text-amber-800">Os dados ou critérios mudaram. Gere as alternativas novamente.</p>}
          {comparison && <ScenarioComparisonPanel comparison={comparison} stale={staleResults} onApply={onApply} />}
          <div className="overflow-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead><tr>{["Estratégia", "Condição", "Previsão por prensa", "Atrasados", "Término", "Preparo físico", "Espera do forno", "Sobra", "Nota", "Ação"].map(label => <th className="p-2" key={label}>{label}</th>)}</tr></thead><tbody>{candidates.map(candidate => { const candidatePressPlans = pressPlansForSimulation(candidate.simulation); return <tr key={candidate.id} className="border-t"><td className="p-2 font-semibold">{candidate.name}<span className="block text-xs font-normal">{candidate.searched} tentativa(s)</span></td><td className="p-2">{statusLabels[candidate.evaluation.status]}</td><td className="p-2">{candidatePressPlans.map((press) => `${pressName(press.machineCode)} ${number(press.plannedVolumeKgH)}`).join(" · ")}<span className="block text-xs">kg/h · média da Simplificada</span></td><td className="p-2">{candidate.evaluation.traces.filter(trace => trace.lateMinutes > 0).length}</td><td className="p-2">{date(new Date(Math.max(...candidate.simulation.machines.map(machine => machine.endsAt?.getTime() ?? 0))))}</td><td className="p-2">{duration(candidate.evaluation.metrics.setupMinutes)}</td><td className="p-2">{duration(candidate.evaluation.metrics.thermalMinutes)}</td><td className="p-2">{number(candidate.evaluation.metrics.remainderKg)} kg</td><td className="p-2">{candidate.evaluation.score}</td><td className="p-2"><Button size="sm" variant="outline" disabled={staleResults || candidate.id === "Atual"} onClick={() => onApply(candidate)}>Usar na simulação</Button></td></tr>; })}</tbody></table></div>
          <p className="text-xs text-slate-500">Usar na simulação abre a sequência no modo manual. Não inicia nem aprova a produção.</p>
        </div>}
        {tab === "Por que esta posição?" && <div className="space-y-4">
          <label className="text-sm">Ferramenta / ordem<select className={fieldClass} value={selectedTrace?.orderId ?? ""} onChange={event => { setSelectedOrder(event.target.value); setMoveCandidate(null); }}>{evaluation.decision.traces.map(trace => <option key={trace.orderId} value={trace.orderId}>Prensa {trace.machineCode} · {trace.position} · {trace.toolCode}</option>)}</select></label>
          {selectedTrace && <><h3 className="font-bold">{selectedTrace.toolCode} · posição {selectedTrace.position}</h3><p className="text-sm">Prazo: {date(selectedTrace.dueAt)} · {selectedTrace.slackMinutes === null ? "Prazo não confirmado" : selectedTrace.lateMinutes > 0 ? `Atraso: ${duration(selectedTrace.lateMinutes)}` : `Folga: ${duration(selectedTrace.slackMinutes)}`}</p><ol className="list-decimal space-y-2 pl-5 text-sm">{selectedTrace.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ol>
          {selectedTrace.ruleHits.map(hit => <p key={hit.id} className="rounded-lg bg-amber-50 p-3 text-sm">{hit.name} · {kindLabels[hit.kind as keyof typeof kindLabels]} · penalidade ponderada {number(hit.penalty)}</p>)}
          {selectedTrace.missingData.map(item => <p key={item} className="text-sm text-amber-800">{item}</p>)}
          <div className="flex flex-wrap items-end gap-3"><label className="text-sm">Testar na posição<input className={fieldClass} type="number" min="1" max={evaluation.decision.traces.filter(trace => trace.machineCode === selectedTrace.machineCode).length} value={moveTo} onChange={event => setMoveTo(Number(event.target.value))} /></label><Button variant="outline" onClick={simulateMove}>Simular mudança</Button></div>
          {moveCandidate && moveKey === contextKey + JSON.stringify(profile) && <div className="rounded-lg border p-3 text-sm">Atraso total: {duration(evaluation.decision.metrics.lateMinutes)} → {duration(moveCandidate.evaluation.metrics.lateMinutes)} · Espera térmica: {duration(evaluation.decision.metrics.thermalMinutes)} → {duration(moveCandidate.evaluation.metrics.thermalMinutes)} · Impedimentos: {evaluation.decision.hardViolations} → {moveCandidate.evaluation.hardViolations}<div className="mt-3"><Button variant="outline" onClick={() => onApply(moveCandidate)}>Usar esta sequência na simulação</Button></div></div>}</>}
        </div>}
        {tab === "Recursos no tempo" && <div className="space-y-4">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-950"><strong>O que esta tela responde:</strong> entrada e retirada prevista do forno, início do setup, produção restante e liberação de ferramenta, carcaça e BO. Ferramentas sem ciclo registrado entram no forno por previsão <strong>no momento necessário</strong>; ciclos em andamento conservam o horário informado.</div>
          <div className="overflow-auto"><table className="w-full min-w-[1250px] text-left text-sm"><thead><tr>{["Prensa", "Ferramenta", "Situação térmica", "Forno: entrada → pronta", "Preparação", "Produção restante", "Fim / liberação", "Carcaça · BO", "Prazo"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>{evaluation.simulation.machines.flatMap(machine => machine.items).sort((a,b) => a.startAt.getTime()-b.startAt.getTime()).map(item => {
            const thermalSource = item.toolHeatingState === "released" ? "Liberada antes da simulação" : item.toolHeatingState === "heating" ? "Ciclo informado em aquecimento" : "Ciclo simulado";
            const heatingWindow = item.toolHeatingState === "released" ? "Não necessita forno" : `${date(item.toolHeatingStartAt)} → ${date(item.calculatedToolReadyAt)}`;
            const heatingMinutes = Math.max(0, (item.calculatedToolReadyAt.getTime() - (item.toolHeatingStartAt?.getTime() ?? item.calculatedToolReadyAt.getTime())) / 60_000);
            return <tr key={item.id} className="border-t align-top"><td className="p-2">{item.machineCode}</td><td className="p-2 font-semibold">{item.toolCode}</td><td className="p-2 text-xs">{thermalSource}{item.ovenSlotNumber ? <span className="block text-slate-500">Vaga simulada {item.ovenSlotNumber}</span> : null}</td><td className="p-2 text-xs">{heatingWindow}{item.toolHeatingState !== "released" ? <span className="block text-slate-500">{duration(heatingMinutes)}</span> : null}</td><td className="p-2 text-xs">{date(item.startAt)} → {date(item.extrusionStartAt)}<span className="block text-slate-500">{duration(item.preparationMinutes)}</span></td><td className="p-2 text-xs">{duration(item.theoreticalMinutes)}<span className="block text-slate-500">{number(item.remainingKg)} kg a {number(item.productivityKgH)} kg/h</span></td><td className="p-2">{date(item.endAt)}</td><td className="p-2 text-xs">{item.carcassCode ?? "Confirmar carcaça"}<span className="block">{item.boCode ?? "Confirmar BO"}</span></td><td className="p-2">{date(dueAt(item.dueDate))}</td></tr>;
          })}</tbody></table></div>
          <p className="text-xs text-slate-500">“Pronta” é a retirada prevista do forno. “Preparação” mostra o setup na prensa. “Fim / liberação” é quando ferramenta, carcaça e BO ficam disponíveis para a próxima operação. A tela não grava reservas nem altera a programação oficial.</p>
          {evaluation.simulation.machines.map(machine => <p key={machine.machineCode} className="rounded-lg bg-slate-50 p-3 text-sm">Prensa {machine.machineCode}: pico de {machine.thermalCoverage.peakOvenSlotsUsed}/{machine.thermalCoverage.ovenSlots} vagas · margem de {Math.max(0, machine.thermalCoverage.ovenSlots-machine.thermalCoverage.peakOvenSlotsUsed)} vaga(s) no pico.</p>)}
        </div>}
        {tab === "Histórico" && <div className="space-y-3"><p className="text-sm text-slate-600">Restaurar carrega uma versão para teste. Para torná-la uma nova versão, teste o impacto, informe o motivo e salve em Critérios.</p>{versions.length === 0 && <p>Nenhum perfil salvo ainda.</p>}{versions.map(version => <article key={version.id+version.version} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div><h3 className="font-semibold">{version.name} · versão {version.version}</h3><p className="text-sm">{version.reason}</p><p className="text-xs text-slate-500">{version.actor_name} · {date(new Date(version.created_at))}</p></div><Button variant="outline" onClick={() => { const parsed=profileSchema.safeParse(version.document); if (!parsed.success) { setMessage("Esta versão exige revisão de compatibilidade."); return; } setDraft(parsed.data); setSavedId(version.id); setBaseVersion(version.current_version); setReason(`Restaurar versão ${version.version}: `); setTab("Critérios"); }}>Carregar para teste</Button></article>)}</div>}
      </div>
    </div>}
  </section>;
}
