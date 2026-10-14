import { NextResponse } from "next/server";
import { localDatabaseStatus } from "@/lib/local-db/database";
import { isLocalDesktopMode } from "@/lib/local-db/mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!isLocalDesktopMode()) return NextResponse.json({ error: "Edição local não habilitada." }, { status: 404 });
  return NextResponse.json({ mode: "local", database: localDatabaseStatus() }, { headers: { "Cache-Control": "no-store" } });
}
