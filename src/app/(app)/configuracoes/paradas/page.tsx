import { StoppageCatalogManager } from "@/components/stoppage-catalog-manager";
import { PageHeading } from "@/components/page-heading";
import { requireAdmin } from "@/lib/local-auth/server";

export default async function StoppageCatalogPage() { await requireAdmin(); return <><PageHeading eyebrow="Administração · Catálogos" title="Paradas e motivos" description="Mantenha os tipos, motivos e encaminhamentos usados nos apontamentos." /><StoppageCatalogManager /></>; }
