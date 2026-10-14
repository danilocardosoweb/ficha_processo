import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionToken } from "@/lib/local-auth/server";
import { LOCAL_SESSION_COOKIE } from "@/lib/local-auth/types";
import { isLocalDesktopMode } from "@/lib/local-db/mode";
import { revokeLocalSession } from "@/lib/local-db/auth";
import { localSessionCookieOptions } from "@/lib/local-auth/cookie";

export async function POST() {
  const token = await getSessionToken();
  if (token) {
    if (isLocalDesktopMode()) revokeLocalSession(token);
    else {
      try { await (await createClient()).rpc("local_logout", { p_token: token }); } catch { /* cookie still expires */ }
    }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(LOCAL_SESSION_COOKIE, "", localSessionCookieOptions(0));
  return response;
}
