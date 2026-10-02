import { requirePermission } from "@/lib/local-auth/server";
import { readProgram } from "@/modules/machine-load-v2/data";
import { V3PlanningWorkspace } from "@/components/machine-load-v3/planning-workspace";
import Link from "next/link";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";
export default async function MachineLoadV3Page() {
  const user = await requirePermission("simulation");
  const snapshot = await readProgram(user);
  return <div className="space-y-6"><div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"><nav className="flex gap-2" aria-label="Bases da Carga Máquina"><Link className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white" href="/carga-maquina/v3" aria-current="page">Base Oficial</Link><Link className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50" href="/carga-maquina">Base Teste · IA</Link></nav><span className="px-3 text-xs text-slate-500">Sequência oficial preservada</span></div><V3PlanningWorkspace snapshot={snapshot} /></div>;
}
