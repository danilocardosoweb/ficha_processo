"use client";

import { Calculator, CircleGauge, Cpu, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { planningShiftGoals, type ShiftGoalsReport } from "@/modules/planning/decision-system/shift-goals";
import { planningEngineDefaults } from "@/modules/planning/source-of-truth";

const number = (value: number, digits = 0) => value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const time = (value: Date) => value.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const pressName = (machineCode: string) => machineCode === "18" ? "P1.8" : machineCode === "19" ? "P1.9" : `P${machineCode}`;

export interface PlanningPressForecast {
  machineCode: string;
  plannedVolumeKgH: number;
  productivitySampleCount: number;
  workMinutes: number;
}

export function PlanningEnginePremises({ report, pressForecasts = [] }: { report: ShiftGoalsReport; pressForecasts?: PlanningPressForecast[] }) {
  const goals = planningShiftGoals;
  const forecastLabel = pressForecasts.length
    ? pressForecasts.map((press) => `${pressName(press.machineCode)} ${number(press.plannedVolumeKgH)} kg/h`).join(" · ")
    : "Sem carga para calcular";
  const forecastSamples = pressForecasts.length
    ? pressForecasts.map((press) => `${pressName(press.machineCode)}: ${press.productivitySampleCount} ferramenta(s)`).join(" · ")
    : "A previsão aparece depois que a carga é simulada.";
  return <Dialog>
    <DialogTrigger render={<Button variant="outline" size="sm" aria-label="Abrir Premissas do Motor" title="Premissas do Motor" />}>
      <Cpu className="size-4" aria-hidden="true" />
      <span className="hidden lg:inline">Premissas do Motor</span>
    </DialogTrigger>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
      <div className="flex items-start gap-3 pr-8">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700"><Cpu className="size-5" /></div>
        <div><DialogTitle>Como a programação é calculada</DialogTitle><DialogDescription>Resumo das metas, regras e números usados pelo sistema.</DialogDescription></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-xl border border-violet-200 bg-violet-50 p-4"><Target className="mb-2 size-5 text-violet-700" /><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Meta do turno</p><p className="mt-1 text-xl font-black">{number(goals.targetKg / 1000)} t</p><p className="text-sm text-slate-600">Soma das duas prensas.</p></article>
        <article className="rounded-xl border border-orange-200 bg-orange-50 p-4"><CircleGauge className="mb-2 size-5 text-orange-700" /><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Meta por prensa</p><p className="mt-1 text-xl font-black">{number(goals.targetProductivityKgH)} kg/h</p><p className="text-sm text-slate-600">Conferida em cada prensa.</p></article>
        <article className="rounded-xl border border-blue-200 bg-blue-50 p-4"><Calculator className="mb-2 size-5 text-blue-700" /><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Horário avaliado</p><p className="mt-1 text-xl font-black">{goals.startTime}–{goals.endTime}</p><p className="text-sm text-slate-600">9h40 disponíveis por prensa.</p></article>
      </div>
      <section className="rounded-xl border p-4"><h3 className="font-bold">Resultado desta programação</h3><p className="mt-1 text-sm text-slate-600">A velocidade prevista vem da média das produtividades informadas na Simplificada. A tabela mostra a produção possível no horário e o que limita cada prensa.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4"><div><p className="text-xs font-bold uppercase text-slate-500">Produção prevista</p><p className="text-lg font-black">{number(report.projectedKg)} kg <span className="text-sm font-semibold">({number(report.projectedTonnes, 1)} t)</span></p></div><div><p className="text-xs font-bold uppercase text-slate-500">Velocidade prevista</p><p className="text-lg font-black">{forecastLabel}</p><p className="text-xs text-slate-600">{forecastSamples}</p></div><div><p className="text-xs font-bold uppercase text-slate-500">Média no horário</p><p className="text-lg font-black">{number(report.averageProductivityKgH)} kg/h</p><p className="text-xs text-slate-600">produção prevista ÷ horas do turno</p></div><div><p className="text-xs font-bold uppercase text-slate-500">Prensas na meta</p><p className="text-lg font-black">{report.shiftsMeetingBothTargets}/{report.shifts.length || 0}</p></div></div>
        <p className="mt-2 text-xs text-slate-600">A média no horário serve para comparar com a meta. A velocidade prevista é usada para estimar o tempo de produção.</p>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-5"><div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs font-bold uppercase text-slate-500">Extrusão</span><strong>{number(report.productivity.technicalKgH)} kg/h</strong><small className="mt-1 block text-xs text-slate-600">só produzindo</small></div><div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs font-bold uppercase text-slate-500">Com paradas</span><strong>{number(report.productivity.operationalKgH)} kg/h</strong><small className="mt-1 block text-xs text-slate-600">inclui preparo e espera</small></div><div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs font-bold uppercase text-slate-500">Carga usada</span><strong>{number(report.productivity.loadCoveragePercent, 1)}%</strong><small className="mt-1 block text-xs text-slate-600">volume ÷ capacidade</small></div><div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs font-bold uppercase text-slate-500">Tempo disponível</span><strong>{number(report.productivity.availabilityPercent, 1)}%</strong><small className="mt-1 block text-xs text-slate-600">sem parada registrada</small></div><div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs font-bold uppercase text-slate-500">Sem carga</span><strong>{number(report.productivity.noLoadMinutes)} min</strong><small className="mt-1 block text-xs text-slate-600">tempo sem produzir</small></div></div>
        <p className="mt-4 text-xs text-slate-600">A meta de toneladas é conjunta. A meta de kg/h é conferida separadamente em cada prensa.</p>
        <div className="mt-2 overflow-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-2">Prensa / horário</th><th className="p-2">Produção</th><th className="p-2">Média / meta</th><th className="p-2">Extrusão / com paradas</th><th className="p-2">Carga usada</th><th className="p-2">O que limitou</th></tr></thead><tbody>{report.shifts.flatMap(shift => shift.presses.map(press => <tr className="border-b last:border-0" key={`${shift.startsAt.toISOString()}-${press.machineCode}`}><td className="p-2 font-semibold">{time(shift.startsAt)} · {pressName(press.machineCode)} · {goals.startTime}–{goals.endTime}</td><td className="p-2">{number(press.productivity.netKg)} kg</td><td className="p-2">{number(press.productivity.effectiveKgH)} / {number(goals.targetProductivityKgH)} kg/h<br /><span className={press.meetsProductivityTarget ? "font-semibold text-emerald-700" : "font-semibold text-orange-700"}>{press.meetsProductivityTarget ? "Meta atingida" : `Faltam ${number(Math.abs(press.productivityGapKgH))} kg/h`}</span></td><td className="p-2">{number(press.productivity.technicalKgH)} / {number(press.productivity.operationalKgH)} kg/h</td><td className="p-2">{number(press.productivity.loadCoveragePercent, 1)}%</td><td className="p-2 text-slate-600">{press.blockers[0] ?? "Nenhum limite identificado."}</td></tr>))}</tbody></table></div>
        {!report.shifts.length && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Ainda não há produção dentro da janela de turno para medir. Recalcule depois de incluir carga.</p>}
      </section>
      <section className="grid gap-4 md:grid-cols-2"><article className="rounded-xl border p-4"><h3 className="font-bold">Como o sistema calcula</h3><ul className="mt-2 space-y-2 text-sm text-slate-700"><li><strong>Velocidade prevista:</strong> média das produtividades informadas na Simplificada de cada prensa.</li><li><strong>Tempo produzindo:</strong> quantidade planejada ÷ velocidade prevista. Não conta preparo, espera ou parada.</li><li><strong>Preparo inicial:</strong> acontece uma vez, antes da primeira ferramenta.</li><li><strong>Troca de ferramenta:</strong> usa o tempo configurado (padrão: 1 minuto).</li><li><strong>Espera:</strong> tempo parado porque ferramenta, forno, carcaça, BO ou prensa não estavam disponíveis.</li><li><strong>Extrusão:</strong> kg/h somente enquanto produz.</li><li><strong>Com paradas:</strong> kg/h incluindo preparo e espera.</li><li><strong>Rendimento:</strong> compara o produto feito com o tarugo usado.</li></ul></article><article className="rounded-xl border p-4"><h3 className="font-bold">Regras obrigatórias</h3><ul className="mt-2 space-y-2 text-sm text-slate-700"><li>Ferramenta aquecida e disponível.</li><li>Forno, carcaça, BO e posição livres.</li><li>Tarugo, liga e eficiência compatíveis.</li><li>Respeito a paradas, turnos, prazos e ordens já iniciadas.</li></ul></article></section>
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-bold text-amber-950">Regra de revezamento</h3><p className="mt-1 text-sm text-amber-950">Entre <strong>{planningEngineDefaults.handoverStartTime} e {planningEngineDefaults.handoverEndTime}</strong>, quando houver opção, o sistema prefere ferramentas com até <strong>{planningEngineDefaults.handoverMaxHoles} furos</strong>.</p><p className="mt-2 text-xs text-amber-900">É uma preferência. Se não houver outra opção, a ordem não é bloqueada.</p></section>
      <section className="rounded-xl border border-violet-200 bg-violet-50 p-4"><h3 className="font-bold text-violet-950">Por que esta é a melhor opção?</h3><p className="mt-1 text-sm text-violet-950">Primeiro o motor respeita as restrições. Depois prioriza metas do turno, prazos, menos trocas e menor espera.</p><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-violet-950">{report.explanation.map(line => <li key={line}>{line}</li>)}</ul></section>
      <section className="rounded-xl border p-4"><h3 className="font-bold">Cenário usado</h3><p className="mt-1 text-sm text-slate-700">A programação parte da Simplificada. Quando um cenário diferente é escolhido, os mesmos pedidos e regras são recalculados.</p></section>
      <section className="rounded-xl border p-4"><h3 className="font-bold">Análise da IA</h3><p className="mt-1 text-sm text-slate-700">A IA explica o resultado e aponta gargalos. O sistema principal continua responsável pelos cálculos e bloqueios físicos.</p></section>
    </DialogContent>
  </Dialog>;
}
