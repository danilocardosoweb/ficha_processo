import { notFound } from "next/navigation";
import { ImportedDataArchive } from "@/components/imported-data-archive";
import { PageHeading } from "@/components/page-heading";
import { requireCurrentUser } from "@/lib/local-auth/server";
import { isLocalDesktopMode } from "@/lib/local-db/mode";
import { getLocalWebArchiveSummary } from "@/lib/local-db/web-archive";

export const dynamic = "force-dynamic";

export default async function ImportedDataPage() {
  const user = await requireCurrentUser();
  if (!isLocalDesktopMode() || user.role !== "admin") notFound();

  const summary = getLocalWebArchiveSummary();
  return <>
    <PageHeading
      eyebrow="Administração · dados locais"
      title="Dados importados"
      description="Consulte, pesquise e confira os registros históricos trazidos da versão web. Esta tela é somente leitura."
    />
    <ImportedDataArchive initialSummary={summary} />
  </>;
}
