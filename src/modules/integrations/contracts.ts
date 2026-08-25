import type { ProductionOrder } from "@/types/database";

/** Boundary reserved for a future PLC/industrial gateway adapter. */
export interface MachineTelemetryPort {
  getMachineState(machineCode: string): Promise<MachineState>;
  subscribe(machineCode: string, onEvent: (event: MachineEvent) => void): Promise<() => void>;
}

export interface MachineCommandPort {
  publishOrder(order: ProductionOrder): Promise<{ externalId: string }>;
}

export interface MachineState { machineCode: string; state: "offline"|"idle"|"running"|"stopped"; sampledAt: string; values: Record<string,number|string|boolean>; }
export interface MachineEvent { externalId: string; machineCode: string; type: string; occurredAt: string; payload: Record<string,unknown>; }
