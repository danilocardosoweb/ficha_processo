import { ToolOvenBoard } from "@/components/tool-oven-board";
import { requirePermission } from "@/lib/local-auth/server";

export default async function Page() {
  await requirePermission("oven");
  return <ToolOvenBoard />;
}
