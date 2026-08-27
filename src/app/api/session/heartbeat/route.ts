import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local-auth/server";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  return NextResponse.json(
    { ok: true, at: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
