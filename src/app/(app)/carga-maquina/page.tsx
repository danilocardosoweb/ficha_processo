import { MachineLoadSimulator } from "@/components/machine-load-simulator";
import { PageHeading } from "@/components/page-heading";
import { requirePermission } from "@/lib/local-auth/server";
import Link from "next/link";

export default async function MachineLoadPage() {
  await requirePermission("simulation");
  return <><div className="mb-5 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm"><nav className="flex flex-wrap gap-2" aria-label="Bases da Carga Máquina"><Link href="/carga-maquina/v3" className="rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50">Base Oficial</Link><Link href="/carga-maquina" aria-current="page" className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white shadow-sm ring-2 ring-slate-200">Base Teste · IA</Link></nav></div><PageHeading eyebrow="PCP · Base Teste" title="Carga Máquina" description="Ambiente de simulação para testar hipóteses, IA e regras antes de evoluir a Base Oficial." /><MachineLoadSimulator /></>;
}
