interface ToolCandidate {
  code: string;
  matrix_code: string | null;
  sequence_number: number | null;
  source_available: boolean | null;
  carcass_code: string | null;
}

const normalizeCode = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

export function selectPhysicalTool<T extends ToolCandidate>(
  tools: T[], toolCode: string, requestedSequence: number | null,
): T | undefined {
  const code = normalizeCode(toolCode);
  const candidates = tools.filter(tool =>
    [tool.code, tool.matrix_code].some(value => value && normalizeCode(value) === code),
  );
  // A specific physical tool must never inherit another sequence's dimensions.
  if (requestedSequence !== null) {
    return candidates.find(tool => tool.sequence_number === requestedSequence);
  }
  const available = candidates.filter(tool => tool.source_available === true);
  const pool = available.length ? available : candidates;
  const configurations = new Set(pool.map(tool => tool.carcass_code?.toUpperCase() ?? ""));
  // With conflicting setups, require the physical sequence instead of guessing.
  if (configurations.size > 1) return undefined;
  return [...pool].sort((a, b) => (b.sequence_number ?? 0) - (a.sequence_number ?? 0))[0];
}
