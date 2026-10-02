import { workingMinutesBetween, type LoadSimulation, type OvertimePeriodInput, type ResourceUnavailabilityInput, type ScheduledLoadItem, type WorkShiftInput } from "../machine-load-simulator";
import { planningEngineDefaults, type ProductivityBasis } from "../source-of-truth";

const MINUTE = 60_000;

/** Metas da operação, aplicadas ao conjunto das prensas que participam da carga. */
export const planningShiftGoals = {
  startTime: planningEngineDefaults.shiftStartTime,
  endTime: planningEngineDefaults.shiftEndTime,
  targetKg: planningEngineDefaults.targetKgPerShift,
  targetProductivityKgH: planningEngineDefaults.targetProductivityKgH,
  productivityBasis: planningEngineDefaults.productivityBasis,
} as const;

export interface ShiftProductivityMetrics {
  /** Base usada para comparar a meta de kg/h nesta avaliação. */
  basis: ProductivityBasis;
  /** Taxa enquanto a prensa está efetivamente extrudando. */
  technicalKgH: number;
  /** Taxa considerando extrusão, preparação e esperas operacionais. */
  operationalKgH: number;
  /** Saída líquida distribuída pelas horas calendarizadas das prensas. */
  grossPerPressKgH: number;
  /** Saída líquida por hora de extrusão, sem penalizar o tempo sem carga. */
  netPerPressKgH: number;
  /** Saída líquida dividida pelo total de horas das prensas participantes. */
  totalGrossKgH: number;
  /** Visão que efetivamente é comparada à meta configurada. */
  effectiveKgH: number;
  netKg: number;
  grossKg: number;
  yieldPercent: number | null;
  capacityMinutes: number;
  availableMinutes: number;
  operationalMinutes: number;
  extrusionMinutes: number;
  deadCycleMinutes: number;
  setupMinutes: number;
  heatingWaitMinutes: number;
  resourceWaitMinutes: number;
  laborWaitMinutes: number;
  plannedStopMinutes: number;
  unplannedStopMinutes: number;
  noLoadMinutes: number;
  utilizationPercent: number;
  loadCoveragePercent: number;
  availabilityPercent: number;
}

/** Resultado individual de uma prensa. Nunca combina horas de prensas distintas. */
export interface PressProductivityResult {
  machineCode: string;
  /** Quantidade de janelas diárias desta prensa que entram na consolidação. */
  shiftCount: number;
  productivity: ShiftProductivityMetrics;
  meetsProductivityTarget: boolean;
  productivityGapKgH: number;
  blockers: string[];
}

export interface ShiftGoalResult {
  startsAt: Date;
  endsAt: Date;
  activePresses: number;
  capacityMinutes: number;
  projectedKg: number;
  projectedTonnes: number;
  averageProductivityKgH: number;
  volumeGapKg: number;
  productivityGapKgH: number;
  meetsVolumeTarget: boolean;
  meetsProductivityTarget: boolean;
  blockers: string[];
  productivity: ShiftProductivityMetrics;
  presses: PressProductivityResult[];
}

export interface ShiftGoalsReport {
  goals: typeof planningShiftGoals;
  shifts: ShiftGoalResult[];
  projectedKg: number;
  projectedTonnes: number;
  averageProductivityKgH: number;
  volumeGapKg: number;
  productivityGapKgH: number;
  shiftsMeetingBothTargets: number;
  shiftsBelowTargets: number;
  priorityPenalty: number;
  explanation: string[];
  productivity: ShiftProductivityMetrics;
  /** Consolidação por prensa em todas as janelas de turno avaliadas. */
  presses: PressProductivityResult[];
  pressesMeetingProductivityTarget: number;
  pressesBelowProductivityTarget: number;
}

function atTime(day: Date, time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
}

function overlapMinutes(start: Date, end: Date, windowStart: Date, windowEnd: Date) {
  return Math.max(0, Math.min(end.getTime(), windowEnd.getTime()) - Math.max(start.getTime(), windowStart.getTime())) / MINUTE;
}

