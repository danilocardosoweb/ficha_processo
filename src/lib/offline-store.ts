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
  fullSyncedAt?: string;
};

const databaseName = "alummes-offline-v1";
const storeName = "snapshots";
const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
const freshCacheMs = 5 * 60 * 1000;
const fullRefreshMs = 12 * 60 * 60 * 1000;
const incrementalOverlapMs = 10 * 1000;
let databasePromise: Promise<IDBDatabase> | null = null;
let operationalSync: Promise<void> | null = null;

export const normalizeCode = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(storeName))
        database.createObjectStore(storeName, { keyPath: "key" });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error);
    };
  });
  return databasePromise;
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
  });
}

async function putOfflineSnapshot<T>(key: OfflineResource, rows: T[], syncedAt: string, fullSyncedAt?: string) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put({
      key,
      rows,
      syncedAt,
      fullSyncedAt,
    } satisfies Snapshot<T>);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  window.dispatchEvent(
    new CustomEvent("alummes-cache-updated", { detail: { resource: key } }),
  );
}

function isFresh(value?: string, maximumAgeMs = freshCacheMs) {
  return !!value && Date.now() - new Date(value).getTime() < maximumAgeMs;
}

function mergeRows<T extends Record<string, unknown>>(current: T[], changed: T[]) {
  const merged = new Map(current.map((row) => [String(row.id), row]));
  for (const row of changed) merged.set(String(row.id), row);
  return [...merged.values()];
}

function keepOfflineRow(resource: OfflineResource, row: Record<string, unknown>) {
  if (resource === "tools") return Boolean(row.matrix_code);
  if (resource === "process_sheets") return row.tool_search !== "";
  if (resource === "machines" || resource === "operational_catalogs") return row.is_active !== false;
  if (resource === "tool_heating_cycles") return ["heating", "released"].includes(String(row.status));
  if (resource === "production_orders") return row.is_active !== false && ["planned", "released", "in_progress", "paused"].includes(String(row.status));
  return true;
}

function incrementalSince(snapshot: Snapshot | null) {
  if (!snapshot?.syncedAt) return null;
  return new Date(new Date(snapshot.syncedAt).getTime() - incrementalOverlapMs).toISOString();
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

export async function syncOfflineResource(resource: OfflineResource, options: { force?: boolean } = {}) {
  if (!organizationId || !navigator.onLine) return;
  const snapshot = await getOfflineSnapshot<Record<string, unknown>>(resource);
  if (!options.force && isFresh(snapshot?.syncedAt)) return;
  const fullRefresh = !snapshot || !isFresh(snapshot.fullSyncedAt, fullRefreshMs);
  const since = fullRefresh ? null : incrementalSince(snapshot);
  const syncStartedAt = new Date().toISOString();
  const supabase = createClient();
  const persist = async (changed: Record<string, unknown>[]) => {
    const merged = fullRefresh ? changed : mergeRows(snapshot?.rows ?? [], changed);
    const rows = merged.filter((row) => keepOfflineRow(resource, row));
    await putOfflineSnapshot(resource, rows, syncStartedAt, fullRefresh ? syncStartedAt : snapshot?.fullSyncedAt);
  };
  if (resource === "tools") {
    const rows = await fetchAll((from, to) =>
      {
        let query = supabase
        .from("tools")
        .select(
          "id,code,description,lifecycle_kg,status,updated_at,matrix_code,sequence_number,holes,theoretical_linear_weight_kg_m,actual_linear_weight_kg_m,useful_life_kg,produced_kg,remaining_kg,source_status,source_available,machine_codes",
        )
        .eq("organization_id", organizationId);
        query = since ? query.gte("updated_at", since) : query.not("matrix_code", "is", null);
        return query.order("matrix_code").order("sequence_number").range(from, to);
      },
    );
    await persist(rows);
    return;
  }
  if (resource === "process_sheets") {
    const rows = await fetchAll((from, to) =>
      {
        let query = supabase
        .from("process_sheets")
        .select(
          "id,machine_code,tool_code,product_code,alloy_code,temper,revision,tool_sequence,parameters,is_active,tool_search,updated_at,last_changed_by_name,last_change_reason",
        )
        .eq("organization_id", organizationId);
        query = since ? query.gte("updated_at", since) : query.neq("tool_search", "");
        return query.order("product_code").order("machine_code").range(from, to);
      },
    );
    await persist(rows);
    return;
  }
  if (resource === "machines") {
    const rows = await fetchAll((from, to) =>
      {
        let query = supabase
        .from("machines")
        .select("id,code,name,is_active,updated_at")
        .eq("organization_id", organizationId);
        query = since ? query.gte("updated_at", since) : query.eq("is_active", true);
        return query.order("code").range(from, to);
      },
    );
    await persist(rows);
    return;
  }
  if (resource === "operational_catalogs") {
    const rows = await fetchAll((from, to) =>
      {
        let query = supabase
        .from("operational_catalogs")
        .select(
          "id,catalog_type,code,label,group_code,responsible_department,routes_to_maintenance,sort_order,metadata,is_active,updated_at",
        )
        .eq("organization_id", organizationId);
        query = since ? query.gte("updated_at", since) : query.eq("is_active", true);
        return query.order("catalog_type").order("sort_order").range(from, to);
      },
    );
    await persist(rows);
    return;
  }
  if (resource === "tool_heating_cycles") {
    const rows = await fetchAll((from, to) =>
      {
        let query = supabase
        .from("tool_heating_cycles")
        .select("id,machine_code,tool_code,oven_code,oven_position,status,expected_ready_at,updated_at,tool_heating_cycle_orders(production_order_id)")
        .eq("organization_id", organizationId);
        query = since ? query.gte("updated_at", since) : query.in("status", ["heating", "released"]);
        return query.order("entered_at", { ascending: false }).range(from, to);
      },
    );
    await persist(rows);
    return;
  }
  const rows = await fetchAll((from, to) =>
    {
      let query = supabase
      .from("production_orders")
      .select(
        "id,import_batch_id,order_number,plan_code,machine_code,tool_code,product_code,customer_name,alloy_code,temper,target_kg,target_quantity,demand_unit,is_active,produced_kg,produced_quantity,status,sequence,actual_start,actual_end,started_by_name,completed_by_name,reopened_at,reopened_by_name,reprogram_count,due_date,updated_at",
      )
      .eq("organization_id", organizationId);
      query = since ? query.gte("updated_at", since) : query.eq("is_active", true).in("status", ["planned", "released", "in_progress", "paused"]);
      return query.order("sequence").range(from, to);
    },
  );
  await persist(rows);
}

const allResources: OfflineResource[] = ["tools", "process_sheets", "machines", "production_orders", "tool_heating_cycles", "operational_catalogs"];

export async function syncOperationalData(options: { resources?: OfflineResource[]; force?: boolean } = {}) {
  const resources = [...new Set(options.resources?.length ? options.resources : allResources)];
  const previous = operationalSync;
  const current = (previous ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      await Promise.all(resources.map((resource) => syncOfflineResource(resource, { force: options.force })));
    });
  operationalSync = current;
  try {
    await current;
  } finally {
    if (operationalSync === current) operationalSync = null;
  }
}

export function requestOfflineSync(resources?: OfflineResource | OfflineResource[]) {
  const requested = resources ? (Array.isArray(resources) ? resources : [resources]) : allResources;
  window.dispatchEvent(new CustomEvent("alummes-request-sync", { detail: { resources: requested } }));
}
