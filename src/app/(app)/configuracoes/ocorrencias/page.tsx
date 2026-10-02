import { PageHeading } from "@/components/page-heading";
import { OccurrenceCatalogManager } from "@/components/occurrence-catalog-manager";
import { requireAdmin } from "@/lib/local-auth/server";

export default async function OccurrenceSettingsPage() {
  await requireAdmin();
  return <><PageHeading eyebrow="Administração" title="Cadastros industriais" description="Configure processo, Report da Produção, qualidade e manutenção. Alterações ficam registradas na auditoria." /><OccurrenceCatalogManager /></>;
}
