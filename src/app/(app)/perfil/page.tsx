import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { ProfileSettings } from "@/components/profile-settings";
import { requireCurrentUser } from "@/lib/local-auth/server";

export default async function ProfilePage() {
  const user = await requireCurrentUser();
  return <><PageHeading eyebrow="Conta" title="Meu perfil" description="Identificação e senha utilizadas nos registros e auditorias." action={user.role === "admin" ? <Link href="/configuracoes" className="inline-flex h-10 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"><ArrowLeft className="size-4" />Configurações</Link> : undefined} /><ProfileSettings user={user} /></>;
}
