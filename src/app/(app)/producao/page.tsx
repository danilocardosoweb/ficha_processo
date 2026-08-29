import { ProductionCockpit } from "@/components/production-cockpit";
import { requirePermission } from "@/lib/local-auth/server";

export default async function Page() {
  await requirePermission("production");
  return <div className="-m-4 md:-m-8"><ProductionCockpit /></div>;
}