function workingSlice(from: Date, to: Date, startsAt: Date, endsAt: Date, shifts: WorkShiftInput[], machineCode: string, unavailable: ResourceUnavailabilityInput[], overtimePeriods: OvertimePeriodInput[]) {
  if (shifts.length) {
    const clippedStart = new Date(Math.max(from.getTime(), startsAt.getTime()));
    const clippedEnd = new Date(Math.min(to.getTime(), endsAt.getTime()));
    return clippedEnd > clippedStart ? workingMinutesBetween(clippedStart, clippedEnd, shifts, machineCode, unavailable, overtimePeriods) : 0;
  }
  return overlapMinutes(from, to, startsAt, endsAt);
}

function itemSlice(item: ScheduledLoadItem, startsAt: Date, endsAt: Date, shifts: WorkShiftInput[], unavailable: ResourceUnavailabilityInput[], overtimePeriods: OvertimePeriodInput[]) {
  const extrusionMinutes = workingSlice(item.extrusionStartAt, item.endAt, startsAt, endsAt, shifts, item.machineCode, unavailable, overtimePeriods);
  const fraction = item.theoreticalMinutes > 0 ? Math.min(1, extrusionMinutes / item.theoreticalMinutes) : 0;
  return {
    extrusionMinutes,
    netKg: extrusionMinutes * item.productivityKgH / 60,
    grossKg: item.billetRequiredKg * fraction,
    setupMinutes: workingSlice(item.startAt, item.extrusionStartAt, startsAt, endsAt, shifts, item.machineCode, unavailable, overtimePeriods),
    preProductionMinutes: workingSlice(item.pressReadyAt, item.startAt, startsAt, endsAt, shifts, item.machineCode, unavailable, overtimePeriods),
    deadCycleMinutes: Math.max(0, item.deadCycleMinutes ?? 0) * fraction,
    laborWaitMinutes: Math.max(0, item.laborWaitMinutes ?? 0) * fraction,
  };
}

function rate(kg: number, minutes: number) {
  return minutes > 0 ? kg / (minutes / 60) : 0;
}

function stopCategory(stop: ResourceUnavailabilityInput): "PLANNED_STOP" | "UNPLANNED_STOP" {
  if (stop.stopCategory) return stop.stopCategory;
  return /não\s*planejad|unplanned|quebra|emerg/i.test(stop.reason) ? "UNPLANNED_STOP" : "PLANNED_STOP";
}

function unionMinutes(intervals: Array<{ start: Date; end: Date }>, startsAt: Date, endsAt: Date) {
  const clipped = intervals
    .map(interval => ({
      start: Math.max(interval.start.getTime(), startsAt.getTime()),
      end: Math.min(interval.end.getTime(), endsAt.getTime()),
    }))
    .filter(interval => interval.end > interval.start)
    .sort((left, right) => left.start - right.start);
  let total = 0;
  let current: { start: number; end: number } | null = null;
  for (const interval of clipped) {
    if (!current) current = interval;
    else if (interval.start <= current.end) current.end = Math.max(current.end, interval.end);
    else {
      total += (current.end - current.start) / MINUTE;
      current = interval;
    }
  }
  if (current) total += (current.end - current.start) / MINUTE;
  return total;
}

function emptyProductivity(basis: ProductivityBasis = planningShiftGoals.productivityBasis): ShiftProductivityMetrics {
  return {
    basis,
    technicalKgH: 0,
    operationalKgH: 0,
    grossPerPressKgH: 0,
    netPerPressKgH: 0,
    totalGrossKgH: 0,
    effectiveKgH: 0,
    netKg: 0,
    grossKg: 0,
    yieldPercent: null,
    capacityMinutes: 0,
    availableMinutes: 0,
    operationalMinutes: 0,
    extrusionMinutes: 0,
    deadCycleMinutes: 0,
    setupMinutes: 0,
    heatingWaitMinutes: 0,
    resourceWaitMinutes: 0,
    laborWaitMinutes: 0,
    plannedStopMinutes: 0,
    unplannedStopMinutes: 0,
    noLoadMinutes: 0,
    utilizationPercent: 0,
    loadCoveragePercent: 0,
    availabilityPercent: 0,
  };
}

