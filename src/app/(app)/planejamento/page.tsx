import { PcpPlanningAnalysis } from "@/components/pcp-planning-analysis";
import { PageHeading } from "@/components/page-heading";
import { requirePermission } from "@/lib/local-auth/server";

export default async function PlanningAnalysisPage() {
  await requirePermission("planning");
  return (
    <>
      <PageHeading
        eyebrow="PCP · Inteligência de planejamento"
        title="Carteira e Planejamento"
        description="Cruze a carteira atual, o histórico, as Simplificadas ativas e a vida disponível das ferramentas para decidir o que programar."
      />
      <PcpPlanningAnalysis />
    </>
  );
}
