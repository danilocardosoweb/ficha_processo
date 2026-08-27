import { PageHeading } from "@/components/page-heading";
import { ProcessSheetsManager } from "@/components/process-sheets-manager";

export default async function EngineeringPage({
  searchParams,
}: {
  searchParams: Promise<{ nova?: string; origem?: string }>;
}) {
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