function productivityFor(
  items: ScheduledLoadItem[],
  machinesInShift: number,
  machineCodes: string[],
  startsAt: Date,
  endsAt: Date,
  shiftMinutes: number,
  unavailable: ResourceUnavailabilityInput[],
  shifts: WorkShiftInput[],
  overtimePeriods: OvertimePeriodInput[],
): ShiftProductivityMetrics {
  const slices = items.map(item => ({ item, slice: itemSlice(item, startsAt, endsAt, shifts, unavailable, overtimePeriods) }));
  const netKg = slices.reduce((sum, value) => sum + value.slice.netKg, 0);
  const grossKg = slices.reduce((sum, value) => sum + value.slice.grossKg, 0);
  const extrusionMinutes = slices.reduce((sum, value) => sum + value.slice.extrusionMinutes, 0);
  const setupMinutes = slices.reduce((sum, value) => sum + value.slice.setupMinutes, 0);
  const waitMinutes = slices.reduce((sum, value) => sum + value.slice.preProductionMinutes, 0);
  const deadCycleMinutes = slices.reduce((sum, value) => sum + value.slice.deadCycleMinutes, 0);
  const laborWaitMinutes = slices.reduce((sum, value) => sum + value.slice.laborWaitMinutes, 0);

  // O simulador já calcula as duas esperas em sequência: aquecimento antes de
  // recurso. Atribuímos somente a parcela dentro do turno, sem sobreposição.
  const heatingWaitMinutes = slices.reduce((sum, value) => {
    const total = value.item.thermalWaitMinutes + value.item.resourceWaitMinutes;
    return sum + (total > 0 ? value.slice.preProductionMinutes * value.item.thermalWaitMinutes / total : 0);
  }, 0);
  const resourceWaitMinutes = Math.max(0, waitMinutes - heatingWaitMinutes);
  const capacityMinutes = Math.max(machinesInShift, 1) * shiftMinutes;
  const normalizedMachineCodes = new Set(machineCodes.map(code => code.trim().toUpperCase()));
  const stops = unavailable.filter(stop => stop.status === "active" && stop.resourceType === "press" && normalizedMachineCodes.has(stop.resourceCode.trim().toUpperCase()));
  const plannedStopMinutes = unionMinutes(stops.filter(stop => stopCategory(stop) === "PLANNED_STOP").map(stop => ({ start: stop.startsAt, end: stop.endsAt })), startsAt, endsAt);
  const unplannedStopMinutes = unionMinutes(stops.filter(stop => stopCategory(stop) === "UNPLANNED_STOP").map(stop => ({ start: stop.startsAt, end: stop.endsAt })), startsAt, endsAt);
  const availableMinutes = Math.max(0, capacityMinutes - plannedStopMinutes - unplannedStopMinutes);
  const operationalMinutes = Math.min(availableMinutes, extrusionMinutes + deadCycleMinutes + setupMinutes + heatingWaitMinutes + resourceWaitMinutes + laborWaitMinutes);
  const noLoadMinutes = Math.max(0, availableMinutes - operationalMinutes);
  const technicalKgH = rate(netKg, extrusionMinutes);
  const operationalKgH = rate(netKg, operationalMinutes);
  // PER_PRESS_GROSS usa a janela completa da prensa. Paradas planejadas
  // continuam reduzindo o resultado e aparecem separadas em disponibilidade.
  const grossPerPressKgH = rate(netKg, capacityMinutes);
  const netPerPressKgH = technicalKgH;
  // TOTAL_GROSS é a saída combinada das prensas por hora-calendário do turno.
  const totalGrossKgH = rate(netKg, shiftMinutes);
  const effectiveKgH = planningShiftGoals.productivityBasis === "PER_PRESS_NET"
    ? netPerPressKgH
    : planningShiftGoals.productivityBasis === "TOTAL_GROSS"
      ? totalGrossKgH
      : grossPerPressKgH;

  return {
    basis: planningShiftGoals.productivityBasis,
    technicalKgH,
    operationalKgH,
    grossPerPressKgH,
    netPerPressKgH,
    totalGrossKgH,
    effectiveKgH,
    netKg,
    grossKg,
    yieldPercent: grossKg > 0 ? netKg / grossKg * 100 : null,
    capacityMinutes,
    availableMinutes,
    operationalMinutes,
    extrusionMinutes,
    deadCycleMinutes,
    setupMinutes,
    heatingWaitMinutes,
    resourceWaitMinutes,
    laborWaitMinutes,
    plannedStopMinutes,
    unplannedStopMinutes,
    noLoadMinutes,
    utilizationPercent: availableMinutes > 0 ? extrusionMinutes / availableMinutes * 100 : 0,
    loadCoveragePercent: availableMinutes > 0 ? operationalMinutes / availableMinutes * 100 : 0,
    availabilityPercent: capacityMinutes > 0 ? availableMinutes / capacityMinutes * 100 : 0,
  };
}

