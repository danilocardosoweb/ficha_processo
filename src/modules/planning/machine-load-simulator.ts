export type ProductivitySource = "simplificada" | "aprendizado" | "ficha" | "ferramenta" | "padrao";

export interface LoadOrderInput {
  id: string;
  orderNumber: string;
  planCode: string;
  machineCode: string;
  toolCode: string;
  alloyCode: string;
  alternativeAlloys: string[];
  targetKg: number;
  producedKg: number;
  sequence: number;
  dueDate: string | null;
  status: string;
  productivityKgH: number;
  productivitySource: ProductivitySource;
  toolReadyAt: Date | null;
  toolHeatingState: "released" | "heating" | "waiting";
  /** Physical extrusion holes. Tracked now; rule influence will be versioned later. */
  holes?: number | null;
  /** BO físico compartilhado entre as prensas. */
  boCode?: string | null;
  packageMeasureMm?: number | null;
  carcassDiameterMm?: number | null;
  carcassCode?: string | null;
  carcassQuantity?: number;
}

export interface WorkShiftInput {
  id: string;
  code: string;
  name: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  machineCodes: string[];
  isActive: boolean;
}

export interface ResourceUnavailabilityInput {
  id: string;
  resourceType: "press" | "oven" | "tool" | "carcass" | "bo";
  resourceCode: string;
  startsAt: Date;
  endsAt: Date;
  reason: string;
  status: "active" | "cancelled";
}

export interface MachineLoadSettings {
  billetBarWeightKg: number;
  extrusionEfficiency: number;
  defaultProductivityKgH: number;
  setupMinutes: number;
  alloyChangeMinutes: number;
  toolHeatingMinutes: number;
  ovenCount: number;
  ovenSlotsPerOven: number;
  ovenSlots: number;
}

export interface ExistingResourceReservation {
  id: string;
  quantity: number;
  startsAt: Date | null;
  endsAt: Date | null;
  productionOrderId?: string | null;
}

export interface CarcassCapacityInput {
  code: string;
  capacity: number;
  reservations: ExistingResourceReservation[];
}

export interface BoCapacityInput {
  code: string;
  capacity: number;
}

export interface SimulationResourcesInput {
  carcasses: CarcassCapacityInput[];
  bos: BoCapacityInput[];
}

export interface SimulationConflict {
  id: string;
  type: "missing-carcass" | "carcass-capacity" | "missing-bo" | "bo-capacity" | "tool-conflict" | "resource-calendar";
  severity: "blocking" | "warning";
  resourceCode: string;
  machineCode: string;
  orderId: string;
  toolCode: string;
  message: string;
  delayMinutes: number;
}

export interface ScheduledLoadItem extends LoadOrderInput {
  remainingKg: number;
  selectedAlloy: string;
  startAt: Date;
  extrusionStartAt: Date;
  endAt: Date;
  theoreticalMinutes: number;
  waitingMinutes: number;
  preparationMinutes: number;
  billetRequiredKg: number;
  billetBarsLoaded: number;
  billetBalanceBeforeKg: number;
  billetBalanceAfterKg: number;
  pressReadyAt: Date;
  toolHeatingStartAt: Date | null;
  calculatedToolReadyAt: Date;
  latestHeatingStartAt: Date;
  ovenSlotNumber: number | null;
  thermalWaitMinutes: number;
  resourceWaitMinutes: number;
  resourceConflicts: SimulationConflict[];
}

export type ThermalCoverageStatus = "protected" | "attention" | "risk";

export interface ThermalCoverageSummary {
  status: ThermalCoverageStatus;
  heatingHorizonMinutes: number;
  minimumMixKg: number;
  protectedBufferKg: number;
  protectedProductionMinutes: number;
  shortRunCount: number;
  maxConsecutiveShortRuns: number;
  peakOvenSlotsUsed: number;
  ovenSlots: number;
  predictedIdleMinutes: number;
  riskItemCount: number;
  firstRiskToolCode: string | null;
  firstRiskAt: Date | null;
  nextToolToHeat: string | null;
  nextHeatingDeadlineAt: Date | null;
}

