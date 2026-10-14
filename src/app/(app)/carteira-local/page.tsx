import { notFound } from "next/navigation";
import { LocalPlanningSnapshots } from "@/components/local-planning-snapshots";
import { PageHeading } from "@/components/page-heading";
import { requireCurrentUser } from "@/lib/local-auth/server";
import { isLocalDesktopMode } from "@/lib/local-db/mode";
import { getLocalPlanningSnapshotSummary, listLocalPlanningSnapshotRecords } from "@/lib/local-db/planning-snapshots";

export const dynamic = "force-dynamic";

export default async function LocalPortfolioPage() {
  const user = await requireCurrentUser();
  if (!isLocalDesktopMode() || user.role !== "admin") notFound();
  const summary = getLocalPlanningSnapshotSummary();
  const initialResult = listLocalPlanningSnapshotRecords({ kind: "portfolio", view: "current", search: "", page: 0 });
  return <>
    <PageHeading eyebrow="PCP · dados locais" title="Carteira importada" description="Pedidos preservados da última importação da versão web, com acesso ao histórico completo de snapshots." />
    <LocalPlanningSnapshots kind="portfolio" initialSummary={summary} initialResult={initialResult} />
  </>;
}