function daysCovered(simulation: LoadSimulation) {
  const points = simulation.machines.flatMap(machine => machine.items.flatMap(item => [item.startAt, item.endAt]));
  if (!points.length) return [] as Date[];
  const first = new Date(Math.min(...points.map(point => point.getTime())));
  const last = new Date(Math.max(...points.map(point => point.getTime())));
  const days: Date[] = [];
  for (let day = new Date(first.getFullYear(), first.getMonth(), first.getDate()); day <= last; day.setDate(day.getDate() + 1))
    days.push(new Date(day));
  return days;
}

function blockersFor(items: ScheduledLoadItem[], metrics: ShiftProductivityMetrics, projectedKg: number) {
  const blockers: string[] = [];
  const lowProductivity = items.filter(item => item.productivityKgH < planningShiftGoals.targetProductivityKgH).length;
  const shortOrders = items.filter(item => item.remainingKg < 300).length;
  if (metrics.setupMinutes > 0) blockers.push(`${Math.round(metrics.setupMinutes)} min de preparação e troca de ferramenta.`);
  if (metrics.heatingWaitMinutes > 0) blockers.push(`${Math.round(metrics.heatingWaitMinutes)} min de espera por aquecimento de ferramenta.`);
  if (metrics.resourceWaitMinutes > 0) blockers.push(`${Math.round(metrics.resourceWaitMinutes)} min de espera por carcaça, BO ou outro recurso.`);
  if (metrics.laborWaitMinutes > 0) blockers.push(`${Math.round(metrics.laborWaitMinutes)} min de espera de mão de obra.`);
  if (lowProductivity > 0) blockers.push(`${lowProductivity} ferramenta(s) abaixo de ${planningShiftGoals.targetProductivityKgH.toLocaleString("pt-BR")} kg/h.`);
  if (shortOrders > 0) blockers.push(`${shortOrders} ordem(ns) pequena(s), que aumentam a proporção de setup.`);
  if (metrics.noLoadMinutes > 0) blockers.push(`${Math.round(metrics.noLoadMinutes)} min de NO_LOAD: falta de carga para ocupar a capacidade disponível.`);
  if (metrics.plannedStopMinutes > 0) blockers.push(`${Math.round(metrics.plannedStopMinutes)} min de parada planejada.`);
  if (metrics.unplannedStopMinutes > 0) blockers.push(`${Math.round(metrics.unplannedStopMinutes)} min de parada não planejada.`);
  if (!items.length || projectedKg === 0) blockers.push("Não há carga planejada para este turno.");
  if (metrics.effectiveKgH < planningShiftGoals.targetProductivityKgH && !blockers.length)
    blockers.push("A combinação atual não sustenta a produtividade mínima na base configurada.");
  return blockers;
}

function aggregateProductivity(shifts: ShiftGoalResult[]): ShiftProductivityMetrics {
  if (!shifts.length) return emptyProductivity();
  const totals = shifts.reduce((total, shift) => {
    const metrics = shift.productivity;
    total.capacityMinutes += metrics.capacityMinutes;
    total.availableMinutes += metrics.availableMinutes;
    total.operationalMinutes += metrics.operationalMinutes;
    total.extrusionMinutes += metrics.extrusionMinutes;
    total.deadCycleMinutes += metrics.deadCycleMinutes;
    total.setupMinutes += metrics.setupMinutes;
    total.heatingWaitMinutes += metrics.heatingWaitMinutes;
    total.resourceWaitMinutes += metrics.resourceWaitMinutes;
    total.laborWaitMinutes += metrics.laborWaitMinutes;
    total.plannedStopMinutes += metrics.plannedStopMinutes;
    total.unplannedStopMinutes += metrics.unplannedStopMinutes;
    total.noLoadMinutes += metrics.noLoadMinutes;
    total.netKg += metrics.netKg;
    total.grossKg += metrics.grossKg;
    return total;
  }, emptyProductivity());
  const technicalKgH = rate(totals.netKg, totals.extrusionMinutes);
  const operationalKgH = rate(totals.netKg, totals.operationalMinutes);
  const grossPerPressKgH = rate(totals.netKg, totals.capacityMinutes);
  const netPerPressKgH = technicalKgH;
  const calendarMinutes = shifts.reduce((sum, shift) => sum + (shift.endsAt.getTime() - shift.startsAt.getTime()) / MINUTE, 0);
  const totalGrossKgH = rate(totals.netKg, calendarMinutes);
  const effectiveKgH = planningShiftGoals.productivityBasis === "PER_PRESS_NET" ? netPerPressKgH : planningShiftGoals.productivityBasis === "TOTAL_GROSS" ? totalGrossKgH : grossPerPressKgH;
  return {
    ...totals,
    basis: planningShiftGoals.productivityBasis,
    technicalKgH,
    operationalKgH,
    grossPerPressKgH,
    netPerPressKgH,
    totalGrossKgH,
    effectiveKgH,
    yieldPercent: totals.grossKg > 0 ? totals.netKg / totals.grossKg * 100 : null,
    utilizationPercent: totals.availableMinutes > 0 ? totals.extrusionMinutes / totals.availableMinutes * 100 : 0,
    loadCoveragePercent: totals.availableMinutes > 0 ? totals.operationalMinutes / totals.availableMinutes * 100 : 0,
    availabilityPercent: totals.capacityMinutes > 0 ? totals.availableMinutes / totals.capacityMinutes * 100 : 0,
  };
}

