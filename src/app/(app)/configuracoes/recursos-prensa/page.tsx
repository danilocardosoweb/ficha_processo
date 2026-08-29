import { PageHeading } from "@/components/page-heading";
import { PressResourcesManager } from "@/components/press-resources-manager";
import { ToolCarcassMappingManager } from "@/components/tool-carcass-mapping-manager";
import { BoResourcesManager } from "@/components/bo-resources-manager";
import { requireAdmin } from "@/lib/local-auth/server";

export default async function PressResourcesPage() {
  await requireAdmin();
  return <>
    <PageHeading eyebrow="Capacidade operacional" title="Recursos compartilhados" description="Controle carcaças e BOs físicos utilizados pelas duas prensas, incluindo disponibilidade, manutenção e conflitos simultâneos." />
    <PressResourcesManager />
    <BoResourcesManager />
    <ToolCarcassMappingManager />
  </>;
}
