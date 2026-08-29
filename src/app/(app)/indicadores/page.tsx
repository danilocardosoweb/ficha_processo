import { ModulePlaceholder } from "@/components/module-placeholder";
import { requirePermission } from "@/lib/local-auth/server";
export default async function Page(){await requirePermission("indicators"); return <ModulePlaceholder title="Dashboards" description="Indicadores operacionais e gerenciais da fabrica." features={["OEE por prensa","Produtividade e refugo","Aderencia ao plano"]}/>}
