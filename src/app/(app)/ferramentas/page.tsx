import { PageHeading } from "@/components/page-heading";
import { ToolsManager } from "@/components/tools-manager";

export default function Page() {
  return <><PageHeading eyebrow="Ferramentas" title="Cadastro de ferramentas" description="Consulte as matrizes importadas e mantenha seus dados de engenharia." /><ToolsManager /></>;
}