export interface BilletLoadSummary {
  alloyCode: string;
  demandKg: number;
  rawRequiredKg: number;
  bars: number;
  loadedKg: number;
  endingBalanceKg: number;
}

export interface MachineSimulation {
  machineCode: string;
  items: ScheduledLoadItem[];
  startsAt: Date | null;
  theoreticalMinutes: number;
  simulatedMinutes: number;
  waitingMinutes: number;
  endsAt: Date | null;
  thermalCoverage: ThermalCoverageSummary;
}

export interface LoadSimulation {
  machines: MachineSimulation[];
  billets: BilletLoadSummary[];
  totalDemandKg: number;
  totalTheoreticalMinutes: number;
  totalBars: number;
  conflicts: SimulationConflict[];
  feasible: boolean;
}

const minute = 60_000;
const normalizedAlloy = (value: string) => value.trim().toUpperCase() || "SEM LIGA";

interface WorkWindow { start: Date; end: Date; }
interface ReservedInterval { start: Date; end: Date; quantity: number; orderId?: string | null; }

const timeParts = (value: string) => {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return { hours: hours || 0, minutes: minutes || 0 };
};

function workWindows(from: Date, shifts: WorkShiftInput[], machineCode: string, horizonDays = 14, unavailable: ResourceUnavailabilityInput[] = []) {
  const applicable = shifts.filter((shift) => shift.isActive && (!shift.machineCodes.length || shift.machineCodes.includes(machineCode)));
  const windows: WorkWindow[] = [];
  const firstDay = new Date(from.getFullYear(), from.getMonth(), from.getDate() - 1);
  for (let day = 0; day <= horizonDays + 1; day += 1) {
    const base = new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + day);
    for (const shift of applicable) {
      const startPart = timeParts(shift.startTime);
      const endPart = timeParts(shift.endTime);
      const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), startPart.hours, startPart.minutes);
      const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), endPart.hours, endPart.minutes);
      if (end <= start) end.setDate(end.getDate() + 1);
      end.setMinutes(end.getMinutes() - Math.max(shift.breakMinutes, 0));
      if (end > start) windows.push({ start, end });
    }
  }
  windows.sort((left, right) => left.start.getTime() - right.start.getTime());
  const merged = windows.reduce<WorkWindow[]>((result, window) => {
    const previous = result.at(-1);
    if (previous && window.start <= previous.end) {
      if (window.end > previous.end) previous.end = window.end;
    } else result.push({ start: new Date(window.start), end: new Date(window.end) });
    return result;
  }, []);
  const blocked = unavailable.filter((period) => period.status === "active" && period.resourceType === "press" && period.resourceCode === machineCode).sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());
  return blocked.reduce<WorkWindow[]>((available, period) => available.flatMap((window) => {
    if (period.endsAt <= window.start || period.startsAt >= window.end) return [window];
    const fragments: WorkWindow[] = [];
    if (period.startsAt > window.start) fragments.push({ start: window.start, end: new Date(Math.min(period.startsAt.getTime(), window.end.getTime())) });
    if (period.endsAt < window.end) fragments.push({ start: new Date(Math.max(period.endsAt.getTime(), window.start.getTime())), end: window.end });
    return fragments.filter((fragment) => fragment.end > fragment.start);
  }), merged);
}

export function nextWorkingInstant(at: Date, shifts: WorkShiftInput[], machineCode: string, unavailable: ResourceUnavailabilityInput[] = []) {
  const window = workWindows(at, shifts, machineCode, 14, unavailable).find((item) => at < item.end);
  if (!window) throw new Error(`Não há turno ativo disponível para a prensa ${machineCode}.`);
  return new Date(Math.max(at.getTime(), window.start.getTime()));
}

export function addWorkingMinutes(at: Date, minutesToAdd: number, shifts: WorkShiftInput[], machineCode: string, unavailable: ResourceUnavailabilityInput[] = []) {
  let cursor = nextWorkingInstant(at, shifts, machineCode, unavailable);
  let remaining = Math.max(minutesToAdd, 0);
  for (let guard = 0; remaining > 0 && guard < 1_000; guard += 1) {
    const window = workWindows(cursor, shifts, machineCode, 14, unavailable).find((item) => cursor >= item.start && cursor < item.end);
    if (!window) { cursor = nextWorkingInstant(cursor, shifts, machineCode, unavailable); continue; }
    const available = (window.end.getTime() - cursor.getTime()) / minute;
    if (remaining <= available) return new Date(cursor.getTime() + remaining * minute);
    remaining -= available;
    cursor = nextWorkingInstant(new Date(window.end.getTime() + 1), shifts, machineCode, unavailable);
  }
  if (remaining <= 0) return cursor;
  throw new Error(`Não foi possível calcular os turnos da prensa ${machineCode}.`);
}

