import type { SimulationScenarioSummary, SimulationVersionSnapshot } from "./domain";

/**
 * Boundary for persistent simulations. Keeping this interface independent from
 * Supabase lets the calculation engine run locally/offline and be tested without I/O.
 */
export interface SimulationScenarioRepository {
  list(): Promise<SimulationScenarioSummary[]>;
  loadVersion(scenarioId: string, versionNumber?: number): Promise<SimulationVersionSnapshot | null>;
  saveVersion(snapshot: SimulationVersionSnapshot): Promise<SimulationVersionSnapshot>;
}
