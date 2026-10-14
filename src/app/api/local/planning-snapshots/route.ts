import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local-auth/server";
import { isLocalDesktopMode } from "@/lib/local-db/mode";
import {
  getLocalPlanningSnapshotSummary,
  listLocalPlanningSnapshotRecords,
  type LocalPlanningSnapshotKind,
  type LocalPlanningSnapshotView,
} from "@/lib/local-db/planning-snapshots";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalDesktopMode()) {
    return NextResponse.json({ error: "Este recurso existe somente no aplicativo local." }, { status: 404 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Somente o administrador pode consultar os dados importados." }, { status: 403 });

  try {
    const url = new URL(request.url);
    const kindValue = url.searchParams.get("kind");
    if (kindValue !== "portfolio" && kindValue !== "simplified") {
      return NextResponse.json({ error: "Selecione carteira ou Simplificada." }, { status: 400 });
    }
    const viewValue = url.searchParams.get("view") ?? "current";
    if (viewValue !== "current" && viewValue !== "all") {
      return NextResponse.json({ error: "A visualização solicitada é inválida." }, { status: 400 });
    }
    const pageValue = Number.parseInt(url.searchParams.get("page") ?? "0", 10);
    const page = Number.isFinite(pageValue) ? Math.max(0, Math.min(100_000, pageValue)) : 0;
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 100);
    const summary = getLocalPlanningSnapshotSummary();
    const result = listLocalPlanningSnapshotRecords({
      kind: kindValue as LocalPlanningSnapshotKind,
      view: viewValue as LocalPlanningSnapshotView,
      page,
      search,
    });
    return NextResponse.json({ summary, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar a carteira e as Simplificadas locais." }, { status: 500 });
  }
}
