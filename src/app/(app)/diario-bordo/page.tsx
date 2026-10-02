import { PageHeading } from "@/components/page-heading";
import { DailyLog } from "@/components/daily-log";
import { requirePermission } from "@/lib/local-auth/server";

export default async function DailyLogPage() {
  await requirePermission("diary");
  return <><PageHeading eyebrow="Acompanhamento" title="Report da Produção" description="Registre ocorrências, acompanhe atualizações e prepare a passagem de turno sem duplicar os dados das paradas." /><DailyLog /></>;
}
