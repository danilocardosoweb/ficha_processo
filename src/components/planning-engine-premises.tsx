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
        <div><DialogTitle>Premissas do Motor</DialogTitle><DialogDescription>Metas, regras e critérios usados para montar a programação.</DialogDescription></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <article className="rounded-xl border border-violet-200 bg-violet-50 p-4"><Target className="mb-2 size-5 text-violet-700" /><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Meta por turno</p><p className="mt-1 text-xl font-black">{number(goals.targetKg / 1000)} t</p><p className="text-sm text-slate-600">Soma das prensas.</p></article>
        <article className="rounded-xl border border-orange-200 bg-orange-50 p-4"><CircleGauge className="mb-2 size-5 text-orange-700" /><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Média mínima</p><p className="mt-1 text-xl font-black">{number(goals.targetProductivityKgH)} kg/h</p><p className="text-sm text-slate-600">Avaliada por prensa.</p></article>
        <article className="rounded-xl border border-blue-200 bg-blue-50 p-4"><Calculator className="mb-2 size-5 text-blue-700" /><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Janela avaliada</p><p className="mt-1 text-xl font-black">{goals.startTime}–{goals.endTime}</p><p className="text-sm text-slate-600">9h40 por prensa e por dia.</p></article>
      </div>
      <section className="rounded-xl border p-4"><h3 className="font-bold">Resultado desta programação</h3><p className="mt-1 text-sm text-slate-600">A previsão de trabalho é calculada separadamente por prensa, pela média simples das produtividades da Simplificada. Os demais indicadores mostram o desempenho da janela e onde há perda de tempo ou falta de carga.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4"><div><p className="text-xs font-bold uppercase text-slate-500">Produção projetada</p><p className="text-lg font-black">{number(report.projectedKg)} kg <span className="text-sm font-semibold">({number(report.projectedTonnes, 1)} t)</span></p></div><div><p className="text-xs font-bold uppercase text-slate-500">Previsão da Simplificada</p><p className="text-lg font-black">{forecastLabel}</p><p className="text-xs text-slate-600">{forecastSamples}</p></div><div><p className="text-xs font-bold uppercase text-slate-500">Média da janela (meta)</p><p className="text-lg font-black">{number(report.averageProductivityKgH)} kg/h</p><p className="text-xs text-slate-600">produção ÷ janela calendarizada; não é a previsão</p></div><div><p className="text-xs font-bold uppercase text-slate-500">Turnos na meta</p><p className="text-lg font-black">{report.shiftsMeetingBothTargets}/{report.shifts.length || 0}</p></div></div>
        <p className="mt-2 text-xs text-slate-600">A média da janela inclui o denominador configurado para a meta ({goals.productivityBasis}), por isso pode ficar abaixo da velocidade de extrusão. Ela serve para avaliar o turno; a previsão por prensa serve para estimar o tempo útil da carga.</p>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-5"><div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs font-bold uppercase text-slate-500">Técnica</span><strong>{number(report.productivity.technicalKgH)} kg/h</strong><small className="mt-1 block text-xs text-slate-600">somente extrusão</small></div><div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs font-bold uppercase text-slate-500">Operacional</span><strong>{number(report.productivity.operationalKgH)} kg/h</strong><small className="mt-1 block text-xs text-slate-600">inclui preparo e esperas</small></div><div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs font-bold uppercase text-slate-500">Cobertura de carga</span><strong>{number(report.productivity.loadCoveragePercent, 1)}%</strong></div><div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs font-bold uppercase text-slate-500">Disponibilidade</span><strong>{number(report.productivity.availabilityPercent, 1)}%</strong></div><div className="rounded-lg bg-slate-50 p-3"><span className="block text-xs font-bold uppercase text-slate-500">NO_LOAD</span><strong>{number(report.productivity.noLoadMinutes)} min</strong></div></div>
        <p className="mt-4 text-xs text-slate-600">A tabela abaixo é separada por prensa. A meta de 25 t continua sendo conjunta; a meta de kg/h é conferida individualmente.</p>
        <div className="mt-2 overflow-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="border-b text-xs uppercase text-slate-500"><th className="p-2">Turno / prensa</th><th className="p-2">Produção líquida</th><th className="p-2">Média da janela / meta</th><th className="p-2">Técnica / operacional</th><th className="p-2">Cobertura</th><th className="p-2">Principal limite</th></tr></thead><tbody>{report.shifts.flatMap(shift => shift.presses.map(press => <tr className="border-b last:border-0" key={`${shift.startsAt.toISOString()}-${press.machineCode}`}><td className="p-2 font-semibold">{time(shift.startsAt)} · {pressName(press.machineCode)} · {goals.startTime}–{goals.endTime}</td><td className="p-2">{number(press.productivity.netKg)} kg</td><td className="p-2">{number(press.productivity.effectiveKgH)} / {number(goals.targetProductivityKgH)} kg/h<br /><span className={press.meetsProductivityTarget ? "text-emerald-700" : "text-orange-700"}>{press.meetsProductivityTarget ? "Atinge" : "Falta"} {number(Math.abs(press.productivityGapKgH))}</span></td><td className="p-2">{number(press.productivity.technicalKgH)} / {number(press.productivity.operationalKgH)} kg/h</td><td className="p-2">{number(press.productivity.loadCoveragePercent, 1)}%</td><td className="p-2 text-slate-600">{press.blockers[0] ?? "Sem gargalo calculado."}</td></tr>))}</tbody></table></div>
        {!report.shifts.length && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950">Ainda não há produção dentro da janela de turno para medir. Recalcule depois de incluir carga.</p>}
      </section>
      <section className="grid gap-4 md:grid-cols-2"><article className="rounded-xl border p-4"><h3 className="font-bold">Como os números são calculados</h3><ul className="mt-2 space-y-2 text-sm text-slate-700"><li><strong>Previsão por prensa:</strong> média simples das produtividades válidas das ferramentas da Simplificada.</li><li><strong>Tempo útil:</strong> volume planejado ÷ previsão da prensa; não soma preparo, espera ou máquina parada.</li><li><strong>Preparação inicial:</strong> ocorre uma única vez, antes da primeira ferramenta da prensa.</li><li><strong>Troca de ferramenta:</strong> usa o tempo morto configurado por troca (padrão: 1 min).</li><li><strong>Tempo aguardando:</strong> período em que a ferramenta, o forno, a carcaça, o BO ou a prensa não estavam disponíveis; não inclui o preparo.</li><li><strong>Técnica:</strong> kg por hora de extrusão.</li><li><strong>Operacional:</strong> kg por hora considerando preparo e esperas.</li><li><strong>Rendimento:</strong> kg produzidos comparados ao tarugo necessário.</li></ul></article><article className="rounded-xl border p-4"><h3 className="font-bold">O que o motor respeita</h3><ul className="mt-2 space-y-2 text-sm text-slate-700"><li>Ferramenta pronta, aquecida e disponível.</li><li>Carcaça, BO, forno e posições livres.</li><li>Tarugo, liga, eficiência e alternativas permitidas.</li><li>Paradas, turnos, ordens iniciadas e prazos.</li></ul></article></section>
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-bold text-amber-950">Revezamento</h3><p className="mt-1 text-sm text-amber-950">Das <strong>{planningEngineDefaults.handoverStartTime} às {planningEngineDefaults.handoverEndTime}</strong>, o motor evita ferramentas acima de <strong>{planningEngineDefaults.handoverMaxHoles} furos</strong>, quando houver alternativa. Isso reduz o risco de mesa cheia com equipe menor.</p><p className="mt-2 text-xs text-amber-900">É uma preferência: não bloqueia uma ordem sem opção viável.</p></section>
      <section className="rounded-xl border border-violet-200 bg-violet-50 p-4"><h3 className="font-bold text-violet-950">Por que esta é a melhor opção?</h3><p className="mt-1 text-sm text-violet-950">Primeiro o motor respeita as restrições. Depois prioriza metas do turno, prazos, menos trocas e menor espera.</p><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-violet-950">{report.explanation.map(line => <li key={line}>{line}</li>)}</ul></section>
      <section className="rounded-xl border p-4"><h3 className="font-bold">Cenários do motor</h3><p className="mt-1 text-sm text-slate-700">Original preserva a Simplificada. Material reduz consumo. Produtividade busca mais volume e kg/h. Balanceado compara os impactos. Todos usam os mesmos dados e restrições.</p></section>
      <section className="rounded-xl border p-4"><h3 className="font-bold">Análise da IA</h3><p className="mt-1 text-sm text-slate-700">A IA explica resultado, metas, gargalos e melhorias possíveis. Os cálculos e bloqueios físicos continuam sob controle do motor.</p></section>
    </DialogContent>
  </Dialog>;
}
