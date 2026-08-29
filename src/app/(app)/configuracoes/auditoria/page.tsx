import { AuditReconciliationCenter } from "@/components/audit-reconciliation-center";
import { PageHeading } from "@/components/page-heading";
import { requirePermission } from "@/lib/local-auth/server";

export default async function AuditPage() {
  await requirePermission("audit");

  return (
    <>
      <PageHeading
        eyebrow="Administração · rastreabilidade"
        title="Auditoria e conciliação"
        description="Consulte o setup realmente utilizado, acompanhe mudanças e confronte o TecnoMES com o relatório de apontamentos da empresa."
      />
      <AuditReconciliationCenter />
    </>
  );
}
