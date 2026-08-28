import { PageHeading } from "@/components/page-heading";
import { PressResourcesManager } from "@/components/press-resources-manager";
import { requireAdmin } from "@/lib/local-auth/server";

export default async function PressResourcesPage() {
  await requireAdmin();
  return <>
    <PageHeading eyebrow="Capacidade operacional" title="Recursos das prensas" description="Cadastre carcaças individuais por prensa e acompanhe disponibilidade, manutenção e reservas." />
    <PressResourcesManager />
  </>;
}
