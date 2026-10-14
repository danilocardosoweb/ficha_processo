import { Archive, CheckCircle2, ChartNoAxesCombined, Database, HardDrive, ListOrdered, Network, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/local-auth/server";
import { localDatabaseStatus } from "@/lib/local-db/database";
import { isLocalDesktopMode } from "@/lib/local-db/mode";
import { getLocalPlanningSnapshotSummary } from "@/lib/local-db/planning-snapshots";
import { createSharedDataStore } from "@/lib/local-db/shared-data-store.mjs";

export const dynamic = "force-dynamic";

export default async function LocalHomePage() {
  const status = isLocalDesktopMode() ? localDatabaseStatus() : null;
  const user = await getCurrentUser();
  const canMaintainCatalogs = user && ["admin", "manager", "pcp", "engineering"].includes(user.role);
  const planningSummary = isLocalDesktopMode() && user?.role === "admin" ? getLocalPlanningSnapshotSummary() : null;
  const shared = isLocalDesktopMode()
    ? await createSharedDataStore().readManifest().then((manifest) => ({ connected: true, generation: manifest.generation, tables: Object.keys(manifest.tables).length })).catch(() => ({ connected: false, generation: 0, tables: 0 }))
    : null;
  return <section className="mx-auto max-w-4xl space-y-6">
    <div className="rounded-3xl border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-white p-6 shadow-sm sm:p-8">
      <span className="grid size-12 place-items-center rounded-2xl bg-orange-500 text-white"><HardDrive className="size-6" /></span>
      <p className="mt-5 text-xs font-bold uppercase tracking-[.2em] text-orange-600">TecnoMES Local</p>
      <h1 className="mt-2 font-heading text-3xl font-extrabold tracking-tight text-slate-900">Aplicativo instalado neste computador</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">Os cadastros locais e os dados históricos da versão web já estão preservados no SQLite deste computador. Os módulos que ainda não foram ligados ao banco local permanecem disponíveis para consulta no arquivo importado.</p>
    </div>
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <article className="rounded-2xl border bg-white p-5"><Database className="size-5 text-emerald-600" /><p className="mt-4 text-sm font-bold text-slate-900">Banco local</p><p className="mt-1 text-sm text-slate-500">SQLite em modo {status?.journalMode?.toUpperCase() ?? "WAL"}, salvo somente nesta máquina.</p></article>
      <article className="rounded-2xl border bg-white p-5"><Network className={`size-5 ${shared?.connected ? "text-blue-600" : "text-rose-600"}`} /><p className="mt-4 text-sm font-bold text-slate-900">Base compartilhada</p><p className="mt-1 text-sm text-slate-500">{shared?.connected ? `W:\\App_Prensa acessível · geração ${shared.generation} · ${shared.tables} tabela(s). Ainda não sincronizada com as telas.` : "W:\\App_Prensa indisponível. Nenhuma gravação pode ser considerada compartilhada."}</p></article>
      <article className="rounded-2xl border bg-white p-5"><ShieldCheck className="size-5 text-emerald-600" /><p className="mt-4 text-sm font-bold text-slate-900">Acesso individual</p><p className="mt-1 text-sm text-slate-500">Administrador e sessão local configurados sem senha padrão no aplicativo.</p></article>
      <article className="rounded-2xl border bg-white p-5"><CheckCircle2 className="size-5 text-emerald-600" /><p className="mt-4 text-sm font-bold text-slate-900">Fundação validada</p><p className="mt-1 text-sm text-slate-500">{status?.migrationCount ?? 0} migração local aplicada{status?.migrationCount === 1 ? "" : "s"}.</p></article>
    </div>
    {canMaintainCatalogs && <div className="grid gap-4 sm:grid-cols-2">
      <Link href="/prensas" className="rounded-2xl border bg-white p-5 transition hover:border-orange-300 hover:shadow-sm"><p className="font-bold text-slate-900">Cadastro de prensas</p><p className="mt-1 text-sm text-slate-500">Inclua e atualize os equipamentos desta instalação.</p></Link>
      <Link href="/ferramentas" className="rounded-2xl border bg-white p-5 transition hover:border-orange-300 hover:shadow-sm"><p className="font-bold text-slate-900">Cadastro de ferramentas</p><p className="mt-1 text-sm text-slate-500">Registre matriz, sequência, medidas e situação.</p></Link>
    </div>}
    {user?.role === "admin" && <Link href="/dados-importados" className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 transition hover:border-emerald-300 hover:shadow-sm"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-emerald-700"><Archive className="size-5" /></span><span><strong className="block text-slate-900">Consultar dados importados</strong><span className="mt-1 block text-sm text-slate-600">Pesquise o histórico trazido da versão web sem alterar os registros.</span></span></Link>}
    {planningSummary && <div className="grid gap-4 sm:grid-cols-2">
      <Link href="/carteira-local" className="flex items-start gap-3 rounded-2xl border bg-white p-5 transition hover:border-orange-300 hover:shadow-sm"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600"><ChartNoAxesCombined className="size-5" /></span><span><strong className="block text-slate-900">Carteira importada · {planningSummary.currentPortfolioRows.toLocaleString("pt-BR")} pedidos atuais</strong><span className="mt-1 block text-sm text-slate-600">Consulte o último snapshot e o histórico de {planningSummary.portfolioRows.toLocaleString("pt-BR")} linhas.</span></span></Link>
      <Link href="/simplificadas-local" className="flex items-start gap-3 rounded-2xl border bg-white p-5 transition hover:border-orange-300 hover:shadow-sm"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600"><ListOrdered className="size-5" /></span><span><strong className="block text-slate-900">Simplificadas · {planningSummary.activeSimplifiedOrders.toLocaleString("pt-BR")} ordens ativas</strong><span className="mt-1 block text-sm text-slate-600">Consulte o baseline preservado e o histórico completo sem editar a sequência original.</span></span></Link>
    </div>}
    {user && ["admin", "manager", "pcp", "engineering"].includes(user.role) && <Link href="/fila-programacao" className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 p-5 transition hover:border-blue-300 hover:shadow-sm"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-blue-700"><ListOrdered className="size-5" /></span><span><strong className="block text-slate-900">Fila compartilhada da programação</strong><span className="mt-1 block text-sm text-slate-600">Organize a vez de edição entre computadores pela pasta W:\App_Prensa.</span></span></Link>}
    <article className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950"><p className="font-bold">O que ainda está em migração</p><p className="mt-1">Carteira e Simplificadas agora têm consulta local somente leitura. Edição/publicação do planejamento, importação de novas planilhas, forno, produção e apontamentos ainda precisam ser migrados e validados antes do uso operacional em produção.</p></article>
  </section>;
}
