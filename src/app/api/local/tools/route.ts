import { NextResponse } from "next/server";
import { z } from "zod";
import { getLocalCatalogActor, localCatalogError } from "@/lib/local-db/catalog-route-auth";
import { listLocalTools, saveLocalTool } from "@/lib/local-db/catalogs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nonNegative = z.number().finite().min(0).nullable().optional();
const positive = z.number().finite().positive().nullable().optional();
const schema = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().trim().min(1).max(160),
  matrix_code: z.string().trim().min(1).max(80).transform((value) => value.toUpperCase()),
  sequence_number: z.number().int().min(0).max(10_000),
  description: z.string().trim().max(240).nullable().optional(),
  holes: z.number().int().min(0).max(100_000).nullable().optional(),
  theoretical_linear_weight_kg_m: nonNegative,
  tool_weight_kg: positive,
  useful_life_kg: nonNegative,
  produced_kg: z.number().finite().min(0).max(1_000_000_000),
  status: z.enum(["available", "in_use", "maintenance", "inactive"]),
  machine_codes: z.string().trim().max(500).nullable().optional(),
  package_measure_mm: positive,
  carcass_diameter_mm: positive,
  carcass_code: z.string().trim().max(60).nullable().optional(),
});

export async function GET(request: Request) {
  const context = await getLocalCatalogActor();
  if (context.response) return context.response;
  const url = new URL(request.url);
  const page = Math.max(0, Math.min(100_000, Number.parseInt(url.searchParams.get("page") ?? "0", 10) || 0));
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 120);
  const result = listLocalTools({ search, page, pageSize: 25 });
  return NextResponse.json({ ...result, page, pageSize: 25 }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const context = await getLocalCatalogActor();
  if (context.response) return context.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Confira os dados da ferramenta." }, { status: 400 });
  try {
    const value = parsed.data;
    const id = saveLocalTool({ ...value, carcass_code: value.carcass_code || null }, context.user.user_id);
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    return localCatalogError(error);
  }
}
