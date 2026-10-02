import type { SupabaseClient } from "@supabase/supabase-js";

type CacheEntry = { url: string; expiresAt: number };
type StorageStats = { requests: number; cacheHits: number; duplicateWarnings: number };

const urlCache = new Map<string, CacheEntry>();
const pending = new Map<string, Promise<string>>();
const recentRequests = new Map<string, number[]>();
const stats: StorageStats = { requests: 0, cacheHits: 0, duplicateWarnings: 0 };
const MAX_CONCURRENT = 4;
let active = 0;
const queue: (() => void)[] = [];

function cacheKey(kind: string, bucket: string, path: string, expiresIn?: number) {
  return `${kind}:${bucket}:${path}:${expiresIn ?? "public"}`;
}

function warnRepeated(key: string) {
  const now = Date.now();
  const recent = (recentRequests.get(key) ?? []).filter((time) => now - time < 30_000);
  recent.push(now);
  recentRequests.set(key, recent);
  if (recent.length >= 3) {
    stats.duplicateWarnings += 1;
    if (process.env.NODE_ENV !== "production") console.warn(`[Storage] arquivo solicitado ${recent.length}x em 30s: ${key}`);
  }
}

async function limited<T>(task: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => queue.push(resolve));
  active += 1;
  try { return await task(); } finally { active -= 1; queue.shift()?.(); }
}

export async function getCachedSignedUrl(client: SupabaseClient, bucket: string, path: string, expiresIn = 3600) {
  const key = cacheKey("signed", bucket, path, expiresIn);
  const cached = urlCache.get(key);
  if (cached && cached.expiresAt > Date.now() + 30_000) { stats.cacheHits += 1; return cached.url; }
  const existing = pending.get(key);
  if (existing) { stats.cacheHits += 1; return existing; }
  warnRepeated(key);
  stats.requests += 1;
  const request = limited(async () => {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) throw error ?? new Error("Não foi possível criar a URL assinada.");
    urlCache.set(key, { url: data.signedUrl, expiresAt: Date.now() + expiresIn * 1000 });
    return data.signedUrl;
  });
  pending.set(key, request);
  try { return await request; } finally { pending.delete(key); }
}

export function getCachedPublicUrl(client: SupabaseClient, bucket: string, path: string) {
  const key = cacheKey("public", bucket, path);
  const cached = urlCache.get(key);
  if (cached) { stats.cacheHits += 1; return cached.url; }
  warnRepeated(key);
  const { data } = client.storage.from(bucket).getPublicUrl(path);
  urlCache.set(key, { url: data.publicUrl, expiresAt: Number.MAX_SAFE_INTEGER });
  stats.requests += 1;
  return data.publicUrl;
}

export function getStorageStats(): Readonly<StorageStats> { return { ...stats }; }
export function clearStorageUrlCache() { urlCache.clear(); }
