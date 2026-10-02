import { ReportsCenter } from "@/components/reports-center";
import { requirePermission } from "@/lib/local-auth/server";

export default async function ReportsPage() {
  await requirePermission("reports");
  return <ReportsCenter />;
}
