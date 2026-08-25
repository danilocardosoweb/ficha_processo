import { PageHeading } from "@/components/page-heading";
import { ProcessSheetsManager } from "@/components/process-sheets-manager";

export default function EngineeringPage() {
  return <><PageHeading eyebrow="Engenharia" title="Fichas de processo" description="Parâmetros por ferramenta, sequência física, liga, corte e prensa." /><ProcessSheetsManager /></>;
}
