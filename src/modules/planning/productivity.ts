export const DEFAULT_PRODUCTIVITY_KG_H = 1_300;
export const MAX_PRODUCTIVITY_KG_H = 2_500;

function parseProductivityToken(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").trim().replace(/\s*kg\s*\/\s*h\s*$/i, "");
  if (!raw) return null;
  const normalized = raw.includes(",")
    ? raw.replace(/\./g, "").replace(",", ".")
    : /^\d{1,3}(\.\d{3})+$/.test(raw)
      ? raw.replace(/\./g, "")
      : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Accepts a single value or historical values such as "1479/1290/". */
export function normalizeProductivityKgH(value: unknown): number | null {
  const tokens = typeof value === "string"
    ? value.replace(/\s*kgs?\s*\/\s*h\s*$/i, "").split(/[\/;|]+/).filter(Boolean)
    : [value];
  const valid = tokens
    .map(parseProductivityToken)
    .filter((item): item is number => item !== null && item > 0 && item <= MAX_PRODUCTIVITY_KG_H);
  if (!valid.length) return null;
  return Math.round((valid.reduce((sum, item) => sum + item, 0) / valid.length) * 10) / 10;
}

export function safeProductivityKgH(value: unknown): number {
  return normalizeProductivityKgH(value) ?? DEFAULT_PRODUCTIVITY_KG_H;
}
