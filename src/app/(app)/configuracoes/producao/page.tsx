import { PageHeading } from "@/components/page-heading";
import { ProductionSettingsManager } from "@/components/production-settings-manager";
import { requireAdmin } from "@/lib/local-auth/server";

export default async function ProductionSettingsPage() {
  await requireAdmin();
  return <><PageHeading eyebrow="Administração · Produção" title="Turnos e parâmetros" description="Cadastre os horários de trabalho e os valores padrão usados na simulação da produção." /><ProductionSettingsManager /></>;
}
