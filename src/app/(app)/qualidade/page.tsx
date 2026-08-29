import { ModulePlaceholder } from "@/components/module-placeholder";
import { requirePermission } from "@/lib/local-auth/server";
export default async function Page(){await requirePermission("quality"); return <ModulePlaceholder title="Qualidade" description="Inspecoes, liberacoes e rastreabilidade por ordem." features={["Planos de inspecao","Registro de nao conformidade","Liberacao de lote"]}/>}
