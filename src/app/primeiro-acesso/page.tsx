import { redirect } from "next/navigation";
import { FirstAccessForm } from "@/components/first-access-form";
import { hasLocalUsers } from "@/lib/local-db/auth";
import { isLocalDesktopMode } from "@/lib/local-db/mode";

export const dynamic = "force-dynamic";

export default function FirstAccessPage() {
  if (!isLocalDesktopMode() || hasLocalUsers()) redirect("/login");
  return <FirstAccessForm />;
}
