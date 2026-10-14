import { notFound } from "next/navigation";
import { LocalPlanningSnapshots } from "@/components/local-planning-snapshots";
import { PageHeading } from "@/components/page-heading";
import { requireCurrentUser } from "@/lib/local-auth/server";
import { isLocalDesktopMode } from "@/lib/local-db/mode";
import { getLocalPlanningSnapshotSummary, listLocalPlanningSnapshotRecords } from "@/lib/local-db/planning-snapshots";

export const dynamic = "force-dynamic";

export default async function LocalSimplifiedPlansPage() {
  const user = await requireCurrentUser();
  if (!isLocalDesktopMode() || user.role !== "admin") notFound();
  const summary = getLocalPlanningSnapshotSummary();
  const initialResult = listLocalPlanningSnapshotRecords({ kind: "simplified", view: "current", search: "", page: 0 });
  return <>
    <PageHeading eyebrow="PCP · dados locais" title="Simplificadas importadas" description="Ordens ativas e históricas da versão web preservadas como baseline de consulta." />
    <LocalPlanningSnapshots kind="simplified" initialSummary={summary} initialResult={initialResult} />
  </>;
}
