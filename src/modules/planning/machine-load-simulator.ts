import { guardProductivityKgH } from "@/modules/planning/productivity";
import { dueAt } from "@/modules/planning/decision-system/dates";

export type ProductivitySource = "simplificada" | "aprendizado" | "ficha" | "ferramenta" | "padrao";
export type FurnaceTimelineState = "released" | "heating" | "ready_waiting" | "planned";

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
  /** Reserva física vinda do ciclo real de forno, quando houver. */
  toolOvenCode?: string | null;
  toolOvenPosition?: number | null;
  toolHeatingEnteredAt?: Date | null;
  /** Physical extrusion holes. Tracked now; rule influence will be versioned later. */
  holes?: number | null;
  /** BO físico compartilhado entre as prensas. */
  boCode?: string | null;
  packageMeasureMm?: number | null;
  carcassDiameterMm?: number | null;
  carcassCode?: string | null;
  carcassQuantity?: number;
  /** Ciclo morto e espera de mão de obra, quando vierem do apontamento real. */
  deadCycleMinutes?: number | null;
  laborWaitMinutes?: number | null;
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

/** A janela de hora extra é pontual: ela não cria nem altera um turno recorrente. */
export interface OvertimePeriodInput {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  machineCodes: string[];
  reason: string;
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
  /** Quando conhecido, evita inferir parada planejada a partir do texto. */
  stopCategory?: "PLANNED_STOP" | "UNPLANNED_STOP";
}

export interface MachineLoadSettings {
  billetBarWeightKg: number;
  extrusionEfficiency: number;
  defaultProductivityKgH: number;
  setupMinutes: number;
  alloyChangeMinutes: number;
  /** Tempo morto entre duas ferramentas consecutivas. Não substitui o preparo físico. */
  toolChangeMinutes?: number;
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
  totalQuantity?: number;
  unavailableQuantity?: number;
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
  /** Preparação inicial aplicada uma vez antes da primeira ferramenta da prensa. */
  initialPreparationMinutes: number;
  /** Tempo adicional quando há mudança de liga entre duas ferramentas. */
  alloyChangeMinutes: number;
  /** Tempo morto aplicado entre duas ferramentas consecutivas. */
  toolChangeMinutes: number;
  billetRequiredKg: number;
  billetBarsLoaded: number;
  billetBalanceBeforeKg: number;
  billetBalanceAfterKg: number;
  pressReadyAt: Date;
  toolHeatingStartAt: Date | null;
  calculatedToolReadyAt: Date;
  latestHeatingStartAt: Date;
  ovenSlotNumber: number | null;
  ovenCode: string | null;
  ovenPosition: number | null;
  /** A vaga permanece ocupada até a retirada confirmada no início da extrusão. */
  toolOvenExitAt: Date | null;
  /** Tempo físico em que a ferramenta já pronta permanece aguardando na posição. */
  readyWaitingMinutes: number;
  furnaceState: FurnaceTimelineState;
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
  /** Calendário físico usado pela simulação, para auditoria de disponibilidade. */
  unavailable?: ResourceUnavailabilityInput[];
  shifts?: WorkShiftInput[];
  overtimePeriods?: OvertimePeriodInput[];
}

const minute = 60_000;
const normalizedAlloy = (value: string) => value.trim().toUpperCase() || "SEM LIGA";

interface WorkWindow { start: Date; end: Date; }
interface ReservedInterval { start: Date; end: Date; quantity: number; orderId?: string | null; }
interface OvenSlotState { slot: number; ovenNumber: number; position: number; code: string; availableAt: Date; }

const timeParts = (value: string) => {
  const [hours, minutes] = value.slice(0, 5).split(":").map(Number);
  return { hours: hours || 0, minutes: minutes || 0 };
};

