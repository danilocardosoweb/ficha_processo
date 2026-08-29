import { MessagesManager } from "@/components/messages-manager";
import { PageHeading } from "@/components/page-heading";
import { requirePermission } from "@/lib/local-auth/server";

export default async function MessagesPage() {
  await requirePermission("messages");
  return <><PageHeading eyebrow="Comunicação operacional" title="Mensagens e prioridades" description="Publique avisos segmentados e acompanhe quem recebeu e confirmou a leitura." /><MessagesManager /></>;
}
