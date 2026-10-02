import type { SupabaseClient } from "@supabase/supabase-js";

type RealtimePayload = {
  eventType: string;
  table: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

type OvenRealtimeOptions = {
  organizationId: string;
  machineCodes?: string[];
  onChange: (payload: RealtimePayload) => void;
  onStatus?: (status: string) => void;
};

/**
 * Subscribes to the small set of database changes that can alter the oven
 * board. The board still performs an initial snapshot and a slow fallback
 * refresh; Realtime is the normal path for subsequent changes.
 */
export function subscribeToOvenBoard(
  client: SupabaseClient,
  { organizationId, machineCodes, onChange, onStatus }: OvenRealtimeOptions,
) {
  const channel = client.channel(`oven-board:${organizationId}:${Math.random().toString(36).slice(2)}`);
  const machineFilter = machineCodes?.length ? `machine_code=in.(${machineCodes.join(",")})` : undefined;
  const listen = (table: string, filter?: string) => {
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table, ...(filter ? { filter } : {}) },
      (payload) => onChange(payload as RealtimePayload),
    );
  };

  listen("production_orders", machineFilter ?? `organization_id=eq.${organizationId}`);
  listen("tool_heating_cycles", machineFilter ?? `organization_id=eq.${organizationId}`);
  listen("tool_ovens", machineFilter ?? `organization_id=eq.${organizationId}`);
  listen("simplified_imports", `organization_id=eq.${organizationId}`);
  // This junction table has no organization_id. Its RLS policy is tied to the
  // parent heating cycle, so Realtime still only exposes authorized rows.
  listen("tool_heating_cycle_orders");

  channel.subscribe((status) => onStatus?.(status));
  return () => {
    void client.removeChannel(channel);
  };
}