function workingMinutesBetween(from: Date, to: Date, shifts: WorkShiftInput[], machineCode: string, unavailable: ResourceUnavailabilityInput[] = []) {
  if (to <= from) return 0;
  return workWindows(from, shifts, machineCode, 30, unavailable).reduce((total, window) => {
    const start = Math.max(from.getTime(), window.start.getTime());
    const end = Math.min(to.getTime(), window.end.getTime());
    return total + Math.max(end - start, 0) / minute;
  }, 0);
}

function overlappingPeriodEnd(from: Date, to: Date, periods: ReservedInterval[], capacity = 1) {
  const boundaries = periods
    .filter((period) => period.end > from && period.start < to)
    .flatMap((period) => [Math.max(period.start.getTime(), from.getTime()), Math.min(period.end.getTime(), to.getTime())]);
  const points = [...new Set([from.getTime(), ...boundaries])].sort((left, right) => left - right);
  for (const point of points) {
    if (point >= to.getTime()) continue;
    const occupied = periods.filter((period) => period.start.getTime() <= point && period.end.getTime() > point).reduce((sum, period) => sum + period.quantity, 0);
    if (occupied >= capacity) {
      const release = periods.filter((period) => period.start.getTime() <= point && period.end.getTime() > point).sort((left, right) => left.end.getTime() - right.end.getTime())[0]?.end;
      if (release) return release;
    }
  }
  return null;
}

function calendarBlockEnd(from: Date, to: Date, unavailable: ResourceUnavailabilityInput[], type: ResourceUnavailabilityInput["resourceType"], code: string) {
  return unavailable
    .filter((period) => period.status === "active" && period.resourceType === type && period.resourceCode.trim().toUpperCase() === code.trim().toUpperCase() && period.endsAt > from && period.startsAt < to)
    .sort((left, right) => left.endsAt.getTime() - right.endsAt.getTime())[0]?.endsAt ?? null;
}

