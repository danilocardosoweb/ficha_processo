import "server-only";

import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import properLockfile from "proper-lockfile";
import { localDatabasePath } from "@/lib/local-db/database";
import type { LocalUser } from "@/lib/local-auth/types";

const queueDirectoryParts = [".tecnomes", "planning-queue"];
const arbitrationStaleMs = 120_000;
const arbitrationUpdateMs = 30_000;
export const planningQueueStaleHeartbeatMs = 5 * 60_000;

type QueueRequestStatus = "waiting" | "active" | "released" | "cancelled" | "recovered";

type QueueRequest = {
  id: string;
  ticket: number;
  username: string;
  displayName: string;
  machineId: string;
  machineName: string;
  requestedAt: string;
  status: QueueRequestStatus;
};

type ActiveReservation = {
  requestId: string;
  token: string;
  fence: number;
  acquiredAt: string;
  lastHeartbeatAt: string;
};

type QueueEvent = {
  id: string;
  occurredAt: string;
  action: "requested" | "claimed" | "released" | "cancelled" | "recovered";
  username: string;
  displayName: string;
  machineName: string;
  requestId: string;
  details?: Record<string, unknown>;
};

type SharedQueueState = {
  schemaVersion: 1;
  nextTicket: number;
  nextFence: number;
  requests: QueueRequest[];
  active: ActiveReservation | null;
  events: QueueEvent[];
};

export type PlanningQueueActor = Pick<LocalUser, "username" | "display_name" | "role">;

export class PlanningQueueError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "PlanningQueueError";
  }
}

function now() {
  return new Date().toISOString();
}

function sharedRoot() {
  const configured = process.env.TECNOMES_SHARED_APP_ROOT?.trim();
  const root = configured || "W:\\App_Prensa";
  if (!isAbsolute(root)) throw new PlanningQueueError("O caminho compartilhado precisa ser absoluto.", 503);
  return root;
}

function statePath() {
  return join(sharedRoot(), ...queueDirectoryParts, "state.json");
}

function localDeviceIdentityPath() {
  return join(dirname(localDatabasePath()), "station-id");
}

