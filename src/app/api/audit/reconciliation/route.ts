import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const { data, error } = await (await createClient()).rpc("local_get_audit_reconciliation_data", { p_token: token });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  return NextResponse.json(data);
}