function workWindows(from: Date, shifts: WorkShiftInput[], machineCode: string, horizonDays = 14, unavailable: ResourceUnavailabilityInput[] = [], overtimePeriods: OvertimePeriodInput[] = []) {
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
  for (const overtime of overtimePeriods) {
    if (!overtime.isActive || (overtime.machineCodes.length && !overtime.machineCodes.includes(machineCode))) continue;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(overtime.date);
    if (!match) continue;
    const base = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    if (base < firstDay || base > new Date(firstDay.getFullYear(), firstDay.getMonth(), firstDay.getDate() + horizonDays + 1)) continue;
    const startPart = timeParts(overtime.startTime);
    const endPart = timeParts(overtime.endTime);
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate(), startPart.hours, startPart.minutes);
    const end = new Date(base.getFullYear(), base.getMonth(), base.getDate(), endPart.hours, endPart.minutes);
    if (end <= start) end.setDate(end.getDate() + 1);
    windows.push({ start, end });
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

export function nextWorkingInstant(at: Date, shifts: WorkShiftInput[], machineCode: string, unavailable: ResourceUnavailabilityInput[] = [], overtimePeriods: OvertimePeriodInput[] = []) {
  const window = workWindows(at, shifts, machineCode, 14, unavailable, overtimePeriods).find((item) => at < item.end);
  if (!window) throw new Error(`Não há turno ativo disponível para a prensa ${machineCode}.`);
  return new Date(Math.max(at.getTime(), window.start.getTime()));
}

export function addWorkingMinutes(at: Date, minutesToAdd: number, shifts: WorkShiftInput[], machineCode: string, unavailable: ResourceUnavailabilityInput[] = [], overtimePeriods: OvertimePeriodInput[] = []) {
  let cursor = nextWorkingInstant(at, shifts, machineCode, unavailable, overtimePeriods);
  let remaining = Math.max(minutesToAdd, 0);
  for (let guard = 0; remaining > 0 && guard < 1_000; guard += 1) {
    const window = workWindows(cursor, shifts, machineCode, 14, unavailable, overtimePeriods).find((item) => cursor >= item.start && cursor < item.end);
    if (!window) { cursor = nextWorkingInstant(cursor, shifts, machineCode, unavailable, overtimePeriods); continue; }
    const available = (window.end.getTime() - cursor.getTime()) / minute;
    if (remaining <= available) return new Date(cursor.getTime() + remaining * minute);
    remaining -= available;
    cursor = nextWorkingInstant(new Date(window.end.getTime() + 1), shifts, machineCode, unavailable, overtimePeriods);
  }
  if (remaining <= 0) return cursor;
  throw new Error(`Não foi possível calcular os turnos da prensa ${machineCode}.`);
}

export function workingMinutesBetween(from: Date, to: Date, shifts: WorkShiftInput[], machineCode: string, unavailable: ResourceUnavailabilityInput[] = [], overtimePeriods: OvertimePeriodInput[] = []) {
  if (to <= from) return 0;
  return workWindows(from, shifts, machineCode, Math.ceil((to.getTime() - from.getTime()) / 86400000) + 1, unavailable, overtimePeriods).reduce((total, window) => {
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
    uniqueWindows.set(key, { start: item.toolHeatingStartAt, end: item.toolOvenExitAt ?? item.extrusionStartAt });
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
  const priority = new Map(candidates.map((candidate, index) => [candidate, index]));
  const required = Math.max(order.targetKg - order.producedKg, 0) / settings.extrusionEfficiency;
  return [...candidates].sort((left, right) => {
    const leftDeficit = Math.max(required - (balances.get(left) ?? 0), 0);
    const rightDeficit = Math.max(required - (balances.get(right) ?? 0), 0);
    const leftBars = Math.ceil(leftDeficit / settings.billetBarWeightKg);
    const rightBars = Math.ceil(rightDeficit / settings.billetBarWeightKg);
    return leftBars - rightBars || priority.get(left)! - priority.get(right)!;
  })[0] ?? "SEM LIGA";
}

function globalMaterialChoices(
  simulation: LoadSimulation,
  orders: LoadOrderInput[],
  settingsByMachine: Record<string, MachineLoadSettings>,
) {
  const ordersById = new Map(orders.map((order) => [order.id, order]));
  const balances = new Map<string, number>();
  const choices = new Map<string, string>();
  const chronologicalItems = simulation.machines
    .flatMap((machine) => machine.items)
    .sort(
      (left, right) =>
        left.extrusionStartAt.getTime() - right.extrusionStartAt.getTime() ||
        left.id.localeCompare(right.id),
    );

  for (const item of chronologicalItems) {
    const order = ordersById.get(item.id);
    const settings = settingsByMachine[item.machineCode] ?? Object.values(settingsByMachine)[0];
    if (!order || !settings) continue;
    const selectedAlloy = chooseAlloy(order, balances, settings);
    const before = balances.get(selectedAlloy) ?? 0;
    const bars = Math.ceil(
      Math.max(item.billetRequiredKg - before, 0) / settings.billetBarWeightKg,
    );
    const after = Math.max(
      before + bars * settings.billetBarWeightKg - item.billetRequiredKg,
      0,
    );
    choices.set(item.id, selectedAlloy);
    balances.set(selectedAlloy, after);
  }
  return choices;
}

function sameMaterialChoices(
  left: Map<string, string>,
  right: Map<string, string>,
) {
  if (left.size !== right.size) return false;
  for (const [id, alloy] of left) {
    if (right.get(id) !== alloy) return false;
  }
  return true;
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
      const currentDue = dueAt(current.dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bestDue = dueAt(remaining[best].dueDate)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const comparison = currentReady - bestReady || currentSame - bestSame || currentDue - bestDue || current.sequence - remaining[best].sequence;
      return comparison < 0 ? index : best;
    }, 0);
    const [next] = remaining.splice(nextIndex, 1);
    result.push(next);
    lastAlloy = normalizedAlloy(next.alloyCode);
  }
  return result;
}

function simulateMachineLoadPass(
  orders: LoadOrderInput[],
  settingsByMachine: Record<string, MachineLoadSettings>,
  startedAt: Date,
  mode: "fifo" | "optimized" = "fifo",
  shifts: WorkShiftInput[] = [],
  unavailable: ResourceUnavailabilityInput[] = [],
  resources: SimulationResourcesInput = { carcasses: [], bos: [] },
  overtimePeriods: OvertimePeriodInput[] = [],
  forcedAlloys: Map<string, string> | null = null,
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
    if (!settings || !Number.isFinite(settings.extrusionEfficiency) || settings.extrusionEfficiency <= 0 || settings.extrusionEfficiency > 1 ||
        !Number.isFinite(settings.billetBarWeightKg) || settings.billetBarWeightKg <= 0)
      throw new Error(`Revise eficiência e peso da barra da prensa ${machineCode} antes de simular.`);
    const queue = mode === "optimized" ? optimizedQueue(machineOrders) : [...machineOrders].sort((a, b) => a.sequence - b.sequence);
    let pressAvailable = nextWorkingInstant(startedAt, shifts, machineCode, unavailable, overtimePeriods);
    let previousAlloy = "";
    const toolAvailability = new Map<string, Date>();
    const positionsPerOven = Math.max(settings.ovenSlotsPerOven || settings.ovenSlots || 1, 1);
    const configuredOvenSlots = Math.max(settings.ovenCount || 1, 1) * positionsPerOven;
    const slotCount = Math.max(settings.ovenSlots || configuredOvenSlots, 1);
    // Cada vaga é um recurso físico reutilizável: forno + posição, e não um
    // contador da fila. A reserva termina somente quando a ferramenta sai
    // para iniciar a extrusão.
    const ovenSlots: OvenSlotState[] = Array.from({ length: slotCount }, (_, index) => {
      const ovenNumber = Math.floor(index / positionsPerOven) + 1;
      const position = index % positionsPerOven + 1;
      return { slot: index + 1, ovenNumber, position, code: `F${ovenNumber}`, availableAt: new Date(startedAt) };
    });
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
    if (activeHeatingTools.size > ovenSlots.length)
      throw new Error(`A prensa ${machineCode} tem mais ferramentas aquecendo do que vagas cadastradas. Confira os ciclos do forno.`);
    [...activeHeatingTools.entries()].sort((left, right) => left[1].getTime() - right[1].getTime()).forEach(([toolKey, ready], index) => {
      const linkedOrder = queue.find(order => order.toolCode.trim().toUpperCase() === toolKey);
      const requestedCode = linkedOrder?.toolOvenCode?.trim().toUpperCase() ?? "";
      const requestedPosition = linkedOrder?.toolOvenPosition ?? null;
      const slotIndex = ovenSlots.findIndex(slot => slot.code === requestedCode && slot.position === requestedPosition && slot.availableAt.getTime() <= startedAt.getTime());
      const resolvedIndex = slotIndex >= 0 ? slotIndex : index % ovenSlots.length;
      const slot = ovenSlots[resolvedIndex];
      const heatingStart = new Date(ready.getTime() - settings.toolHeatingMinutes * minute);
      slot.availableAt = ready > slot.availableAt ? ready : slot.availableAt;
      toolAvailability.set(toolKey, ready);
      toolHeatingAllocation.set(toolKey, { start: linkedOrder?.toolHeatingEnteredAt ?? heatingStart, ready, slot: slot.slot });
    });

    for (const order of queue) {
      const remainingKg = Math.max(order.targetKg - order.producedKg, 0);
      if (remainingKg <= 0) continue;
      const productivityKgH = guardProductivityKgH(order.productivityKgH, order.alloyCode);
      const toolKey = order.toolCode.trim().toUpperCase();
      let readyAt = toolAvailability.get(toolKey) ?? order.toolReadyAt;
      let allocation = toolHeatingAllocation.get(toolKey) ?? null;
      if (!readyAt) {
        const slotIndex = ovenSlots.reduce((best, value, index) => value.availableAt < ovenSlots[best].availableAt ? index : best, 0);
        const slot = ovenSlots[slotIndex];
        // Ferramenta simulada não deve entrar no forno assim que o cenário abre.
        // A entrada é planejada o mais perto possível da necessidade da prensa;
        // só antecipa quando a vaga do forno ou uma indisponibilidade exigirem.
        const neededAt = new Date(Math.max(pressAvailable.getTime() - settings.toolHeatingMinutes * minute, startedAt.getTime()));
        let heatingStartAt = new Date(Math.max(slot.availableAt.getTime(), neededAt.getTime()));
        readyAt = new Date(heatingStartAt.getTime() + settings.toolHeatingMinutes * minute);
        const ovenCodes = [machineCode, slot.code, `${machineCode}:${slot.ovenNumber}`, `FORNO-${machineCode}-${slot.ovenNumber}`];
        for (let guard = 0; guard < 20; guard += 1) {
          const block = unavailable.filter((period) => period.status === "active" && period.resourceType === "oven" && ovenCodes.includes(period.resourceCode.trim().toUpperCase()) && period.endsAt > heatingStartAt && period.startsAt < readyAt!).sort((left, right) => left.endsAt.getTime() - right.endsAt.getTime())[0];
          if (!block) break;
          heatingStartAt = new Date(block.endsAt.getTime() + 1);
          readyAt = new Date(heatingStartAt.getTime() + settings.toolHeatingMinutes * minute);
        }
        slot.availableAt = readyAt;
        allocation = { start: heatingStartAt, ready: readyAt, slot: slot.slot };
        toolHeatingAllocation.set(toolKey, allocation);
      }
      toolAvailability.set(toolKey, readyAt);
      const pressReadyAt = new Date(pressAvailable);
      let resourceReady = nextWorkingInstant(new Date(Math.max(pressReadyAt.getTime(), readyAt.getTime())), shifts, machineCode, unavailable, overtimePeriods);
      const latestHeatingStartAt = new Date(pressReadyAt.getTime() - settings.toolHeatingMinutes * minute);
      const selectedAlloy = forcedAlloys
        ? forcedAlloys.get(order.id) ?? normalizedAlloy(order.alloyCode)
        : chooseAlloy(order, balances, settings);
      const alloyChange = previousAlloy && previousAlloy !== selectedAlloy ? settings.alloyChangeMinutes : 0;
      // A preparação inicial ocorre uma única vez. Depois disso, cada mudança
      // de ferramenta usa o tempo morto configurado (padrão: 1 min), somado
      // apenas ao tempo de troca de liga quando ela realmente acontece.
      const initialPreparationMinutes = items.length === 0 ? Math.max(0, settings.setupMinutes) : 0;
      const toolChangeMinutes = items.length > 0 ? Math.max(0, settings.toolChangeMinutes ?? 1) : 0;
      const preparationMinutes = initialPreparationMinutes + toolChangeMinutes + alloyChange;
      const theoreticalMinutes = (remainingKg / productivityKgH) * 60;
      const itemConflicts: SimulationConflict[] = [];
      const carcassKey = order.carcassCode ? normalizedAlloy(order.carcassCode) : "";
      const carcass = carcassKey ? resources.carcasses.find((item) => normalizedAlloy(item.code) === carcassKey) : null;
      const boKey = order.boCode ? normalizedAlloy(order.boCode) : "";
      const bo = boKey ? resources.bos.find((item) => normalizedAlloy(item.code) === boKey) : null;
      if (!carcassKey) {
        itemConflicts.push({ id: `missing-carcass-${order.id}`, type: "missing-carcass", severity: "blocking", resourceCode: "SEM CARCAÇA", machineCode, orderId: order.id, toolCode: order.toolCode, message: `Cadastre a carcaça exigida pela ferramenta ${order.toolCode}.`, delayMinutes: 0 });
      } else if (!carcass || carcass.capacity < Math.max(order.carcassQuantity ?? 1, 1)) {
        const stockDetail = carcass
          ? ` Ela está cadastrada no estoque físico, com ${carcass.totalQuantity ?? 0} unidade(s) no total e ${carcass.unavailableQuantity ?? carcass.totalQuantity ?? 0} fora de uso; no momento há ${carcass.capacity} livre(s), mas são necessárias ${Math.max(order.carcassQuantity ?? 1, 1)}.`
          : " O modelo está configurado na ferramenta, mas ainda não foi cadastrado no estoque físico de carcaças.";
        itemConflicts.push({ id: `carcass-capacity-${order.id}`, type: "carcass-capacity", severity: "blocking", resourceCode: carcassKey, machineCode, orderId: order.id, toolCode: order.toolCode, message: `A ferramenta ${order.toolCode} exige a carcaça ${carcassKey}.${stockDetail}`, delayMinutes: 0 });
      }
      if (!boKey) {
        itemConflicts.push({ id: `missing-bo-${order.id}`, type: "missing-bo", severity: "blocking", resourceCode: "SEM BO", machineCode, orderId: order.id, toolCode: order.toolCode, message: `Informe o BO exigido pela ferramenta ${order.toolCode}.`, delayMinutes: 0 });
      } else if (!boInventoryEnabled) {
        itemConflicts.push({ id: `bo-catalog-${order.id}`, type: "bo-capacity", severity: "warning", resourceCode: boKey, machineCode, orderId: order.id, toolCode: order.toolCode, message: `Cadastre o estoque físico de BOs para validar a disponibilidade do BO ${boKey}.`, delayMinutes: 0 });
      } else if (!bo || bo.capacity < 1) {
        itemConflicts.push({ id: `bo-capacity-${order.id}`, type: "bo-capacity", severity: "blocking", resourceCode: boKey, machineCode, orderId: order.id, toolCode: order.toolCode, message: `O BO ${boKey} não possui unidade física disponível.`, delayMinutes: 0 });
      }

      const resourceWaitStartedAt = new Date(resourceReady);
      let extrusionStartAt = addWorkingMinutes(resourceReady, preparationMinutes, shifts, machineCode, unavailable, overtimePeriods);
      let endAt = addWorkingMinutes(extrusionStartAt, theoreticalMinutes, shifts, machineCode, unavailable, overtimePeriods);
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
        if (guard === 99) throw new Error("Há muitos conflitos de recursos para encontrar um horário seguro. Revise as reservas e calcule novamente.");
        const blocker = blockers.sort((left, right) => left.end.getTime() - right.end.getTime())[0];
        const previousReady = resourceReady;
        resourceReady = nextWorkingInstant(new Date(blocker.end.getTime() + 1), shifts, machineCode, unavailable, overtimePeriods);
        const delay = workingMinutesBetween(previousReady, resourceReady, shifts, machineCode, unavailable, overtimePeriods);
        const existing = itemConflicts.find((item) => item.type === blocker.type && item.resourceCode === blocker.code && item.severity === "warning");
        if (existing) existing.delayMinutes += delay;
        else itemConflicts.push({ id: `${blocker.type}-${order.id}`, type: blocker.type, severity: "warning", resourceCode: blocker.code, machineCode, orderId: order.id, toolCode: order.toolCode, message: blocker.message, delayMinutes: delay });
        extrusionStartAt = addWorkingMinutes(resourceReady, preparationMinutes, shifts, machineCode, unavailable, overtimePeriods);
        endAt = addWorkingMinutes(extrusionStartAt, theoreticalMinutes, shifts, machineCode, unavailable, overtimePeriods);
      }
      const thermalReadyBase = nextWorkingInstant(new Date(Math.max(pressReadyAt.getTime(), readyAt.getTime())), shifts, machineCode, unavailable, overtimePeriods);
      const thermalWaitMinutes = workingMinutesBetween(pressReadyAt, thermalReadyBase, shifts, machineCode, unavailable, overtimePeriods);
      const resourceWaitMinutes = workingMinutesBetween(resourceWaitStartedAt, resourceReady, shifts, machineCode, unavailable, overtimePeriods);
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
      const toolOvenExitAt = allocation ? new Date(extrusionStartAt) : null;
      const readyWaitingMinutes = toolOvenExitAt && readyAt < toolOvenExitAt ? (toolOvenExitAt.getTime() - readyAt.getTime()) / minute : 0;
      const allocatedSlot = allocation ? ovenSlots[allocation.slot - 1] : null;
      const furnaceState: FurnaceTimelineState = order.toolHeatingState === "released" ? "released"
        : !allocation || allocation.start > startedAt ? "planned"
          : readyAt > startedAt ? "heating" : "ready_waiting";
      items.push({ ...order, productivityKgH, remainingKg, selectedAlloy, startAt: resourceReady, extrusionStartAt, endAt, theoreticalMinutes, waitingMinutes: workingMinutesBetween(pressAvailable, resourceReady, shifts, machineCode, unavailable, overtimePeriods), preparationMinutes, initialPreparationMinutes, alloyChangeMinutes: alloyChange, toolChangeMinutes, billetRequiredKg, billetBarsLoaded, billetBalanceBeforeKg, billetBalanceAfterKg, pressReadyAt, toolHeatingStartAt: allocation?.start ?? null, calculatedToolReadyAt: readyAt, latestHeatingStartAt, ovenSlotNumber: allocation?.slot ?? null, ovenCode: allocatedSlot?.code ?? order.toolOvenCode ?? null, ovenPosition: allocatedSlot?.position ?? order.toolOvenPosition ?? null, toolOvenExitAt, readyWaitingMinutes, furnaceState, thermalWaitMinutes, resourceWaitMinutes, resourceConflicts: itemConflicts });
      // Regra operacional: a retirada é confirmada ao iniciar a produção.
      // Portanto, a posição continua indisponível durante a preparação.
      if (allocatedSlot) allocatedSlot.availableAt = new Date(Math.max(allocatedSlot.availableAt.getTime(), extrusionStartAt.getTime()));
      const interval = { start: resourceReady, end: endAt, quantity: 1, orderId: order.id };
      toolReservations.set(toolKey, [...(toolReservations.get(toolKey) ?? []), interval]);
      if (carcass && carcass.capacity > 0) carcassReservations.set(carcassKey, [...(carcassReservations.get(carcassKey) ?? []), { ...interval, quantity: Math.max(order.carcassQuantity ?? 1, 1) }]);
      if (bo && bo.capacity > 0) boReservations.set(boKey, [...(boReservations.get(boKey) ?? []), interval]);
      conflicts.push(...itemConflicts);
      pressAvailable = endAt;
      previousAlloy = selectedAlloy;
    }
    const theoreticalMinutes = items.reduce((sum, item) => sum + item.theoreticalMinutes, 0);
    // Espera é somente o tempo em que a prensa ficou aguardando forno,
    // carcaça, BO, calendário ou outro recurso. O preparo já tem indicador
    // próprio e não pode ser contado duas vezes.
    const waitingMinutes = items.reduce((sum, item) => sum + item.waitingMinutes, 0);
    machines.push({ machineCode, items, startsAt: items[0]?.startAt ?? null, theoreticalMinutes, simulatedMinutes: items.length ? (items.at(-1)!.endAt.getTime() - startedAt.getTime()) / minute : 0, waitingMinutes, endsAt: items.at(-1)?.endAt ?? null, thermalCoverage: thermalCoverage(items, settings) });
  }

  // Rebuild shared material balances in actual consumption order across presses.
  balances.clear();
  billetTotals.clear();
  const chronologicalItems = machines.flatMap(machine => machine.items)
    .sort((a, b) => a.extrusionStartAt.getTime() - b.extrusionStartAt.getTime() || a.id.localeCompare(b.id));
  for (const item of chronologicalItems) {
    const settings = settingsByMachine[item.machineCode] ?? Object.values(settingsByMachine)[0];
    const before = balances.get(item.selectedAlloy) ?? 0;
    const bars = Math.ceil(Math.max(item.billetRequiredKg - before, 0) / settings.billetBarWeightKg);
    const loaded = bars * settings.billetBarWeightKg;
    const after = Math.max(0, before + loaded - item.billetRequiredKg);
    Object.assign(item, { billetBalanceBeforeKg: before, billetBarsLoaded: bars, billetBalanceAfterKg: after });
    balances.set(item.selectedAlloy, after);
    const total = billetTotals.get(item.selectedAlloy) ?? { alloyCode: item.selectedAlloy, demandKg: 0, rawRequiredKg: 0, bars: 0, loadedKg: 0, endingBalanceKg: 0 };
    total.demandKg += item.remainingKg; total.rawRequiredKg += item.billetRequiredKg;
    total.bars += bars; total.loadedKg += loaded; total.endingBalanceKg = after;
    billetTotals.set(item.selectedAlloy, total);
  }
  return {
    machines: machines.sort((a, b) => a.machineCode.localeCompare(b.machineCode)),
    billets: [...billetTotals.values()].sort((a, b) => a.alloyCode.localeCompare(b.alloyCode)),
    totalDemandKg: orders.reduce((sum, order) => sum + Math.max(order.targetKg - order.producedKg, 0), 0),
    totalTheoreticalMinutes: machines.reduce((sum, machine) => sum + machine.theoreticalMinutes, 0),
    totalBars: [...billetTotals.values()].reduce((sum, alloy) => sum + alloy.bars, 0),
    conflicts,
    feasible: !conflicts.some((conflict) => conflict.severity === "blocking"),
    unavailable,
    shifts,
    overtimePeriods,
  };
}

