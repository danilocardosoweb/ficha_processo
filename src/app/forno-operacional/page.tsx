import { OvenOperational } from "@/components/oven-operational";
import { requirePermission } from "@/lib/local-auth/server";

export default async function OvenOperationalPage() {
  const user = await requirePermission("oven");
  return <OvenOperational user={user} />;
}
