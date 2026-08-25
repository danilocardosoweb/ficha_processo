import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionToken } from "@/lib/local-auth/server";
import { LOCAL_SESSION_COOKIE } from "@/lib/local-auth/types";

export async function POST() {
  const token = await getSessionToken();
  if (token) {
    try { await (await createClient()).rpc("local_logout", { p_token: token }); } catch { /* cookie still expires */ }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(LOCAL_SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
  return response;
}