export function simulateMachineLoad(
  orders: LoadOrderInput[],
  settingsByMachine: Record<string, MachineLoadSettings>,
  startedAt: Date,
  mode: "fifo" | "optimized" = "fifo",
  shifts: WorkShiftInput[] = [],
  unavailable: ResourceUnavailabilityInput[] = [],
  resources: SimulationResourcesInput = { carcasses: [], bos: [] },
  overtimePeriods: OvertimePeriodInput[] = [],
): LoadSimulation {
  // First pass uses the primary alloy only. Subsequent passes choose alternatives
  // from the actual cross-press consumption order, then recalculate the schedule
  // because an alloy change can alter preparation time and therefore chronology.
  let forcedAlloys = new Map<string, string>();
  let simulation = simulateMachineLoadPass(
    orders,
    settingsByMachine,
    startedAt,
    mode,
    shifts,
    unavailable,
    resources,
    overtimePeriods,
    forcedAlloys,
  );
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const nextChoices = globalMaterialChoices(simulation, orders, settingsByMachine);
    if (sameMaterialChoices(forcedAlloys, nextChoices)) return simulation;
    forcedAlloys = nextChoices;
    simulation = simulateMachineLoadPass(
      orders,
      settingsByMachine,
      startedAt,
      mode,
      shifts,
      unavailable,
      resources,
      overtimePeriods,
      forcedAlloys,
    );
  }
  return simulation;
}
