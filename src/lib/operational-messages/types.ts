export const messagePriorities = ["info", "attention", "urgent", "critical"] as const;
export const messageAudiences = ["all", "user", "role", "press"] as const;

export type MessagePriority = (typeof messagePriorities)[number];
export type MessageAudience = (typeof messageAudiences)[number];

export type OperationalMessage = {
  id: string;
  title: string;
  body: string;
  priority: MessagePriority;
  audience_type: MessageAudience;
  target_label: string;
  starts_at: string;
  expires_at: string | null;
  requires_ack: boolean;
  created_by_name: string;
  created_at: string;
  read_at: string | null;
  acknowledged_at: string | null;
  dismissed_at: string | null;
};

export type SentOperationalMessage = Pick<OperationalMessage, "id" | "title" | "body" | "priority" | "audience_type" | "target_label" | "expires_at" | "requires_ack" | "created_at"> & {
  is_active: boolean;
  read_count: number;
  acknowledged_count: number;
};

export type MessageTarget = {
  id: string;
  display_name: string;
  username: string;
  role: string;
  machine_codes: string[];
};

