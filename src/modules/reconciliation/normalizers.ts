export const NORMALIZATION_VERSION = "v1";

export function normalizeText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizePress(value: unknown): string | null {
  const text = normalizeText(value).replace(/\s+/g, "");
  if (!text) return null;
  const match = text.match(/(?:PRENSA|PRESS|P)?(\d+)(?:[.,](\d+))?$/);
  if (!match) return text.startsWith("P") ? text : `P${text}`;
  const whole = match[1];
  const decimal = match[2];
  if (decimal) return `P${whole}.${decimal}`;
  if (whole.length === 2 && whole.startsWith("1")) return `P${whole[0]}.${whole[1]}`;
  return `P${whole}`;
}

export function normalizeSequence(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  const text = normalizeText(value).replace(/[^0-9-]/g, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export type NormalizedTool = { base: string | null; sequence: number | null; key: string | null };

export function normalizeTool(value: unknown, sequence?: unknown): NormalizedTool {
  const raw = normalizeText(value);
  if (!raw) return { base: null, sequence: normalizeSequence(sequence), key: null };
  const parts = raw.match(/^(.*?)(?:\s*[/\\-]\s*(\d{1,4}))$/);
  const base = (parts?.[1] ?? raw).replace(/\s+/g, "").trim() || null;
  const parsedSequence = normalizeSequence(sequence ?? parts?.[2]);
  return {
    base,
    sequence: parsedSequence,
    key: base ? `${base}|${parsedSequence == null ? "" : parsedSequence}` : null,
  };
}

export function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim().replace(/\s/g, "");
  if (!text) return null;
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text.replace(/[^0-9+\-.]/g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  const br = text.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${year}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso.slice(1).join("-") : null;
}

export function normalizeTime(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const seconds = Math.round((value % 1) * 86_400) % 86_400;
    return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  const text = String(value ?? "").trim();
  const match = text.match(/(?:^|\s)(\d{1,2})[:h](\d{2})(?::(\d{2}))?/i);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? 0);
  return hour < 24 && minute < 60 && second < 60
    ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`
    : null;
}

export function combineDateTime(date: unknown, time: unknown): string | null {
  const normalizedDate = normalizeDate(date);
  if (!normalizedDate) return null;
  const normalizedTime = normalizeTime(time) ?? "00:00:00";
  return `${normalizedDate}T${normalizedTime}`;
}