function aggregatePressProductivity(shifts: ShiftGoalResult[]): PressProductivityResult[] {
  const byPress = new Map<string, PressProductivityResult[]>();
  for (const shift of shifts) for (const press of shift.presses) {
    const key = press.machineCode.trim().toUpperCase();
    byPress.set(key, [...(byPress.get(key) ?? []), press]);
  }
  return [...byPress.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([machineCode, values]) => {
    const metrics = aggregateProductivity(values.map(value => ({
      startsAt: new Date(0), endsAt: new Date(value.productivity.capacityMinutes * MINUTE), activePresses: 1,
      capacityMinutes: value.productivity.capacityMinutes, projectedKg: value.productivity.netKg,
      projectedTonnes: value.productivity.netKg / 1_000, averageProductivityKgH: value.productivity.effectiveKgH,
      volumeGapKg: 0, productivityGapKgH: value.productivityGapKgH, meetsVolumeTarget: true,
      meetsProductivityTarget: value.meetsProductivityTarget, blockers: value.blockers, productivity: value.productivity,
      presses: [],
    } satisfies ShiftGoalResult)));
    const productivityGapKgH = metrics.effectiveKgH - planningShiftGoals.targetProductivityKgH;
    return {
      machineCode,
      shiftCount: values.reduce((total, value) => total + value.shiftCount, 0),
      productivity: metrics,
      meetsProductivityTarget: productivityGapKgH >= 0,
      productivityGapKgH,
      blockers: values.flatMap(value => value.blockers).filter((value, index, list) => list.indexOf(value) === index),
    };
  });
}

/**
 * Mede cada janela diária de 06:30–16:10.
 *
 * A média usada pela meta é explícita em `productivity.basis`. Os demais
 * indicadores permanecem visíveis para evitar confundir velocidade técnica,
 * produtividade operacional e cobertura da capacidade.
 */
