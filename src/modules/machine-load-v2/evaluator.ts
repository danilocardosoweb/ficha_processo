import type { ProgramRow } from "./domain";

export type AvailabilityState = "available" | "conflict" | "unknown";
export interface ResourceReservation { resource: string; startsAt: string; endsAt: string; quantity?: number; }
export interface ResourceCapacity { code: string; capacity: number | null; reservations?: ResourceReservation[]; }
export interface TemporalResourceSnapshot { carcaças: ResourceCapacity[]; bos: ResourceCapacity[]; fornos: ResourceCapacity[]; ferramentaReservations?: ResourceReservation[]; calendarBlocks?: ResourceReservation[]; }
export interface EvaluatedRow { id: string; order: string; press: string; startAt: string | null; endAt: string | null; availability: AvailabilityState; issues: string[]; durationMinutes: number | null; calendarWaitMinutes: number; lunchIntervention: boolean; }
export interface TemporalEvaluation { evaluatedAt: string; status: "viable" | "blocked" | "incomplete"; rows: EvaluatedRow[]; conflicts: number; unknowns: number; totalMinutes: number; calendarWaitMinutes: number; lunchInterventions: number; notes: string[]; }
type Interval = { startsAt: number; endsAt: number; quantity: number };
const key = (value: string | null | undefined) => (value ?? "").trim().toUpperCase();
const time = (value: string) => new Date(value).getTime();
const overlaps = (left: Interval, right: Interval) => left.startsAt < right.endsAt && right.startsAt < left.endsAt;
function capacityState(resource: string | null, at: Interval, capacities: ResourceCapacity[], fallback: Map<string, Interval[]>): { state: AvailabilityState; issue?: string } {
  if (!resource) return { state: "unknown", issue: "Recurso exigido não identificado" };
  const code = key(resource);
  const found = capacities.find(item => key(item.code) === code);
  if (!found || found.capacity === null) return { state: "unknown", issue: `Disponibilidade de ${resource} não confirmada` };
  const existing = [
    ...(found.reservations ?? []).filter(item => key(item.resource) === code).map(item => ({ startsAt: time(item.startsAt), endsAt: time(item.endsAt), quantity: item.quantity ?? 1 })),
    ...(fallback.get(code) ?? []),
  ];
  const used = existing.filter(item => overlaps(item, at)).reduce((sum, item) => sum + item.quantity, 0);
  return used + 1 > found.capacity ? { state: "conflict", issue: `${resource} sem unidade livre no intervalo previsto` } : { state: "available" };
}
function reserve(map: Map<string, Interval[]>, resource: string | null, interval: Interval) {
  if (!resource) return;
  const code = key(resource);
  map.set(code, [...(map.get(code) ?? []), interval]);
}

