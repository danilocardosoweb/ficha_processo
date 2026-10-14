import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local-auth/server";
import { isLocalDesktopMode } from "@/lib/local-db/mode";
import { getLocalWebArchiveSummary, listLocalWebArchiveRecords } from "@/lib/local-db/web-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isLocalDesktopMode()) {
    return NextResponse.json({ error: "Este recurso existe somente no aplicativo local." }, { status: 404 });
  }
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sessão encerrada." }, { status: 401 });
  if (user.role !== "admin") return NextResponse.json({ error: "Somente o administrador pode consultar o arquivo importado." }, { status: 403 });

  try {
    const url = new URL(request.url);
    const summary = getLocalWebArchiveSummary();
    const tableKey = (url.searchParams.get("table") ?? "").trim();
    if (!tableKey) {
      return NextResponse.json({ summary }, { headers: { "Cache-Control": "no-store" } });
    }

    const pageValue = Number.parseInt(url.searchParams.get("page") ?? "0", 10);
    const page = Number.isFinite(pageValue) ? Math.max(0, Math.min(100_000, pageValue)) : 0;
    const search = (url.searchParams.get("search") ?? "").trim().slice(0, 100);
    const result = listLocalWebArchiveRecords({ tableKey, search, page, pageSize: 25 });
    if (!result) return NextResponse.json({ error: "Tabela não encontrada no arquivo importado." }, { status: 404 });

    return NextResponse.json({ summary, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar os dados importados." }, { status: 500 });
  }
}
