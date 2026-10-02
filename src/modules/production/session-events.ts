export const productionSessionEventTypes = [
  "opened",
  "started",
  "paused",
  "resumed",
  "result_recorded",
  "correction_recorded",
  "completed",
  "cancelled",
  "note",
] as const;

export type ProductionSessionEventType = (typeof productionSessionEventTypes)[number];

export const productionSessionStatuses = [
  "open",
  "running",
  "paused",
  "completed",
  "cancelled",
  "corrected",
] as const;

export type ProductionSessionStatus = (typeof productionSessionStatuses)[number];

export type ProductionSessionEvent = {
  id: string;
  organization_id: string;
  session_id: string;
  event_type: ProductionSessionEventType;
  occurred_at: string;
  actor_user_id: string | null;
  actor_name: string;
  idempotency_key: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type ProductionSession = {
  id: string;
  organization_id: string;
  machine_code: string;
  tool_code: string;
  plan_code: string | null;
  status: ProductionSessionStatus;
  started_at: string | null;
  ended_at: string | null;
  created_by_user_id: string | null;
  created_by_name: string;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type ProductionSessionTimeline = {
  session: ProductionSession;
  orders: Array<Record<string, unknown>>;
  events: ProductionSessionEvent[];
};

