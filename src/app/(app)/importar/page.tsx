import { Download } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { SimplifiedImport } from "@/components/simplified-import";
import { Button } from "@/components/ui/button";
import { requirePermission } from "@/lib/local-auth/server";
export default async function ImportPage() {
  await requirePermission("import");
  return (
    <>
      <PageHeading
        eyebrow="PCP · Importação"
        title="Importar Simplificada"
        description="Carregue o Excel do PCP, valide os itens ativos e crie as ordens."
        action={
          <Button
            nativeButton={false}
            variant="outline"
            render={<a href="/modelo-simplificada.csv" download />}
          >
            <Download className="size-4" />
            Baixar modelo
          </Button>
        }
      />
      <SimplifiedImport />
    </>
  );
}
