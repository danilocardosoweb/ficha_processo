import { PageHeading } from "@/components/page-heading";
import { ProductionSettingsManager } from "@/components/production-settings-manager";
import { ResourceCalendarManager } from "@/components/resource-calendar-manager";
import { requireAdmin } from "@/lib/local-auth/server";

export default async function ProductionSettingsPage() {
  await requireAdmin();
  return <><PageHeading eyebrow="Administração · Produção" title="Turnos e parâmetros" description="Cadastre horários, premissas e indisponibilidades usados na simulação da produção." /><ProductionSettingsManager /><ResourceCalendarManager /></>;
}
