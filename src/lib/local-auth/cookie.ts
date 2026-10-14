import "server-only";

import { isLocalDesktopMode } from "@/lib/local-db/mode";

export function localSessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    // The desktop process only serves 127.0.0.1 over HTTP. A secure cookie
    // would not be persisted there, while hosted environments keep HTTPS-only.
    secure: process.env.NODE_ENV === "production" && !isLocalDesktopMode(),
    path: "/",
    maxAge,
    priority: "high" as const,
  };
}
