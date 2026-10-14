import { NextResponse } from "next/server";
import { z } from "zod";
import { getLocalCatalogActor, localCatalogError } from "@/lib/local-db/catalog-route-auth";
import { listLocalProcessSheets, listLocalProcessSheetTemplates, saveLocalProcessSheet } from "@/lib/local-db/catalogs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.string().uuid().nullable().optional(),
  new_sequence: z.boolean().optional(),
  machine_code: z.string().trim().max(80).nullable(),
  tool_code: z.string().trim().min(1).max(160),
  product_code: z.string().trim().max(160).nullable(),
  alloy_code: z.string().trim().min(1).max(80),
  temper: z.string().trim().max(80).nullable(),
  revision: z.number().int().min(1).max(10_000),
  tool_sequence: z.number().int().min(1).max(10_000).nullable(),
  parameters: z.record(z.string(), z.unknown()),
  is_active: z.boolean(),
  copied_from_process_sheet_id: z.string().uuid().nullable().optional(),
  copied_from_sequence: z.number().int().nullable().optional(),
});

export async function GET(request: Request) {
  const context = await getLocalCatalogActor();
  if (context.response) return context.response;
  const url = new URL(request.url);
  if (url.searchParams.get("templates") === "1") {
    return NextResponse.json(listLocalProcessSheetTemplates(), { headers: { "Cache-Control": "no-store" } });
  }
  const page = Math.max(0, Math.min(100_000, Number.parseInt(url.searchParams.get("page") ?? "0", 10) || 0));
  const pageSize = 30;
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 120);
  const machine = (url.searchParams.get("machine") ?? "").trim().slice(0, 80);
  const rawCut = Number(url.searchParams.get("cut"));
  const cutMm = Number.isFinite(rawCut) && rawCut > 0 ? rawCut : null;
  const result = listLocalProcessSheets({ search, machine, cutMm, page, pageSize });
  return NextResponse.json({ ...result, page, pageSize }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const context = await getLocalCatalogActor();
  if (context.response) return context.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Confira os dados da ficha." }, { status: 400 });
  try {
    const id = saveLocalProcessSheet(parsed.data, context.user.user_id, parsed.data.new_sequence);
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return localCatalogError(error);
  }
}
