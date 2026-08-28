import type { LoadSimulation, MachineLoadSettings, WorkShiftInput } from "../machine-load-simulator";

export const SIMULATION_MODEL_VERSION = "alupilot-v1.1" as const;

export type SimulationStatus = "draft" | "calculated" | "approved" | "archived";
export type SimulationMode = "fifo" | "optimized" | "manual";

export interface SimulationResourceSnapshot {
  pressCode: string;
  toolCode: string;
  toolSequence: number | null;
  ovenCode: string | null;
  ovenPosition: number | null;
  alloyCode: string;
  alternativeAlloys: string[];
  carcassCode: string | null;
  holes: number | null;
  boCode: string | null;
}

export interface SimulationOrderSnapshot extends SimulationResourceSnapshot {
  orderId: string;
  orderNumber: string;
  planCode: string;
  targetKg: number;
  producedKg: number;
  productivityKgH: number;
  sequence: number;
  dueDate: string | null;
}

export interface SimulationRulesSnapshot {
  modelVersion: typeof SIMULATION_MODEL_VERSION;
  settingsByMachine: Record<string, MachineLoadSettings>;
  shifts: WorkShiftInput[];
  notes: string[];
}

export interface SimulationVersionSnapshot {
  scenarioId: string;
  versionNumber: number;
  mode: SimulationMode;
  requestedStartAt: string;
  inputs: SimulationOrderSnapshot[];
  rules: SimulationRulesSnapshot;
  result: LoadSimulation;
}

export interface SimulationScenarioSummary {
  id: string;
  name: string;
  status: SimulationStatus;
  currentVersion: number;
  requestedStartAt: string;
  createdAt: string;
  updatedAt: string;
}
