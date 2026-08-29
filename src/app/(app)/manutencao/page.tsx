import { MaintenanceControl } from "@/components/maintenance-control";
import { requirePermission } from "@/lib/local-auth/server";

export default async function Page() {
  await requirePermission("maintenance");
  return (
    <div className="space-y-6 p-6 lg:p-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.18em] text-orange-600">
          Manutenção · Paradas
        </p>
        <h1 className="font-heading mt-1 text-3xl font-bold text-slate-950">
          Central de ocorrências
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Paradas apontadas pela Produção, com contexto completo e tempo de
          atendimento.
        </p>
      </div>
      <MaintenanceControl />
    </div>
  );
}
