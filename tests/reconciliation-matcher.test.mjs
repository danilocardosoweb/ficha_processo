import test from "node:test";
import assert from "node:assert/strict";
import { decideMatch } from "../src/modules/reconciliation/matcher.ts";

test("matcher reconhece um vínculo exato por OP e campos físicos", () => {
  const result = decideMatch(
    { id: "erp-1", productionDate: "02/10/2026", startTime: "06:30", machineCode: "Prensa 1,9", toolCode: "TDS-152", toolSequence: 3, orderNumber: "OP-100", alloyCode: "6060" },
    [{ id: "app-1", startedAt: "2026-10-02T06:32:00", completedAt: "2026-10-02T08:00:00", machineCode: "P1.9", toolCode: "TDS152", toolSequence: 3, orderNumber: "OP100", alloyCode: "6060" }],
  );
  assert.equal(result.classification, "EXACT");
  assert.equal(result.selected?.executionId, "app-1");
  assert.equal(result.requiresReview, false);
});

test("matcher não escolhe automaticamente quando dois candidatos ficam próximos", () => {
  const result = decideMatch(
    { id: "erp-2", productionDate: "02/10/2026", machineCode: "1.9", toolCode: "TG-0072", toolSequence: 4 },
    [
      { id: "app-a", startedAt: "2026-10-02T06:20:00", machineCode: "P1.9", toolCode: "TG0072", toolSequence: 4 },
      { id: "app-b", startedAt: "2026-10-02T06:25:00", machineCode: "P1.9", toolCode: "TG0072", toolSequence: 4 },
    ],
  );
  assert.equal(result.classification, "AMBIGUOUS");
  assert.equal(result.selected, null);
  assert.equal(result.requiresReview, true);
});

test("matcher deixa sem vínculo uma ferramenta incompatível", () => {
  const result = decideMatch(
    { id: "erp-3", productionDate: "02/10/2026", machineCode: "1.9", toolCode: "OUTRA", toolSequence: 9 },
    [{ id: "app-c", startedAt: "2026-10-02T06:30:00", machineCode: "P1.9", toolCode: "TG0072", toolSequence: 4 }],
  );
  assert.equal(result.classification, "UNMATCHED");
  assert.equal(result.selected, null);
});

