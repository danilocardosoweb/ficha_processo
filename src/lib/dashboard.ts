import "server-only";

import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";
import type { LocalRole } from "@/lib/local-auth/types";

export type DashboardSnapshot = {
  available: boolean;
  generated_at: string;
  kpis: {
    production_today_kg: number;
    production_yesterday_kg: number;
    in_progress_orders: number;
    queued_orders: number;
    completed_today: number;
    open_stoppages: number;
  };
  hourly_production: { hour: string; produced_kg: number }[];
  machines: {
    code: string;
    name: string;
    status: "producing" | "stopped" | "available";
    order_number: string | null;
    tool_code: string | null;
    customer_name: string | null;
    progress: number;
    stoppage_reason: string | null;
    stoppage_started_at: string | null;
  }[];
  priority_orders: {
    order_number: string;
    plan_code: string | null;
    machine_code: string;
    tool_code: string;
    customer_name: string | null;
    target_kg: number | null;
    target_quantity: number | null;
    demand_unit: "kg" | "pieces" | "bars";
    produced_kg: number;
    produced_quantity: number;
    status: "planned" | "released" | "in_progress" | "paused";
    due_date: string | null;
    sequence: number;
  }[];
  online_users: {
    id: string;
    display_name: string;
    username: string;
    role: LocalRole;
    machine_codes: string[];
    last_seen_at: string;
  }[];
};

const emptySnapshot: DashboardSnapshot = {
  available: false,
  generated_at: new Date(0).toISOString(),
  kpis: {
    production_today_kg: 0,
    production_yesterday_kg: 0,
    in_progress_orders: 0,
    queued_orders: 0,
    completed_today: 0,
    open_stoppages: 0,
  },
  hourly_production: Array.from({ length: 24 }, (_, hour) => ({
    hour: `${String(hour).padStart(2, "0")}h`,
    produced_kg: 0,
  })),
  machines: [],
  priority_orders: [],
  online_users: [],
};

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  const token = await getSessionToken();
  if (!token) return emptySnapshot;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("local_dashboard_snapshot", {
      p_token: token,
    });
    if (error || !data || typeof data !== "object") return emptySnapshot;
    return { ...emptySnapshot, ...(data as Omit<DashboardSnapshot, "available">), available: true };
  } catch {
    return emptySnapshot;
  }
}
