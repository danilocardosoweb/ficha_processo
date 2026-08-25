import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getSessionToken } from "@/lib/local-auth/server";

const profileSchema = z.object({ operation: z.literal("profile"), displayName: z.string().trim().min(2).max(120), email: z.union([z.string().email(), z.literal("")]) });
const passwordSchema = z.object({ operation: z.literal("password"), currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) });

export async function PATCH(request: Request) {
  const token = await getSessionToken();
  if (!token) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  const body = await request.json().catch(() => null);
  const supabase = await createClient();
  if (body?.operation === "profile") {
    const parsed = profileSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Revise nome e e-mail." }, { status: 400 });
    const { error } = await supabase.rpc("local_update_profile", { p_token: token, p_display_name: parsed.data.displayName, p_email: parsed.data.email || null });
    if (error) { console.error("profile update failed", error); return NextResponse.json({ error: error.message.includes("duplicate") ? "Este e-mail já está em uso." : "Não foi possível salvar a identificação. Tente novamente." }, { status: 400 }); }
    return NextResponse.json({ ok: true });
  }
  const parsed = passwordSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "A nova senha precisa ter ao menos 8 caracteres." }, { status: 400 });
  const { error } = await supabase.rpc("local_change_password", { p_token: token, p_current_password: parsed.data.currentPassword, p_new_password: parsed.data.newPassword });
  if (error) { console.error("password update failed", error); return NextResponse.json({ error: error.message.includes("Senha atual incorreta") ? "Senha atual incorreta. Use a mesma senha informada no login." : "Não foi possível alterar a senha. Tente novamente." }, { status: 400 }); }
  return NextResponse.json({ ok: true });
}
