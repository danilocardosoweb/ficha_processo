import { PageHeading } from "@/components/page-heading";
import { PressResourcesManager } from "@/components/press-resources-manager";
import { requireAdmin } from "@/lib/local-auth/server";

export default async function PressResourcesPage() {
  await requireAdmin();
  return <>
    <PageHeading eyebrow="Capacidade operacional" title="Carcaças compartilhadas" description="Controle o estoque único de carcaças utilizado pelas duas prensas, incluindo disponibilidade, manutenção e reservas." />
    <PressResourcesManager />
  </>;
}