/** Avalia uma fila contra reservas temporais; não consulta banco e não cria reservas. */
export function evaluateTemporalResources(rows: ProgramRow[], startedAt: Date, resources: TemporalResourceSnapshot, settings?: { setupMinutes?: number; ovenCapacityPerPress?: number | null; heatingMinutes?: number }): TemporalEvaluation {
  const setup = Math.max(settings?.setupMinutes ?? 0, 0);
  const heating = Math.max(settings?.heatingMinutes ?? 0, 0);
  const ovenCapacity = settings?.ovenCapacityPerPress ?? null;
  const pressCursor = new Map<string, number>();
  const carcassUsed = new Map<string, Interval[]>();
  const boUsed = new Map<string, Interval[]>();
  const ovenUsed = new Map<string, Interval[]>();
  const toolUsed = new Map<string, Interval[]>();
  const evaluated: EvaluatedRow[] = [];
  const notes: string[] = [];
  let calendarWaitMinutes = 0;
  let lunchInterventions = 0;
  const lunchStart = 11 * 60 + 20;
  const lunchEnd = 14 * 60 + 20;
  const blocks = resources.calendarBlocks ?? [];
  const movePastCalendar = (press: string, initial: number, durationMinutes: number) => {
    let start = initial;
    let waited = 0;
    for (let guard = 0; guard < 50; guard += 1) {
      const end = start + durationMinutes * 60_000;
      const blocker = blocks.filter(block => (key(block.resource) === key(press) || key(block.resource) === "*") && time(block.startsAt) < end && time(block.endsAt) > start).sort((left, right) => time(left.endsAt) - time(right.endsAt))[0];
      if (!blocker) break;
      const next = time(blocker.endsAt);
      if (!Number.isFinite(next) || next <= start) break;
      waited += (next - start) / 60_000;
      start = next;
    }
    return { start, waited };
  };
  const intersectsLunch = (value: number, durationMinutes: number) => {
    const date = new Date(value);
    const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    return minutes < lunchEnd && minutes + durationMinutes > lunchStart;
  };
  for (const row of rows) {
    const issues = [...row.issues];
    let start = Math.max(pressCursor.get(row.press) ?? startedAt.getTime(), startedAt.getTime());
    const duration = row.productiveMinutes === null ? null : Math.max(row.productiveMinutes + setup, 0);
    if (duration === null) {
      evaluated.push({ id: row.id, order: row.order, press: row.press, startAt: null, endAt: null, availability: "unknown", issues: [...issues, "Horário não calculado: volume restante desconhecido"], durationMinutes: null, calendarWaitMinutes: 0, lunchIntervention: false });
      continue;
    }
    const calendar = movePastCalendar(row.press, start, duration);
    start = calendar.start;
    calendarWaitMinutes += calendar.waited;
    const lunchIntervention = intersectsLunch(start, duration);
    if (lunchIntervention) lunchInterventions += 1;
    const interval: Interval = { startsAt: start, endsAt: start + duration * 60_000, quantity: 1 };
    const conflicts: string[] = [];
    const unknowns: string[] = [];
    const carcass = capacityState(row.carcass, interval, resources.carcaças, carcassUsed);
    const bo = capacityState(row.bo, interval, resources.bos, boUsed);
    for (const result of [carcass, bo]) {
      if (result.state === "conflict" && result.issue) conflicts.push(result.issue);
      if (result.state === "unknown" && result.issue) unknowns.push(result.issue);
    }
    const toolCode = key(row.tool);
    const toolReservations = [
      ...(resources.ferramentaReservations ?? []).filter(item => key(item.resource) === toolCode).map(item => ({ startsAt: time(item.startsAt), endsAt: time(item.endsAt), quantity: item.quantity ?? 1 })),
      ...(toolUsed.get(toolCode) ?? []),
    ];
    if (toolReservations.some(existing => overlaps(existing, interval))) conflicts.push(`Ferramenta ${row.tool} sobreposta a outra utilização`);
    const ovenCode = `${row.press}:FORNO`;
    const ovenInterval = { ...interval, startsAt: Math.max(start - heating * 60_000, startedAt.getTime()) };
    const ovenResource = resources.fornos.find(item => key(item.code) === ovenCode);
    const knownOvenCapacity = ovenResource?.capacity ?? ovenCapacity;
    const existingOven = [
      ...(ovenResource?.reservations ?? []).map(item => ({ startsAt: time(item.startsAt), endsAt: time(item.endsAt), quantity: item.quantity ?? 1 })),
      ...(ovenUsed.get(ovenCode) ?? []),
    ];
    if (knownOvenCapacity === null || knownOvenCapacity === undefined) unknowns.push("Capacidade temporal do forno não confirmada");
    else if (existingOven.filter(existing => overlaps(existing, ovenInterval)).reduce((sum, existing) => sum + existing.quantity, 0) + 1 > knownOvenCapacity) conflicts.push(`Sem posição de forno disponível para ${row.tool}`);
    const availability: AvailabilityState = conflicts.length ? "conflict" : unknowns.length ? "unknown" : "available";
    const allIssues = [...issues, ...unknowns, ...conflicts];
    const end = interval.endsAt;
    evaluated.push({ id: row.id, order: row.order, press: row.press, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), availability, issues: [...new Set(allIssues)], durationMinutes: duration, calendarWaitMinutes: calendar.waited, lunchIntervention });
    pressCursor.set(row.press, end);
    reserve(carcassUsed, row.carcass, interval);
    reserve(boUsed, row.bo, interval);
    reserve(toolUsed, row.tool, interval);
    reserve(ovenUsed, ovenCode, ovenInterval);
  }
  const conflicts = evaluated.filter(row => row.availability === "conflict").length;
  const unknowns = evaluated.filter(row => row.availability === "unknown").length;
  if (!rows.length) notes.push("Nenhuma ordem foi enviada ao avaliador.");
  if (unknowns) notes.push("Dados desconhecidos não foram tratados como disponibilidade.");
  if (conflicts) notes.push("Conflitos físicos impedem classificar a proposta como viável.");
  if (calendarWaitMinutes) notes.push(String(Math.round(calendarWaitMinutes)) + " minuto(s) deslocado(s) por parada cadastrada.");
  if (lunchInterventions) notes.push(String(lunchInterventions) + " ordem(ns) atravessam a janela de almoço; tratado como preferência operacional.");
  return { evaluatedAt: new Date().toISOString(), status: conflicts ? "blocked" : unknowns ? "incomplete" : "viable", rows: evaluated, conflicts, unknowns, totalMinutes: Math.max(0, ...evaluated.map(row => row.endAt ? (time(row.endAt) - startedAt.getTime()) / 60_000 : 0)), calendarWaitMinutes, lunchInterventions, notes };
}
