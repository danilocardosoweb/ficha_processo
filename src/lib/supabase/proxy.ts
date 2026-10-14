import { NextResponse, type NextRequest } from "next/server";
import { LOCAL_SESSION_COOKIE } from "@/lib/local-auth/types";

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const publicRoute = pathname === "/login"
    || pathname === "/primeiro-acesso"
    || pathname.startsWith("/api/session/")
    || pathname === "/api/local/status"
    || pathname === "/api/local/bootstrap";
  if (!publicRoute && !request.cookies.get(LOCAL_SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next({ request });
}