function maximumConsecutiveShortRuns(items: ScheduledLoadItem[]) {
  let maximum = 0;
  let current = 0;
  for (const item of items) {
    current = item.remainingKg < 300 ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function peakHeatingOccupation(items: ScheduledLoadItem[]) {
  const uniqueWindows = new Map<string, { start: Date; end: Date }>();
  for (const item of items) {
    if (!item.toolHeatingStartAt || item.toolHeatingState === "released") continue;
    const key = `${item.toolCode.trim().toUpperCase()}-${item.toolHeatingStartAt.getTime()}-${item.calculatedToolReadyAt.getTime()}`;
    uniqueWindows.set(key, { start: item.toolHeatingStartAt, end: item.calculatedToolReadyAt });
  }
  const events = [...uniqueWindows.values()].flatMap((window) => [
    { time: window.start.getTime(), change: 1 },
    { time: window.end.getTime(), change: -1 },
  ]).sort((left, right) => left.time - right.time || left.change - right.change);
  let occupied = 0;
  let peak = 0;
  for (const event of events) {
    occupied += event.change;
    peak = Math.max(peak, occupied);
  }
  return peak;
}

function thermalCoverage(items: ScheduledLoadItem[], settings: MachineLoadSettings): ThermalCoverageSummary {
  const firstRiskIndex = items.findIndex((item) => item.thermalWaitMinutes > 0.5);
  const protectedItems = firstRiskIndex < 0 ? items : items.slice(0, firstRiskIndex);
  const theoreticalMinutes = items.reduce((sum, item) => sum + item.theoreticalMinutes, 0);
  const totalKg = items.reduce((sum, item) => sum + item.remainingKg, 0);
  const averageProductivity = theoreticalMinutes > 0 ? totalKg / (theoreticalMinutes / 60) : settings.defaultProductivityKgH;
  const shortRunCount = items.filter((item) => item.remainingKg < 300).length;
  const maxConsecutiveShortRuns = maximumConsecutiveShortRuns(items);
  const peakOvenSlotsUsed = peakHeatingOccupation(items);
  const riskItems = items.filter((item) => item.thermalWaitMinutes > 0.5);
  const firstRisk = riskItems[0] ?? null;
  const firstWaiting = items.find((item) => item.toolHeatingState === "waiting") ?? null;
  const predictedIdleMinutes = riskItems.reduce((sum, item) => sum + item.thermalWaitMinutes, 0);
  const attention = !riskItems.length && (
    maxConsecutiveShortRuns >= 3
    || peakOvenSlotsUsed >= Math.max(Math.ceil(settings.ovenSlots * 0.8), 1)
  );
  return {
    status: riskItems.length ? "risk" : attention ? "attention" : "protected",
    heatingHorizonMinutes: settings.toolHeatingMinutes,
    minimumMixKg: averageProductivity * (settings.toolHeatingMinutes / 60),
    protectedBufferKg: protectedItems.reduce((sum, item) => sum + item.remainingKg, 0),
    protectedProductionMinutes: protectedItems.reduce((sum, item) => sum + item.theoreticalMinutes + item.preparationMinutes, 0),
    shortRunCount,
    maxConsecutiveShortRuns,
    peakOvenSlotsUsed,
    ovenSlots: settings.ovenSlots,
    predictedIdleMinutes,
    riskItemCount: riskItems.length,
    firstRiskToolCode: firstRisk?.toolCode ?? null,
    firstRiskAt: firstRisk?.pressReadyAt ?? null,
    nextToolToHeat: firstWaiting?.toolCode ?? null,
    nextHeatingDeadlineAt: firstWaiting?.latestHeatingStartAt ?? null,
  };
}

function chooseAlloy(
  order: LoadOrderInput,
  balances: Map<string, number>,
  settings: MachineLoadSettings,
) {
  const candidates = [order.alloyCode, ...order.alternativeAlloys]
    .map(normalizedAlloy)
    .filter((value, index, values) => values.indexOf(value) === index);
  const required = Math.max(order.targetKg - order.producedKg, 0) / settings.extrusionEfficiency;
  return candidates.sort((left, right) => {
    const leftDeficit = Math.max(required - (balances.get(left) ?? 0), 0);
    const rightDeficit = Math.max(required - (balances.get(right) ?? 0), 0);
    const leftBars = Math.ceil(leftDeficit / settings.billetBarWeightKg);
    const rightBars = Math.ceil(rightDeficit / settings.billetBarWeightKg);
    return leftBars - rightBars || candidates.indexOf(left) - candidates.indexOf(right);
  })[0] ?? "SEM LIGA";
}

function optimizedQueue(orders: LoadOrderInput[]) {
  const remaining = [...orders].sort((a, b) => a.sequence - b.sequence);
  const result: LoadOrderInput[] = [];
  let lastAlloy = "";
  while (remaining.length) {
    const nextIndex = remaining.reduce((best, current, index) => {
      const currentReady = current.toolHeatingState === "released" ? 0 : current.toolHeatingState === "heating" ? 1 : 2;
      const bestReady = remaining[best].toolHeatingState === "released" ? 0 : remaining[best].toolHeatingState === "heating" ? 1 : 2;
      const currentSame = normalizedAlloy(current.alloyCode) === lastAlloy ? 0 : 1;
      const bestSame = normalizedAlloy(remaining[best].alloyCode) === lastAlloy ? 0 : 1;
      const currentDue = current.dueDate ? new Date(`${current.dueDate}T12:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
      const bestDue = remaining[best].dueDate ? new Date(`${remaining[best].dueDate}T12:00:00`).getTime() : Number.MAX_SAFE_INTEGER;
      const comparison = currentReady - bestReady || currentSame - bestSame || currentDue - bestDue || current.sequence - remaining[best].sequence;
      return comparison < 0 ? index : best;
    }, 0);
    const [next] = remaining.splice(nextIndex, 1);
    result.push(next);
    lastAlloy = normalizedAlloy(next.alloyCode);
  }
  return result;
}

export function simulateMachineLoad(
  orders: LoadOrderInput[],
  settingsByMachine: Record<string, MachineLoadSettings>,
  startedAt: Date,
  mode: "fifo" | "optimized" = "fifo",
  shifts: WorkShiftInput[] = [],
  unavailable: ResourceUnavailabilityInput[] = [],
  resources: SimulationResourcesInput = { carcasses: [], bos: [] },
): LoadSimulation {
  if (!shifts.some((shift) => shift.isActive)) throw new Error("Cadastre pelo menos um turno ativo para calcular a Carga Máquina.");
  const balances = new Map<string, number>();
  const billetTotals = new Map<string, BilletLoadSummary>();
  const machineGroups = new Map<string, LoadOrderInput[]>();
  for (const order of orders) {
    machineGroups.set(order.machineCode, [...(machineGroups.get(order.machineCode) ?? []), order]);
  }
  const machines: MachineSimulation[] = [];
  const conflicts: SimulationConflict[] = [];
  const toolReservations = new Map<string, ReservedInterval[]>();
  const carcassReservations = new Map<string, ReservedInterval[]>();
  const boReservations = new Map<string, ReservedInterval[]>();
  const boInventoryEnabled = resources.bos.length > 0;
  for (const carcass of resources.carcasses) {
    carcassReservations.set(normalizedAlloy(carcass.code), carcass.reservations.flatMap((reservation) => reservation.startsAt && reservation.endsAt ? [{ start: reservation.startsAt, end: reservation.endsAt, quantity: reservation.quantity, orderId: reservation.productionOrderId }] : []));
  }

  for (const [machineCode, machineOrders] of machineGroups) {
    const settings = settingsByMachine[machineCode] ?? Object.values(settingsByMachine)[0];
    const queue = mode === "optimized" ? optimizedQueue(machineOrders) : [...machineOrders].sort((a, b) => a.sequence - b.sequence);
    let pressAvailable = nextWorkingInstant(startedAt, shifts, machineCode, unavailable);
    let previousAlloy = "";
    const toolAvailability = new Map<string, Date>();
    const configuredOvenSlots = Math.max(settings.ovenCount || 1, 1) * Math.max(settings.ovenSlotsPerOven || settings.ovenSlots || 1, 1);
    const ovenSlots = Array.from({ length: Math.max(settings.ovenSlots || configuredOvenSlots, 1) }, () => new Date(startedAt));
    const toolHeatingAllocation = new Map<string, { start: Date; ready: Date; slot: number }>();
    const items: ScheduledLoadItem[] = [];

    // Ciclos já aquecendo ocupam fisicamente uma vaga e precisam ser considerados
    // antes de simular novas entradas no forno da mesma prensa.
    const activeHeatingTools = new Map<string, Date>();
    for (const order of queue) {
      if (order.toolHeatingState !== "heating" || !order.toolReadyAt) continue;
      const key = order.toolCode.trim().toUpperCase();
      const current = activeHeatingTools.get(key);
      if (!current || order.toolReadyAt > current) activeHeatingTools.set(key, order.toolReadyAt);
    }
    [...activeHeatingTools.entries()].sort((left, right) => left[1].getTime() - right[1].getTime()).forEach(([toolKey, ready], index) => {
      const slotIndex = index % ovenSlots.length;
      const heatingStart = new Date(ready.getTime() - settings.toolHeatingMinutes * minute);
      ovenSlots[slotIndex] = ready > ovenSlots[slotIndex] ? ready : ovenSlots[slotIndex];
      toolAvailability.set(toolKey, ready);
      toolHeatingAllocation.set(toolKey, { start: heatingStart, ready, slot: slotIndex + 1 });
    });

    for (const order of queue) {
      const remainingKg = Math.max(order.targetKg - order.producedKg, 0);
      if (remainingKg <= 0 || order.productivityKgH <= 0) continue;
      const toolKey = order.toolCode.trim().toUpperCase();
      let readyAt = toolAvailability.get(toolKey) ?? order.toolReadyAt;
      let allocation = toolHeatingAllocation.get(toolKey) ?? null;
      if (!readyAt) {
        const slotIndex = ovenSlots.reduce((best, value, index) => value < ovenSlots[best] ? index : best, 0);
        let heatingStartAt = new Date(Math.max(ovenSlots[slotIndex].getTime(), startedAt.getTime()));
        readyAt = new Date(heatingStartAt.getTime() + settings.toolHeatingMinutes * minute);
        const ovenNumber = Math.floor(slotIndex / Math.max(settings.ovenSlotsPerOven || settings.ovenSlots, 1)) + 1;
        const ovenCodes = [machineCode, `${machineCode}:${ovenNumber}`, `FORNO-${machineCode}-${ovenNumber}`];
        for (let guard = 0; guard < 20; guard += 1) {
          const block = unavailable.filter((period) => period.status === "active" && period.resourceType === "oven" && ovenCodes.includes(period.resourceCode.trim().toUpperCase()) && period.endsAt > heatingStartAt && period.startsAt < readyAt!).sort((left, right) => left.endsAt.getTime() - right.endsAt.getTime())[0];
          if (!block) break;
          heatingStartAt = new Date(block.endsAt.getTime() + 1);
          readyAt = new Date(heatingStartAt.getTime() + settings.toolHeatingMinutes * minute);
        }
        ovenSlots[slotIndex] = readyAt;
        allocation = { start: heatingStartAt, ready: readyAt, slot: slotIndex + 1 };
        toolHeatingAllocation.set(toolKey, allocation);
      }
      toolAvailability.set(toolKey, readyAt);
      const pressReadyAt = new Date(pressAvailable);
      let resourceReady = nextWorkingInstant(new Date(Math.max(pressReadyAt.getTime(), readyAt.getTime())), shifts, machineCode, unavailable);
      const latestHeatingStartAt = new Date(pressReadyAt.getTime() - settings.toolHeatingMinutes * minute);
      const selectedAlloy = chooseAlloy(order, balances, settings);
      const alloyChange = previousAlloy && previousAlloy !== selectedAlloy ? settings.alloyChangeMinutes : 0;
      const preparationMinutes = settings.setupMinutes + alloyChange;
      const theoreticalMinutes = (remainingKg / order.productivityKgH) * 60;
      const itemConflicts: SimulationConflict[] = [];
      const carcassKey = order.carcassCode ? normalizedAlloy(order.carcassCode) : "";
      const carcass = carcassKey ? resources.carcasses.find((item) => normalizedAlloy(item.code) === carcassKey) : null;
      const boKey = order.boCode ? normalizedAlloy(order.boCode) : "";
      const bo = boKey ? resources.bos.find((item) => normalizedAlloy(item.code) === boKey) : null;
      if (!carcassKey) {
        itemConflicts.push({ id: `missing-carcass-${order.id}`, type: "missing-carcass", severity: "blocking", resourceCode: "SEM CARCAÇA", machineCode, orderId: order.id, toolCode: order.toolCode, message: `Cadastre a carcaça exigida pela ferramenta ${order.toolCode}.`, delayMinutes: 0 });
      } else if (!carcass || carcass.capacity < Math.max(order.carcassQuantity ?? 1, 1)) {
        itemConflicts.push({ id: `carcass-capacity-${order.id}`, type: "carcass-capacity", severity: "blocking", resourceCode: carcassKey, machineCode, orderId: order.id, toolCode: order.toolCode, message: `A carcaça ${carcassKey} não possui unidade física disponível.`, delayMinutes: 0 });
      }
      if (!boKey) {
        itemConflicts.push({ id: `missing-bo-${order.id}`, type: "missing-bo", severity: "blocking", resourceCode: "SEM BO", machineCode, orderId: order.id, toolCode: order.toolCode, message: `Informe o BO exigido pela ferramenta ${order.toolCode}.`, delayMinutes: 0 });
      } else if (!boInventoryEnabled) {
        itemConflicts.push({ id: `bo-catalog-${order.id}`, type: "bo-capacity", severity: "warning", resourceCode: boKey, machineCode, orderId: order.id, toolCode: order.toolCode, message: `Cadastre o estoque físico de BOs para validar a disponibilidade do BO ${boKey}.`, delayMinutes: 0 });
      } else if (!bo || bo.capacity < 1) {
        itemConflicts.push({ id: `bo-capacity-${order.id}`, type: "bo-capacity", severity: "blocking", resourceCode: boKey, machineCode, orderId: order.id, toolCode: order.toolCode, message: `O BO ${boKey} não possui unidade física disponível.`, delayMinutes: 0 });
      }

      const resourceWaitStartedAt = new Date(resourceReady);
      let extrusionStartAt = addWorkingMinutes(resourceReady, preparationMinutes, shifts, machineCode, unavailable);
      let endAt = addWorkingMinutes(extrusionStartAt, theoreticalMinutes, shifts, machineCode, unavailable);
      for (let guard = 0; guard < 100; guard += 1) {
        const blockers: Array<{ end: Date; type: SimulationConflict["type"]; code: string; message: string }> = [];
        const toolKeyGlobal = normalizedAlloy(order.toolCode);
        const toolBlock = overlappingPeriodEnd(resourceReady, endAt, toolReservations.get(toolKeyGlobal) ?? [], 1);
        if (toolBlock) blockers.push({ end: toolBlock, type: "tool-conflict", code: toolKeyGlobal, message: `A ferramenta ${order.toolCode} ainda está reservada por outra prensa.` });
        const toolCalendar = calendarBlockEnd(resourceReady, endAt, unavailable, "tool", toolKeyGlobal);
        if (toolCalendar) blockers.push({ end: toolCalendar, type: "resource-calendar", code: toolKeyGlobal, message: `A ferramenta ${order.toolCode} está indisponível no calendário.` });
        if (carcass && carcass.capacity > 0) {
          const carcassBlock = overlappingPeriodEnd(resourceReady, endAt, carcassReservations.get(carcassKey) ?? [], Math.max(carcass.capacity - Math.max(order.carcassQuantity ?? 1, 1) + 1, 1));
          if (carcassBlock) blockers.push({ end: carcassBlock, type: "carcass-capacity", code: carcassKey, message: `Aguardando uma unidade livre da carcaça ${carcassKey}.` });
          const carcassCalendar = calendarBlockEnd(resourceReady, endAt, unavailable, "carcass", carcassKey);
          if (carcassCalendar) blockers.push({ end: carcassCalendar, type: "resource-calendar", code: carcassKey, message: `A carcaça ${carcassKey} está indisponível no calendário.` });
        }
        if (bo && bo.capacity > 0) {
          const boBlock = overlappingPeriodEnd(resourceReady, endAt, boReservations.get(boKey) ?? [], bo.capacity);
          if (boBlock) blockers.push({ end: boBlock, type: "bo-capacity", code: boKey, message: `Aguardando uma unidade livre do BO ${boKey}.` });
          const boCalendar = calendarBlockEnd(resourceReady, endAt, unavailable, "bo", boKey);
          if (boCalendar) blockers.push({ end: boCalendar, type: "resource-calendar", code: boKey, message: `O BO ${boKey} está indisponível no calendário.` });
        }
        if (!blockers.length) break;
        const blocker = blockers.sort((left, right) => left.end.getTime() - right.end.getTime())[0];
        const previousReady = resourceReady;
        resourceReady = nextWorkingInstant(new Date(blocker.end.getTime() + 1), shifts, machineCode, unavailable);
        const delay = workingMinutesBetween(previousReady, resourceReady, shifts, machineCode, unavailable);
        const existing = itemConflicts.find((item) => item.type === blocker.type && item.resourceCode === blocker.code && item.severity === "warning");
        if (existing) existing.delayMinutes += delay;
        else itemConflicts.push({ id: `${blocker.type}-${order.id}`, type: blocker.type, severity: "warning", resourceCode: blocker.code, machineCode, orderId: order.id, toolCode: order.toolCode, message: blocker.message, delayMinutes: delay });
        extrusionStartAt = addWorkingMinutes(resourceReady, preparationMinutes, shifts, machineCode, unavailable);
        endAt = addWorkingMinutes(extrusionStartAt, theoreticalMinutes, shifts, machineCode, unavailable);
      }
      const thermalReadyBase = nextWorkingInstant(new Date(Math.max(pressReadyAt.getTime(), readyAt.getTime())), shifts, machineCode, unavailable);
      const thermalWaitMinutes = workingMinutesBetween(pressReadyAt, thermalReadyBase, shifts, machineCode, unavailable);
      const resourceWaitMinutes = workingMinutesBetween(resourceWaitStartedAt, resourceReady, shifts, machineCode, unavailable);
      const billetRequiredKg = remainingKg / settings.extrusionEfficiency;
      const billetBalanceBeforeKg = balances.get(selectedAlloy) ?? 0;
      const deficit = Math.max(billetRequiredKg - billetBalanceBeforeKg, 0);
      const billetBarsLoaded = Math.ceil(deficit / settings.billetBarWeightKg);
      const loadedKg = billetBarsLoaded * settings.billetBarWeightKg;
      const billetBalanceAfterKg = billetBalanceBeforeKg + loadedKg - billetRequiredKg;
      balances.set(selectedAlloy, billetBalanceAfterKg);
      const total = billetTotals.get(selectedAlloy) ?? { alloyCode: selectedAlloy, demandKg: 0, rawRequiredKg: 0, bars: 0, loadedKg: 0, endingBalanceKg: 0 };
      total.demandKg += remainingKg;
      total.rawRequiredKg += billetRequiredKg;
      total.bars += billetBarsLoaded;
      total.loadedKg += loadedKg;
      total.endingBalanceKg = billetBalanceAfterKg;
      billetTotals.set(selectedAlloy, total);
      items.push({ ...order, remainingKg, selectedAlloy, startAt: resourceReady, extrusionStartAt, endAt, theoreticalMinutes, waitingMinutes: Math.max((resourceReady.getTime() - pressAvailable.getTime()) / minute, 0), preparationMinutes, billetRequiredKg, billetBarsLoaded, billetBalanceBeforeKg, billetBalanceAfterKg, pressReadyAt, toolHeatingStartAt: allocation?.start ?? null, calculatedToolReadyAt: readyAt, latestHeatingStartAt, ovenSlotNumber: allocation?.slot ?? null, thermalWaitMinutes, resourceWaitMinutes, resourceConflicts: itemConflicts });
      const interval = { start: resourceReady, end: endAt, quantity: 1, orderId: order.id };
      toolReservations.set(toolKey, [...(toolReservations.get(toolKey) ?? []), interval]);
      if (carcass && carcass.capacity > 0) carcassReservations.set(carcassKey, [...(carcassReservations.get(carcassKey) ?? []), { ...interval, quantity: Math.max(order.carcassQuantity ?? 1, 1) }]);
      if (bo && bo.capacity > 0) boReservations.set(boKey, [...(boReservations.get(boKey) ?? []), interval]);
      conflicts.push(...itemConflicts);
      pressAvailable = endAt;
      previousAlloy = selectedAlloy;
    }
    const theoreticalMinutes = items.reduce((sum, item) => sum + item.theoreticalMinutes, 0);
    const waitingMinutes = items.reduce((sum, item) => sum + item.waitingMinutes + item.preparationMinutes, 0);
    machines.push({ machineCode, items, startsAt: items[0]?.startAt ?? null, theoreticalMinutes, simulatedMinutes: items.length ? (items.at(-1)!.endAt.getTime() - startedAt.getTime()) / minute : 0, waitingMinutes, endsAt: items.at(-1)?.endAt ?? null, thermalCoverage: thermalCoverage(items, settings) });
  }

  return {
    machines: machines.sort((a, b) => a.machineCode.localeCompare(b.machineCode)),
    billets: [...billetTotals.values()].sort((a, b) => a.alloyCode.localeCompare(b.alloyCode)),
    totalDemandKg: orders.reduce((sum, order) => sum + Math.max(order.targetKg - order.producedKg, 0), 0),
    totalTheoreticalMinutes: machines.reduce((sum, machine) => sum + machine.theoreticalMinutes, 0),
    totalBars: [...billetTotals.values()].reduce((sum, alloy) => sum + alloy.bars, 0),
    conflicts,
    feasible: !conflicts.some((conflict) => conflict.severity === "blocking"),
  };
}
