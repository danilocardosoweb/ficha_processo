import { PageHeading } from "@/components/page-heading";
import { ProcessSheetsManager } from "@/components/process-sheets-manager";
import { requirePermission } from "@/lib/local-auth/server";

export default async function EngineeringPage({
  searchParams,
}: {
  searchParams: Promise<{ nova?: string; origem?: string }>;
}) {
  await requirePermission("engineering");
  const params = await searchParams;
  return (
    <>
      <PageHeading
        eyebrow="Engenharia"
        title="Fichas de processo"
        description="Parâmetros por ferramenta, sequência física, liga, corte e prensa."
      />
      <ProcessSheetsManager
        initialToolCode={params.nova}
        returnToProductionInitially={params.origem === "producao"}
      />
    </>
  );
}
