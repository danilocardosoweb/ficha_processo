import Link from "next/link";
import { ArrowRight, Clock3, Factory, FileCog, Megaphone, Settings2, UserRound, UsersRound, Wrench, CircleStop } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { requireAdmin } from "@/lib/local-auth/server";

const registrationCards = [
  { title: "Prensas", description: "Equipamentos disponíveis para planejamento e produção.", href: "/prensas", icon: Factory },
  { title: "Fichas de processo", description: "Receitas, parâmetros técnicos e sequências das ferramentas.", href: "/engenharia", icon: FileCog },
  { title: "Ferramentas", description: "Matrizes físicas, vida útil e histórico importado.", href: "/ferramentas", icon: Wrench },
  { title: "Turnos e produção", description: "Horários, produtividade padrão e premissas da simulação.", href: "/configuracoes/producao", icon: Clock3 },
  { title: "Paradas e motivos", description: "Catálogo de ocorrências para Produção e Manutenção.", href: "/configuracoes/paradas", icon: CircleStop },
];

export default async function SettingsPage() {
  await requireAdmin();
  return (
    <>
      <PageHeading eyebrow="Administração" title="Configurações" description="Cadastros e preferências organizados em um único lugar, sem ocupar o fluxo diário da operação." />
      <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b px-5 py-4 md:px-6">
          <span className="grid size-10 place-items-center rounded-xl bg-orange-50 text-orange-600"><Settings2 className="size-5" /></span>
          <div><h2 className="font-heading text-lg font-bold text-slate-900">Cadastros industriais</h2><p className="text-sm text-slate-500">Bases utilizadas pelo PCP, Engenharia e chão de fábrica.</p></div>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5 md:p-6">
          {registrationCards.map((item) => (
            <Link key={item.href} href={item.href} className="group rounded-2xl border bg-slate-50/70 p-5 transition hover:-translate-y-0.5 hover:border-orange-200 hover:bg-orange-50/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40">
              <div className="flex items-start justify-between gap-4">
                <span className="grid size-11 place-items-center rounded-xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 transition group-hover:text-orange-600"><item.icon className="size-5" /></span>
                <ArrowRight className="size-5 text-slate-300 transition group-hover:translate-x-1 group-hover:text-orange-500" />
              </div>
              <h3 className="mt-5 font-heading text-base font-bold text-slate-900">{item.title}</h3>
              <p className="mt-1.5 min-h-10 text-sm leading-5 text-slate-500">{item.description}</p>
            </Link>
          ))}
        </div>
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
          <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-orange-50 text-orange-600"><Megaphone className="size-5" /></span><div><h2 className="font-heading font-bold text-slate-900">Mensagens e prioridades</h2><p className="text-sm text-slate-500">Direcione alertas para toda a operação, uma prensa, um perfil ou usuário.</p></div></div>
          <Link href="/mensagens" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-orange-600 px-4 text-sm font-semibold text-white transition hover:bg-orange-700">Abrir central <ArrowRight className="size-4" /></Link>
        </div>
      </section>
      <section className="mt-5 overflow-hidden rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
          <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-orange-50 text-orange-600"><UsersRound className="size-5" /></span><div><h2 className="font-heading font-bold text-slate-900">Usuários e permissões</h2><p className="text-sm text-slate-500">Cadastre operadores, defina perfis, prensas e senhas.</p></div></div>
          <Link href="/usuarios" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800">Administrar usuários <ArrowRight className="size-4" /></Link>
        </div>
      </section>
      <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm md:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl bg-slate-100 text-slate-600"><UserRound className="size-5" /></span>
            <div><h2 className="font-heading font-bold text-slate-900">Perfil e acesso</h2><p className="text-sm text-slate-500">Consulte sua identificação usada nos registros e auditorias.</p></div>
          </div>
          <Link href="/perfil" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">Abrir meu perfil <ArrowRight className="size-4" /></Link>
        </div>
      </section>
    </>
  );
}
