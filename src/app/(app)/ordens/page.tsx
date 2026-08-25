import Link from "next/link";
import { Download, Plus } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { OrdersTable } from "@/components/orders-table";
import { Button } from "@/components/ui/button";
import { listSimplifiedQueues } from "@/modules/pcp/orders-repository";

export const dynamic = "force-dynamic";

export default async function OrdersPage() {
  const queues = await listSimplifiedQueues();
  return (
    <>
      <PageHeading
        eyebrow="PCP · FIFO"
        title="Fila de Simplificadas"
        description="Acompanhe os Planos pela ordem de importação. Expanda somente quando precisar consultar as ordens."
        action={
          <div className="flex gap-2">
            <Button variant="outline">
              <Download className="size-4" />
              Exportar
            </Button>
            <Button
              render={<Link href="/importar" />}
              className="bg-orange-500 hover:bg-orange-600"
            >
              <Plus className="size-4" />
              Importar Simplificada
            </Button>
          </div>
        }
      />
      <OrdersTable queues={queues} />
    </>
  );
}
