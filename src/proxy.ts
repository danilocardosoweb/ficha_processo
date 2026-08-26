import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) { return updateSession(request); }

// Static metadata must remain public; otherwise the auth redirect returns the
// login HTML where the browser expects JSON and reports a manifest syntax error.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
