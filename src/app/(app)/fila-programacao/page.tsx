import { notFound } from "next/navigation";
import { PlanningQueuePanel } from "@/components/planning-queue-panel";
import { PageHeading } from "@/components/page-heading";
import { requirePermission } from "@/lib/local-auth/server";
import { isLocalDesktopMode } from "@/lib/local-db/mode";

export const dynamic = "force-dynamic";

export default async function PlanningQueuePage() {
  const user = await requirePermission("planning");
  if (!isLocalDesktopMode()) notFound();

  return <div className="space-y-5">
    <PageHeading eyebrow="PCP · Acesso compartilhado" title="Fila da programação" description="Organiza a vez de edição entre os computadores sem impedir que os demais consultem o aplicativo." />
    <PlanningQueuePanel displayName={user.display_name} role={user.role} />
  </div>;
}
