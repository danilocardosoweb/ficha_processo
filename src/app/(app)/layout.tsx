import { AppShell } from "@/components/app-shell";
import { requireCurrentUser } from "@/lib/local-auth/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireCurrentUser();
  return <AppShell user={user}>{children}</AppShell>;
}
