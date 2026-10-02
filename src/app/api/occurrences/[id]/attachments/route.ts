import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, getSessionToken } from "@/lib/local-auth/server";
import { isDevelopmentSession } from "@/lib/local-auth/development";

const MAX_BYTES = 10 * 1024 * 1024;
const allowedMime = new Set(["application/pdf", "text/plain", "text/csv", "image/jpeg", "image/png", "image/webp", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);
function safeName(name: string) { return name.normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-180) || "anexo"; }
async function context() {
  const token = await getSessionToken();
  const user = await getCurrentUser();
  if (!token || !user) return null;
  return { user, development: isDevelopmentSession(token), supabase: await createClient() };
}
function errorResponse(error: unknown, status = 400) { return NextResponse.json({ error: error instanceof Error ? error.message : "Não foi possível processar o anexo." }, { status }); }

export async function GET(_: Request, route: { params: Promise<{ id: string }> }) {
  const ctx = await context();
  if (!ctx) return errorResponse(new Error("Sessão encerrada."), 401);
  const { id } = await route.params;
  const { data, error } = await ctx.supabase.from("operational_occurrence_attachments").select("*").eq("occurrence_id", id).eq("organization_id", ctx.user.organization_id).order("created_at", { ascending: false });
  if (error) return errorResponse(error);
  const withUrls = await Promise.all((data ?? []).map(async (item) => ({ ...item, url: (await ctx.supabase.storage.from("occurrence-attachments").createSignedUrl(item.storage_path, 3600)).data?.signedUrl ?? null })));
  return NextResponse.json({ attachments: withUrls });
}

export async function POST(request: Request, route: { params: Promise<{ id: string }> }) {
  const ctx = await context();
  if (!ctx) return errorResponse(new Error("Sessão encerrada."), 401);
  if (ctx.user.role === "viewer") return errorResponse(new Error("Seu perfil não pode anexar arquivos."), 403);
  const { id } = await route.params;
  const { data: occurrence, error: occurrenceError } = await ctx.supabase.from("operational_occurrences").select("id").eq("id", id).eq("organization_id", ctx.user.organization_id).maybeSingle();
  if (occurrenceError || !occurrence) return errorResponse(occurrenceError ?? new Error("Ocorrência não encontrada."), occurrenceError ? 400 : 404);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return errorResponse(new Error("Selecione um arquivo."));
  if (file.size <= 0 || file.size > MAX_BYTES) return errorResponse(new Error("O arquivo deve ter entre 1 byte e 10 MB."));
  if (!allowedMime.has(file.type)) return errorResponse(new Error("Formato não permitido. Use PDF, imagem, CSV, XLSX ou texto."));
  const path = `${ctx.user.organization_id}/${id}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const upload = await ctx.supabase.storage.from("occurrence-attachments").upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
  if (upload.error) return errorResponse(upload.error);
  const { data, error } = await ctx.supabase.from("operational_occurrence_attachments").insert({ organization_id: ctx.user.organization_id, occurrence_id: id, storage_path: path, file_name: file.name.slice(0, 180), mime_type: file.type, byte_size: file.size, uploaded_by_user_id: ctx.development ? null : ctx.user.user_id, uploaded_by_name: ctx.user.display_name }).select("*").single();
  if (error) { await ctx.supabase.storage.from("occurrence-attachments").remove([path]); return errorResponse(error); }
  return NextResponse.json({ attachment: data }, { status: 201 });
}
