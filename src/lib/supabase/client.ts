import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

// Schema types can be generated later; the V1 uses the same untyped client shape as before.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let browserClient: SupabaseClient<any> | undefined;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  try { return await fetch(input, { ...init, signal: controller.signal }); }
  finally { window.clearTimeout(timeout); }
}

export async function withSupabaseTimeout<T>(request: PromiseLike<T>, milliseconds = 15000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<T>((_, reject) => { timeout = setTimeout(() => reject(new Error("Tempo limite de conexao com o Supabase.")), milliseconds); }),
    ]);
  } finally { if (timeout) clearTimeout(timeout); }
}

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase nao configurado. Consulte o arquivo .env.example.");
  // A V1 opera sem login. Não reutilize sessões antigas que possam existir no navegador,
  // pois elas trocam o papel anon pelas policies de authenticated e ocultam os cadastros.
  browserClient ??= createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchWithTimeout },
  });
  return browserClient;
}
