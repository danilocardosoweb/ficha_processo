import { UsersManager } from "@/components/users-manager";
import { PageHeading } from "@/components/page-heading";
import { listLocalUsers, requireAdmin } from "@/lib/local-auth/server";

export default async function UsersPage() {
  const user = await requireAdmin();
  const users = await listLocalUsers();
  return <><PageHeading eyebrow="Administração" title="Usuários e acessos" description="Cadastre operadores, defina perfis e mantenha a rastreabilidade de cada ação no sistema." /><UsersManager initialUsers={users} currentUserId={user.user_id} /></>;
}
