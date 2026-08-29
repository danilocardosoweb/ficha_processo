import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LOCAL_SESSION_COOKIE, type LocalUser, type ManagedUser } from "@/lib/local-auth/types";
import { canAccess, type AccessArea } from "@/lib/access-control";

export async function getSessionToken() {
  return (await cookies()).get(LOCAL_SESSION_COOKIE)?.value ?? null;
}

export async function getCurrentUser(): Promise<LocalUser | null> {
  const token = await getSessionToken();
  if (!token) return null;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("local_get_session", { p_token: token });
    if (error) return null;
    return ((Array.isArray(data) ? data[0] : data) as LocalUser | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireCurrentUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

export async function requirePermission(area: AccessArea) {
  const user = await requireCurrentUser();
  if (!canAccess(user.role, area)) redirect("/dashboard");
  return user;
}

export async function listLocalUsers(): Promise<ManagedUser[]> {
  const token = await getSessionToken();
  if (!token) return [];
  const supabase = await createClient();
  const present = await supabase.rpc("local_list_users_with_presence", { p_token: token });
  if (!present.error) return (present.data ?? []) as ManagedUser[];

  const fallback = await supabase.rpc("local_list_users", { p_token: token });
  if (fallback.error) throw fallback.error;
  return (fallback.data ?? []) as ManagedUser[];
}
