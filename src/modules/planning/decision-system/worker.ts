/// <reference lib="webworker" />
import { buildScenarioComparison } from "./optimizer";
import { profileSchema } from "./schema";
self.onmessage = (event) => {
  try {
    const profile = profileSchema.parse(event.data.profile);
    const comparison = buildScenarioComparison(event.data.context, profile, undefined, (progress) => self.postMessage({ progress }));
    self.postMessage({ comparison, candidates: comparison.scenarios.map((scenario) => scenario.candidate) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Não foi possível calcular as alternativas." });
  }
};
