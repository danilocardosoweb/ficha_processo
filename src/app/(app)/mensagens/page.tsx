import { MessagesManager } from "@/components/messages-manager";
import { PageHeading } from "@/components/page-heading";
import { requireCurrentUser } from "@/lib/local-auth/server";
import { redirect } from "next/navigation";

export default async function MessagesPage() {
  const user = await requireCurrentUser();
  if (!(["admin", "pcp"] as string[]).includes(user.role)) redirect("/dashboard");
  return <><PageHeading eyebrow="Comunicação operacional" title="Mensagens e prioridades" description="Publique avisos segmentados e acompanhe quem recebeu e confirmou a leitura." /><MessagesManager /></>;
}

