import { NextResponse } from "next/server";
import { getSessionToken } from "@/lib/local-auth/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const { id } = await params;
  const { data, error } = await (await createClient()).rpc("local_get_production_session", {
    p_token: token,
    p_session_id: id,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 404 });
  return NextResponse.json(data);
}