async function getStationIdentity() {
  const file = localDeviceIdentityPath();
  await mkdir(dirname(file), { recursive: true });
  try {
    const id = (await readFile(file, "utf8")).trim();
    if (id) return id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const id = randomUUID();
  try {
    await writeFile(file, id, { encoding: "utf8", flag: "wx" });
    return id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return (await readFile(file, "utf8")).trim();
  }
}

function emptyState(): SharedQueueState {
  return { schemaVersion: 1, nextTicket: 1, nextFence: 1, requests: [], active: null, events: [] };
}

function validateState(value: unknown): SharedQueueState {
  if (!value || typeof value !== "object") throw new PlanningQueueError("O arquivo da fila está inválido. Não alterei o estado; peça ao administrador para verificar o compartilhamento.", 503);
  const state = value as Partial<SharedQueueState>;
  const validRequest = (request: unknown): request is QueueRequest => {
    if (!request || typeof request !== "object") return false;
    const row = request as Partial<QueueRequest>;
    return typeof row.id === "string" && Number.isInteger(row.ticket) && typeof row.username === "string" && typeof row.displayName === "string" && typeof row.machineId === "string" && typeof row.machineName === "string" && typeof row.requestedAt === "string" && ["waiting", "active", "released", "cancelled", "recovered"].includes(String(row.status));
  };
  const validActive = (active: unknown) => {
    if (active === null) return true;
    if (typeof active !== "object") return false;
    const lease = active as Partial<ActiveReservation>;
    return typeof lease.requestId === "string" && typeof lease.token === "string" && Number.isInteger(lease.fence) && typeof lease.acquiredAt === "string" && typeof lease.lastHeartbeatAt === "string";
  };
  if (state.schemaVersion !== 1 || !Number.isInteger(state.nextTicket) || !Number.isInteger(state.nextFence) || !Array.isArray(state.requests) || !state.requests.every(validRequest) || !Array.isArray(state.events) || !(validActive(state.active))) {
    throw new PlanningQueueError("O arquivo da fila está incompleto ou em formato desconhecido. Não alterei o estado; peça ao administrador para verificar o compartilhamento.", 503);
  }
  return state as SharedQueueState;
}

async function ensureStateFile(file: string) {
  const root = sharedRoot();
  try {
    const rootInfo = await stat(/* turbopackIgnore: true */ root);
    if (!rootInfo.isDirectory()) throw new PlanningQueueError("O caminho compartilhado não é uma pasta.", 503);
  } catch (error) {
    if (error instanceof PlanningQueueError) throw error;
    throw new PlanningQueueError(`A pasta compartilhada ${root} não está disponível. A fila foi bloqueada por segurança; confirme a rede e tente novamente.`, 503);
  }

  await mkdir(dirname(file), { recursive: true });
  try {
    await writeFile(file, JSON.stringify(emptyState()), { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

async function readState(file: string) {
  try {
    return validateState(JSON.parse(await readFile(file, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new PlanningQueueError("A fila compartilhada mudou durante a leitura. Atualize a tela e tente novamente.", 503);
    if (error instanceof PlanningQueueError) throw error;
    throw new PlanningQueueError("Não foi possível ler a fila compartilhada. Nenhuma alteração foi feita.", 503);
  }
}

async function writeState(file: string, state: SharedQueueState) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(state, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temporary, file);
  } catch (error) {
    try { await import("node:fs/promises").then(({ unlink }) => unlink(temporary)); } catch { /* arquivo temporário ausente */ }
    throw error;
  }
}

async function withStateLock<T>(operation: (state: SharedQueueState) => Promise<{ result: T; changed: boolean }> | { result: T; changed: boolean }): Promise<T> {
  const file = statePath();
  await ensureStateFile(file);
  let compromised = false;
  let release: (() => Promise<void>) | undefined;
  try {
    release = await properLockfile.lock(file, {
      realpath: false,
      stale: arbitrationStaleMs,
      update: arbitrationUpdateMs,
      retries: { retries: 4, minTimeout: 100, maxTimeout: 400 },
      onCompromised: () => { compromised = true; },
    });
    const state = await readState(file);
    const outcome = await operation(state);
    if (compromised) throw new PlanningQueueError("A conexão com a pasta compartilhada oscilou. Atualize a tela antes de continuar.", 503);
    if (outcome.changed) await writeState(file, state);
    return outcome.result;
  } catch (error) {
    if (error instanceof PlanningQueueError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") throw new PlanningQueueError("A fila está sendo atualizada em outro computador. Aguarde alguns segundos e atualize.", 409);
    throw new PlanningQueueError("Não foi possível coordenar a fila pela pasta compartilhada. A operação não foi confirmada; atualize antes de tentar novamente.", 503);
  } finally {
    if (release && !compromised) {
      try { await release(); } catch { /* proper-lockfile sinaliza a perda; a próxima leitura reconcilia o estado */ }
    }
  }
}

function addEvent(state: SharedQueueState, actor: PlanningQueueActor, machineName: string, action: QueueEvent["action"], requestId: string, details?: Record<string, unknown>) {
  state.events.push({ id: randomUUID(), occurredAt: now(), action, username: actor.username, displayName: actor.display_name, machineName, requestId, ...(details ? { details } : {}) });
}

function currentRequest(state: SharedQueueState, username: string, machineId: string) {
  return state.requests.find((request) => request.username.toLowerCase() === username.toLowerCase() && request.machineId === machineId && (request.status === "waiting" || request.status === "active")) ?? null;
}

function orderedWaiting(state: SharedQueueState) {
  return state.requests.filter((request) => request.status === "waiting").sort((a, b) => a.ticket - b.ticket);
}

export async function getPlanningQueueStatus(actor: PlanningQueueActor) {
  const machineId = await getStationIdentity();
  const machineName = hostname();
  return withStateLock(async (state) => {
    return {
      result: buildPlanningQueueStatus(state, actor, machineId, machineName),
      changed: false,
    };
  });
}

function buildPlanningQueueStatus(state: SharedQueueState, actor: PlanningQueueActor, machineId: string, machineName: string) {
  const mine = currentRequest(state, actor.username, machineId);
  const activeRequest = state.active ? state.requests.find((request) => request.id === state.active?.requestId) ?? null : null;
  const heartbeatAgeMs = state.active ? Math.max(0, Date.now() - new Date(state.active.lastHeartbeatAt).getTime()) : null;
  const waiting = orderedWaiting(state);
  const position = mine?.status === "waiting" ? waiting.findIndex((request) => request.id === mine.id) + 1 : null;
  const mineToken = state.active && mine && state.active.requestId === mine.id ? state.active.token : undefined;
  return {
    available: true,
    sharedRoot: sharedRoot(),
    machineName,
    active: activeRequest ? {
      requestId: activeRequest.id,
      displayName: activeRequest.displayName,
      machineName: activeRequest.machineName,
      acquiredAt: state.active?.acquiredAt ?? null,
      lastHeartbeatAt: state.active?.lastHeartbeatAt ?? null,
      heartbeatAgeMs,
      mine: activeRequest.id === mine?.id,
    } : null,
    waiting: waiting.map((request) => ({ id: request.id, ticket: request.ticket, displayName: request.displayName, machineName: request.machineName, requestedAt: request.requestedAt, mine: request.id === mine?.id })),
    mine: mine ? { requestId: mine.id, status: mine.status, ticket: mine.ticket, position, token: mineToken } : null,
    recoverable: Boolean(state.active && heartbeatAgeMs !== null && heartbeatAgeMs >= planningQueueStaleHeartbeatMs),
  };
}

export async function requestPlanningTurn(actor: PlanningQueueActor) {
  const machineId = await getStationIdentity();
  const machineName = hostname();
  return withStateLock((state) => {
    const existing = currentRequest(state, actor.username, machineId);
    if (existing) return { result: { requestId: existing.id, ticket: existing.ticket, status: existing.status }, changed: false };
    const request: QueueRequest = { id: randomUUID(), ticket: state.nextTicket++, username: actor.username, displayName: actor.display_name, machineId, machineName, requestedAt: now(), status: "waiting" };
    state.requests.push(request);
    addEvent(state, actor, machineName, "requested", request.id, { ticket: request.ticket });
    // O histórico compartilhado é append-only para permitir auditoria entre estações.
    return { result: { requestId: request.id, ticket: request.ticket, status: request.status }, changed: true };
  });
}

/**
 * Automatically enrolls the current station and starts its turn when it reaches
 * the head of the queue. Calling it repeatedly is safe, which lets an open queue
 * screen advance without a manual "enter" or "start" action.
 */
export async function ensureAutomaticPlanningTurn(actor: PlanningQueueActor) {
  const machineId = await getStationIdentity();
  const machineName = hostname();
  return withStateLock((state) => {
    let request = currentRequest(state, actor.username, machineId);
    let changed = false;
    if (!request) {
      request = { id: randomUUID(), ticket: state.nextTicket++, username: actor.username, displayName: actor.display_name, machineId, machineName, requestedAt: now(), status: "waiting" };
      state.requests.push(request);
      addEvent(state, actor, machineName, "requested", request.id, { ticket: request.ticket, automatic: true });
      changed = true;
    }

    if (!state.active && request.status === "waiting" && orderedWaiting(state)[0]?.id === request.id) {
      const token = randomUUID();
      state.active = { requestId: request.id, token, fence: state.nextFence++, acquiredAt: now(), lastHeartbeatAt: now() };
      request.status = "active";
      addEvent(state, actor, machineName, "claimed", request.id, { fence: state.active.fence, automatic: true });
      changed = true;
    }

    return { result: buildPlanningQueueStatus(state, actor, machineId, machineName), changed };
  });
}

/** Ends the automatic queue session when the user leaves the editing screen. */
export async function endAutomaticPlanningTurn(actor: PlanningQueueActor, requestId: string, token?: string) {
  const machineId = await getStationIdentity();
  const machineName = hostname();
  return withStateLock((state) => {
    const request = currentRequest(state, actor.username, machineId);
    if (!request || request.id !== requestId) return { result: { ended: false }, changed: false };

    if (request.status === "active") {
      if (!state.active || state.active.requestId !== request.id || !token || state.active.token !== token) {
        throw new PlanningQueueError("A vez não foi liberada porque a reserva mudou. Atualize a fila antes de continuar.", 409);
      }
      state.active = null;
      request.status = "released";
      addEvent(state, actor, machineName, "released", request.id, { automatic: true, reason: "left_queue_screen" });
    } else {
      request.status = "cancelled";
      addEvent(state, actor, machineName, "cancelled", request.id, { automatic: true, reason: "left_queue_screen" });
    }
    return { result: { ended: true }, changed: true };
  });
}

export async function claimPlanningTurn(actor: PlanningQueueActor) {
  const machineId = await getStationIdentity();
  const machineName = hostname();
  return withStateLock((state) => {
    const request = currentRequest(state, actor.username, machineId);
    if (!request) throw new PlanningQueueError("Entre na fila antes de iniciar sua vez.", 409);
    if (state.active) {
      if (state.active.requestId === request.id) return { result: { token: state.active.token, fence: state.active.fence }, changed: false };
      throw new PlanningQueueError("Outra pessoa ainda está com a vez de edição.", 409);
    }
    if (request.status !== "waiting" || orderedWaiting(state)[0]?.id !== request.id) {
      const position = orderedWaiting(state).findIndex((item) => item.id === request.id) + 1;
      throw new PlanningQueueError(position > 0 ? `Sua vez ainda não chegou. Você está na posição ${position}.` : "Sua solicitação não está mais ativa na fila.", 409);
    }
    const token = randomUUID();
    state.active = { requestId: request.id, token, fence: state.nextFence++, acquiredAt: now(), lastHeartbeatAt: now() };
    request.status = "active";
    addEvent(state, actor, machineName, "claimed", request.id, { fence: state.active.fence });
    return { result: { token, fence: state.active.fence }, changed: true };
  });
}

export async function heartbeatPlanningTurn(actor: PlanningQueueActor, requestId: string, token: string) {
  const machineId = await getStationIdentity();
  return withStateLock((state) => {
    const request = state.requests.find((item) => item.id === requestId);
    if (!state.active || state.active.requestId !== requestId || state.active.token !== token || !request || request.machineId !== machineId || request.username.toLowerCase() !== actor.username.toLowerCase()) {
      throw new PlanningQueueError("Esta reserva não pertence mais a este computador. Atualize a fila antes de continuar.", 409);
    }
    state.active.lastHeartbeatAt = now();
    return { result: { lastHeartbeatAt: state.active.lastHeartbeatAt }, changed: true };
  });
}

export async function releasePlanningTurn(actor: PlanningQueueActor, requestId: string, token: string) {
  const machineId = await getStationIdentity();
  const machineName = hostname();
  return withStateLock((state) => {
    const request = state.requests.find((item) => item.id === requestId);
    if (!state.active || state.active.requestId !== requestId || state.active.token !== token || !request || request.machineId !== machineId || request.username.toLowerCase() !== actor.username.toLowerCase()) {
      throw new PlanningQueueError("A reserva já foi encerrada ou pertence a outro computador.", 409);
    }
    state.active = null;
    request.status = "released";
    addEvent(state, actor, machineName, "released", requestId);
    return { result: { released: true }, changed: true };
  });
}

export async function cancelPlanningTurn(actor: PlanningQueueActor, requestId: string) {
  const machineId = await getStationIdentity();
  const machineName = hostname();
  return withStateLock((state) => {
    const request = state.requests.find((item) => item.id === requestId);
    if (!request || request.status !== "waiting" || request.machineId !== machineId || request.username.toLowerCase() !== actor.username.toLowerCase()) {
      throw new PlanningQueueError("Só é possível sair de uma solicitação sua que ainda esteja aguardando.", 409);
    }
    request.status = "cancelled";
    addEvent(state, actor, machineName, "cancelled", requestId);
    return { result: { cancelled: true }, changed: true };
  });
}

export async function recoverStalePlanningTurn(actor: PlanningQueueActor, reason: string) {
  const machineName = hostname();
  return withStateLock((state) => {
    const active = state.active;
    if (!active) throw new PlanningQueueError("Não há reserva ativa para recuperar.", 409);
    const age = Date.now() - new Date(active.lastHeartbeatAt).getTime();
    if (!Number.isFinite(age) || age < planningQueueStaleHeartbeatMs) throw new PlanningQueueError("A reserva ainda está enviando sinais recentes. Confirme com a pessoa responsável antes de tentar novamente.", 409);
    const request = state.requests.find((item) => item.id === active.requestId);
    if (request) request.status = "recovered";
    state.active = null;
    addEvent(state, actor, machineName, "recovered", active.requestId, { reason: reason.trim(), previousMachine: request?.machineName ?? "desconhecido", previousOwner: request?.displayName ?? "desconhecido", fence: active.fence });
    return { result: { recovered: true }, changed: true };
  });
}

/**
 * Future shared-program publication endpoints must wrap their write in this function.
 * The shared arbiter remains held while the callback writes, so recovery/release cannot
 * interleave with a publication. Never use this as a point-in-time check only.
 */
export async function withPlanningTurn<T>(actor: PlanningQueueActor, token: string, operation: (fence: number) => Promise<T>) {
  const machineId = await getStationIdentity();
  return withStateLock(async (state) => {
    const active = state.active;
    const request = active ? state.requests.find((item) => item.id === active.requestId) : null;
    if (!active || !request || active.token !== token || request.machineId !== machineId || request.username.toLowerCase() !== actor.username.toLowerCase()) {
      throw new PlanningQueueError("A publicação foi bloqueada: esta estação não tem mais a vez da programação.", 409);
    }
    return { result: await operation(active.fence), changed: false };
  });
}
