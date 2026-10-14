import { NextResponse } from "next/server";
import { z } from "zod";
import { getLocalCatalogActor, localCatalogError } from "@/lib/local-db/catalog-route-auth";
import { stageLocalToolHistoryChunk } from "@/lib/local-db/catalogs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const nullableNumber = z.number().finite().nullable();
const rowSchema = z.object({
  code: z.string().trim().min(1).max(160),
  matrix_code: z.string().trim().min(1).max(80),
  sequence_number: z.number().int().min(0).max(10_000),
  holes: nullableNumber,
  theoretical_linear_weight_kg_m: nullableNumber,
  useful_life_kg: nullableNumber,
  produced_kg: nullableNumber,
  remaining_kg: nullableNumber,
  source_status: z.string().nullable(),
  source_available: z.boolean(),
  machine_codes: z.string().nullable(),
  package_measure_mm: nullableNumber,
  carcass_diameter_mm: nullableNumber,
  carcass_code: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
});

const schema = z.object({
  file_hash: z.string().regex(/^[a-f0-9]{64}$/i),
  file_name: z.string().trim().min(1).max(255),
  chunk_index: z.number().int().min(0).max(10_000),
  total_chunks: z.number().int().min(1).max(10_000),
  rows: z.array(rowSchema).min(1).max(200),
}).refine((value) => value.chunk_index < value.total_chunks, { message: "Etapa de importação inválida." });

export async function POST(request: Request) {
  const context = await getLocalCatalogActor();
  if (context.response) return context.response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Confira os dados da planilha." }, { status: 400 });
  try {
    const result = stageLocalToolHistoryChunk({
      fileHash: parsed.data.file_hash.toLowerCase(),
      fileName: parsed.data.file_name,
      chunkIndex: parsed.data.chunk_index,
      totalChunks: parsed.data.total_chunks,
      rows: parsed.data.rows,
    }, context.user.user_id);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return localCatalogError(error);
  }
}
