/** Date-only promises expire at the end of the factory's local day. */
export function dueAt(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59` : value);
  return Number.isFinite(date.getTime()) ? date : null;
}
export function lateMinutes(value: string | null | undefined, end: Date): number {
  const due = dueAt(value);
  return due ? Math.max(0, (end.getTime() - due.getTime()) / 60000) : 0;
}
