"use client";

import { createClient, withSupabaseTimeout } from "@/lib/supabase/client";

export type OfflineResource =
  | "tools"
  | "process_sheets"
  | "machines"
  | "production_orders"
  | "tool_heating_cycles"
  | "operational_catalogs";

type Snapshot<T = unknown> = {
  key: OfflineResource;
  rows: T[];
  syncedAt: string;
};

const databaseName = "alummes-offline-v1";
const storeName = "snapshots";
const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;

export const normalizeCode = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName))
        database.createObjectStore(storeName, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getOfflineSnapshot<T>(
  key: OfflineResource,
): Promise<Snapshot<T> | null> {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  return await new Promise<Snapshot<T> | null>((resolve, reject) => {
    const request = database
      .transaction(storeName, "readonly")
      .objectStore(storeName)
      .get(key);
    request.onsuccess = () =>
      resolve((request.result as Snapshot<T> | undefined) ?? null);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
}

async function putOfflineSnapshot<T>(key: OfflineResource, rows: T[]) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put({
      key,
      rows,
      syncedAt: new Date().toISOString(),
    } satisfies Snapshot<T>);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => database.close());
  window.dispatchEvent(
    new CustomEvent("alummes-cache-updated", { detail: { resource: key } }),
  );
}

async function fetchAll<T>(
  makeQuery: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
) {
  const rows: T[] = [];
  const batchSize = 1000;
  for (let from = 0; ; from += batchSize) {
    const { data, error } = await withSupabaseTimeout(
      makeQuery(from, from + batchSize - 1),
      45000,
    );
    if (error) throw new Error(error.message);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < batchSize) return rows;
  }
}

export async function syncOfflineResource(resource: OfflineResource) {
  if (!organizationId || !navigator.onLine) return;
  const supabase = createClient();
  if (resource === "tools") {
    const rows = await fetchAll((from, to) =>
      supabase
        .from("tools")
        .select(
          "id,code,description,lifecycle_kg,status,updated_at,matrix_code,sequence_number,holes,theoretical_linear_weight_kg_m,actual_linear_weight_kg_m,useful_life_kg,produced_kg,remaining_kg,source_status,source_available,machine_codes",
        )
        .eq("organization_id", organizationId)
        .not("matrix_code", "is", null)
        .order("matrix_code")
        .order("sequence_number")
        .range(from, to),
    );
    await putOfflineSnapshot(resource, rows);
    return;
  }
  if (resource === "process_sheets") {
    const rows = await fetchAll((from, to) =>
      supabase
        .from("process_sheets")
        .select(
          "id,machine_code,tool_code,product_code,alloy_code,temper,revision,tool_sequence,parameters,is_active,updated_at,last_changed_by_name,last_change_reason",
        )
        .eq("organization_id", organizationId)
        .neq("tool_search", "")
        .order("product_code")
        .order("machine_code")
        .range(from, to),
    );
    await putOfflineSnapshot(resource, rows);
    return;
  }
  if (resource === "machines") {
    const rows = await fetchAll((from, to) =>
      supabase
        .from("machines")
        .select("code,name")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("code")
        .range(from, to),
    );
    await putOfflineSnapshot(resource, rows);
    return;
  }
  if (resource === "operational_catalogs") {
    const rows = await fetchAll((from, to) =>
      supabase
        .from("operational_catalogs")
        .select(
          "id,catalog_type,code,label,group_code,responsible_department,routes_to_maintenance,sort_order,metadata,is_active",
        )
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("catalog_type")
        .order("sort_order")
        .range(from, to),
    );
    await putOfflineSnapshot(resource, rows);
    return;
  }
  if (resource === "tool_heating_cycles") {
    const rows = await fetchAll((from, to) =>
      supabase
        .from("tool_heating_cycles")
        .select("id,machine_code,tool_code,oven_code,oven_position,status,expected_ready_at,tool_heating_cycle_orders(production_order_id)")
        .eq("organization_id", organizationId)
        .in("status", ["heating", "released"])
        .order("entered_at", { ascending: false })
        .range(from, to),
    );
    await putOfflineSnapshot(resource, rows);
    return;
  }
  const rows = await fetchAll((from, to) =>
    supabase
      .from("production_orders")
      .select(
        "id,import_batch_id,order_number,plan_code,machine_code,tool_code,product_code,customer_name,alloy_code,temper,target_kg,target_quantity,demand_unit,is_active,produced_kg,produced_quantity,status,sequence,actual_start,actual_end,started_by_name,completed_by_name,reopened_at,reopened_by_name,reprogram_count,due_date",
      )
      .eq("organization_id", organizationId)
      .eq("is_active", true)
      .in("status", ["planned", "released", "in_progress", "paused"])
      .order("sequence")
      .range(from, to),
  );
  await putOfflineSnapshot(resource, rows);
}

export async function syncOperationalData() {
  await Promise.all([
    syncOfflineResource("tools"),
    syncOfflineResource("process_sheets"),
    syncOfflineResource("machines"),
    syncOfflineResource("production_orders"),
    syncOfflineResource("tool_heating_cycles"),
    syncOfflineResource("operational_catalogs"),
  ]);
}

export function requestOfflineSync() {
  window.dispatchEvent(new Event("alummes-request-sync"));
}