export function evaluateShiftGoals(simulation: LoadSimulation): ShiftGoalsReport {
  const shifts = daysCovered(simulation).map(day => {
    const startsAt = atTime(day, planningShiftGoals.startTime);
    const endsAt = atTime(day, planningShiftGoals.endTime);
    const overlappingMachines = simulation.machines.filter(machine => machine.items.some(item => overlapMinutes(item.startAt, item.endAt, startsAt, endsAt) > 0));
    const overlapping = overlappingMachines.flatMap(machine => machine.items).filter(item => overlapMinutes(item.startAt, item.endAt, startsAt, endsAt) > 0);
    if (!overlapping.length) return null;
    const shiftMinutes = (endsAt.getTime() - startsAt.getTime()) / MINUTE;
    const presses = overlappingMachines.map(machine => {
      const items = machine.items.filter(item => overlapMinutes(item.startAt, item.endAt, startsAt, endsAt) > 0);
      const pressProductivity = productivityFor(items, 1, [machine.machineCode], startsAt, endsAt, shiftMinutes, simulation.unavailable ?? [], simulation.shifts ?? [], simulation.overtimePeriods ?? []);
      const productivityGapKgH = pressProductivity.effectiveKgH - planningShiftGoals.targetProductivityKgH;
      return {
        machineCode: machine.machineCode,
        shiftCount: 1,
        productivity: pressProductivity,
        meetsProductivityTarget: productivityGapKgH >= 0,
        productivityGapKgH,
        blockers: blockersFor(items, pressProductivity, pressProductivity.netKg),
      } satisfies PressProductivityResult;
    });
    // A visão agregada serve para volume e contexto. A meta de kg/h é julgada
    // individualmente em `presses`, evitando que uma prensa esconda a outra.
    const productivity = productivityFor(overlapping, overlappingMachines.length, overlappingMachines.map(machine => machine.machineCode), startsAt, endsAt, shiftMinutes, simulation.unavailable ?? [], simulation.shifts ?? [], simulation.overtimePeriods ?? []);
    const projectedKg = productivity.netKg;
    const volumeGapKg = projectedKg - planningShiftGoals.targetKg;
    const productivityGapKgH = Math.min(...presses.map(press => press.productivityGapKgH));
    return {
      startsAt, endsAt, activePresses: overlappingMachines.length, capacityMinutes: productivity.capacityMinutes, projectedKg,
      projectedTonnes: projectedKg / 1_000, averageProductivityKgH: productivity.effectiveKgH, volumeGapKg, productivityGapKgH,
      meetsVolumeTarget: volumeGapKg >= 0, meetsProductivityTarget: presses.every(press => press.meetsProductivityTarget),
      blockers: [...blockersFor(overlapping, productivity, projectedKg), ...presses.filter(press => !press.meetsProductivityTarget).map(press => `${press.machineCode}: ${Math.round(-press.productivityGapKgH)} kg/h abaixo da meta individual.`)], productivity, presses,
    } satisfies ShiftGoalResult;
  }).filter((shift): shift is ShiftGoalResult => shift !== null);
  const productivity = aggregateProductivity(shifts);
  const presses = aggregatePressProductivity(shifts);
  const projectedKg = productivity.netKg;
  const averageProductivityKgH = productivity.effectiveKgH;
  const volumeGapKg = shifts.reduce((sum, shift) => sum + Math.min(shift.volumeGapKg, 0), 0);
  const productivityGapKgH = shifts.reduce((sum, shift) => sum + Math.min(shift.productivityGapKgH, 0), 0);
  const shiftsMeetingBothTargets = shifts.filter(shift => shift.meetsVolumeTarget && shift.meetsProductivityTarget).length;
  const shiftsBelowTargets = shifts.length - shiftsMeetingBothTargets;
  const explanation = shifts.length === 0
    ? ["A programação ainda não ocupa nenhuma janela de turno de 06:30 a 16:10."]
    : [
      `${shiftsMeetingBothTargets} de ${shifts.length} turno(s) atendem simultaneamente à meta de volume e à produtividade individual por prensa na base ${planningShiftGoals.productivityBasis}.`,
      `${presses.filter(press => press.meetsProductivityTarget).length} de ${presses.length} prensa(s) atingem ${planningShiftGoals.targetProductivityKgH.toLocaleString("pt-BR")} kg/h individualmente.`,
      `Visões calculadas: técnica ${Math.round(productivity.technicalKgH).toLocaleString("pt-BR")} kg/h, operacional ${Math.round(productivity.operationalKgH).toLocaleString("pt-BR")} kg/h e cobertura ${Math.round(productivity.loadCoveragePercent)}%.`,
      ...(shiftsBelowTargets ? ["O motor prioriza reduzir primeiro a falta de toneladas e de kg/h nos turnos que ainda não atendem à meta."] : ["A programação atende às duas metas nos turnos com carga planejada."]),
    ];
  return {
    goals: planningShiftGoals, shifts, projectedKg, projectedTonnes: projectedKg / 1_000,
    averageProductivityKgH, volumeGapKg, productivityGapKgH, shiftsMeetingBothTargets, shiftsBelowTargets,
    priorityPenalty: shifts.reduce((sum, shift) => sum + Math.max(0, -shift.volumeGapKg) / planningShiftGoals.targetKg + Math.max(0, -shift.productivityGapKgH) / planningShiftGoals.targetProductivityKgH, 0),
    explanation, productivity, presses,
    pressesMeetingProductivityTarget: presses.filter(press => press.meetsProductivityTarget).length,
    pressesBelowProductivityTarget: presses.filter(press => !press.meetsProductivityTarget).length,
  };
}
