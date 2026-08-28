import { BilletStockManager } from "@/components/billet-stock-manager";
import { PageHeading } from "@/components/page-heading";
import { requireAdmin } from "@/lib/local-auth/server";

export default async function BilletStockPage() {
  await requireAdmin();
  return <>
    <PageHeading eyebrow="Planejamento de materiais" title="Estoque de tarugos" description="Controle barras físicas, lotes, reservas e disponibilidade real por liga." />
    <BilletStockManager />
  </>;
}
