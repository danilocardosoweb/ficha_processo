import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/local-auth/server";
import { hasLocalUsers } from "@/lib/local-db/auth";
import { isLocalDesktopMode } from "@/lib/local-db/mode";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  const canConfigureFirstAccess = isLocalDesktopMode() && !hasLocalUsers();
  return <LoginForm canConfigureFirstAccess={canConfigureFirstAccess} />;
}
