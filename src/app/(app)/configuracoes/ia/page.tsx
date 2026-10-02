import { BrainCircuit } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { PlanningIntelligenceSettings } from "@/components/planning-intelligence-settings";
import { requireAdmin } from "@/lib/local-auth/server";

export default async function PlanningIntelligenceSettingsPage() {
  await requireAdmin();
  return <>
    <PageHeading eyebrow="Administração · IA" title="Critérios e analista IA do AluPilot" description="Configure regras de decisão, limites operacionais e o provedor de IA fora das telas do chão de fábrica." />
    <div className="mb-5 flex items-start gap-3 rounded-2xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-950">
      <BrainCircuit className="mt-0.5 size-5 shrink-0 text-violet-700" />
      <p><strong>Uso administrativo.</strong> As configurações salvas aqui orientam o planejamento e o assistente. A operação continua validada pelo motor determinístico.</p>
    </div>
    <PlanningIntelligenceSettings />
  </>;
}
