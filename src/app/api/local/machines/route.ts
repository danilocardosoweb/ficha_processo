import { NextResponse } from "next/server";
import { z } from "zod";
import { getLocalCatalogActor, localCatalogError } from "@/lib/local-db/catalog-route-auth";
import { listLocalMachines } from "@/lib/local-db/catalogs";
import { appendLocalAuditEvent, getLocalDatabase } from "@/lib/local-db/database";
import { createSharedDataStore, SharedDataError } from "@/lib/local-db/shared-data-store.mjs";
import { saveSharedMachine, syncSharedMachines } from "@/lib/local-db/shared-machines.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.string().uuid().nullable().optional(),
  code: z.string().trim().min(1).max(20).regex(/^[a-zA-Z0-9._-]+$/).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  capacity_tons: z.number().int().positive().max(100_000).nullable().optional(),
  is_active: z.boolean(),
});

export async function GET() {
  const context = await getLocalCatalogActor();
  if (context.response) return context.response;
  try {
    await syncSharedMachines(getLocalDatabase(), createSharedDataStore());
    return NextResponse.json(listLocalMachines(), { headers: { "Cache-Control": "no-store", "X-TecnoMES-Shared-State": "online", "X-TecnoMES-Can-Edit": ["admin", "pcp"].includes(context.user?.role ?? "") ? "true" : "false" } });
  } catch (error) {
    if (error instanceof SharedDataError && error.status === 503) {
      return NextResponse.json(listLocalMachines(), { headers: { "Cache-Control": "no-store", "X-TecnoMES-Shared-State": "stale", "X-TecnoMES-Can-Edit": "false" } });
    }
    if (error instanceof SharedDataError) return NextResponse.json({ error: error.message }, { status: error.status });
    return localCatalogError(error);
  }
}

export async function POST(request: Request) {
  const context = await getLocalCatalogActor();
  if (context.response) return context.response;
  if (!context.user || !["admin", "pcp"].includes(context.user.role)) return NextResponse.json({ error: "Somente PCP ou administrador pode alterar prensas." }, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Confira os dados da prensa." }, { status: 400 });
  try {
    const id = await saveSharedMachine(getLocalDatabase(), createSharedDataStore(), parsed.data);
    appendLocalAuditEvent({ actorUserId: context.user.user_id, entityType: "machine", entityId: id, eventType: "machine_shared_saved", details: { code: parsed.data.code } });
    return NextResponse.json({ ok: true, id });
  } catch (error) {
    if (error instanceof SharedDataError) return NextResponse.json({ error: error.message }, { status: error.status });
    return localCatalogError(error);
  }
}
