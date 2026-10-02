import type { ProgramRow } from "@/modules/machine-load-v2/domain";

export type PlanningZone = "frozen" | "rolling" | "free";
export type ScenarioProfile = "baseline" | "delivery" | "efficiency" | "balance";

export interface V3Order {
  id: string;
  order: string;
  tool: string;
  currentPress: string;
  eligiblePresses: string[];
  officialPosition: number | null;
  remainingKg: number | null;
  productivityKgH: number;
  alloy: string | null;
  status: string;
  actualStartAt: string | null;
  zone: PlanningZone;
  issues: string[];
  boCode?: string | null;
  carcassCode?: string | null;
}

export interface V3Request {
  modelVersion: "alupilot-v3.0";
  requestedStartAt: string;
  horizonHours: number;
  orders: V3Order[];
  frozenOperations: string[];
  manualLocks: string[];
}

export interface V3Assignment {
  orderId: string;
  order: string;
  tool: string;
  press: string;
  position: number;
  zone: PlanningZone;
  startAt: string | null;
  endAt: string | null;
  locked: boolean;
  reasons: string[];
}

export interface V3Metrics {
  orders: number;
  scheduled: number;
  pending: number;
  frozen: number;
  presses: number;
  totalKg: number;
  dataIssues: number;
}

export interface V3Result {
  profile: ScenarioProfile;
  status: "baseline" | "pending-data";
  solverStatus: "not-started" | "baseline";
  assignments: V3Assignment[];
  unscheduledOrders: string[];
  dataIssues: string[];
  metrics: V3Metrics;
}

export function humanizePlanningIssue(issue: string): string {
  return issue
    .replace("Carcaça exigida não identificada", "Ainda não sabemos qual carcaça esta ordem precisa. Cadastre a carcaça para confirmar o estoque.")
    .replace("Configuração física da ferramenta a confirmar", "A ferramenta ainda precisa ser conferida no cadastro técnico.")
    .replace("Tipo sólida/tubular a confirmar", "Informe se a ferramenta é sólida ou tubular.")
    .replace("Baseline preserva a prensa cadastrada até a matriz de elegibilidade V3 ser validada", "Mantivemos a prensa atual para não mudar a programação oficial antes da conferência.");
}

const isFrozen = (row: ProgramRow) => Boolean(row.actualStart) || row.status === "in_progress" || row.status === "paused";

export function toV3Request(rows: ProgramRow[], requestedStartAt = new Date().toISOString(), horizonHours = 72): V3Request {
  const orders = rows.map(row => ({
    id: row.id,
    order: row.order,
    tool: row.tool,
    currentPress: row.press,
    // A matriz de elegibilidade ainda não está no contrato da fonte atual. Até ela existir,
    // a única prensa tecnicamente elegível é a já cadastrada, sem inventar compatibilidade.
    eligiblePresses: [row.press],
    officialPosition: row.position,
    remainingKg: row.remainingKg,
    productivityKgH: row.productivity,
    alloy: row.alloy,
    status: row.status,
    actualStartAt: row.actualStart,
    zone: isFrozen(row) ? "frozen" : "free",
    issues: [...row.issues],
    boCode: row.bo,
    carcassCode: row.carcass,
  } satisfies V3Order));
  const frozenOperations = orders.filter(order => order.zone === "frozen").map(order => order.id);
  return { modelVersion: "alupilot-v3.0", requestedStartAt, horizonHours, orders, frozenOperations, manualLocks: [] };
}

/** Baseline V3: reproduz a carteira atual sem fingir otimização global. */
export function generateV3Baseline(request: V3Request): V3Result {
  const dataIssues = request.orders.flatMap(order => order.issues.map(issue => `${order.order} · Ferramenta ${order.tool}: ${issue}`));
  const assignments: V3Assignment[] = [];
  const positions = new Map<string, number>();
  const grouped = [...request.orders].sort((left, right) => left.currentPress.localeCompare(right.currentPress, "pt-BR", { numeric: true }) || (left.officialPosition ?? Infinity) - (right.officialPosition ?? Infinity) || left.id.localeCompare(right.id));
  for (const order of grouped) {
    const position = (positions.get(order.currentPress) ?? 0) + 1;
    positions.set(order.currentPress, position);
    assignments.push({ orderId: order.id, order: order.order, tool: order.tool, press: order.currentPress, position, zone: order.zone, startAt: null, endAt: null, locked: order.zone === "frozen", reasons: order.zone === "frozen" ? ["Operação congelada pela execução atual"] : ["Baseline preserva a prensa cadastrada até a matriz de elegibilidade V3 ser validada"] });
  }
  const pending = request.orders.filter(order => order.issues.length > 0 || order.remainingKg === null).length;
  const totalKg = request.orders.reduce((sum, order) => sum + (order.remainingKg ?? 0), 0);
  return {
    profile: "baseline", status: dataIssues.length ? "pending-data" : "baseline", solverStatus: "baseline",
    assignments, unscheduledOrders: [], dataIssues, metrics: { orders: request.orders.length, scheduled: assignments.length, pending, frozen: request.frozenOperations.length, presses: new Set(assignments.map(item => item.press)).size, totalKg, dataIssues: dataIssues.length },
  };
}

export function validateV3Baseline(request: V3Request, result: V3Result): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const assignment of result.assignments) {
    if (seen.has(assignment.orderId)) errors.push(`OP duplicada no resultado: ${assignment.order}`);
    seen.add(assignment.orderId);
    const order = request.orders.find(item => item.id === assignment.orderId);
    if (!order) errors.push(`Resultado contém OP desconhecida: ${assignment.order}`);
    else if (!order.eligiblePresses.includes(assignment.press)) errors.push(`${assignment.order} foi atribuída a uma prensa inelegível`);
    else if (order.zone === "frozen" && (assignment.press !== order.currentPress || !assignment.locked)) errors.push(`${assignment.order} congelada foi alterada`);
  }
  return errors;
}
