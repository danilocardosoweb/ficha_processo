import Link from "next/link";
import { AlertTriangle, ArrowRight, Boxes, CheckCircle2, Clock3, PackageCheck, Radio, TriangleAlert } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { DashboardChart } from "@/components/dashboard-chart";
import { DashboardLiveRefresh } from "@/components/dashboard-live-refresh";
import { PageHeading } from "@/components/page-heading";
import { StatusBadge } from "@/components/status-badge";
import { getDashboardSnapshot } from "@/lib/dashboard";
import { requireCurrentUser } from "@/lib/local-auth/server";
import { roleLabels, userInitials } from "@/lib/local-auth/types";

const number = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("pt-BR", { minimumIntegerDigits: 2 });

function formatKg(value: number) { return `${number.format(value)} kg`; }
function comparison(today: number, yesterday: number) {
  if (today === 0) return "Sem produção concluída hoje";
  if (yesterday === 0) return "Sem produção registrada ontem";
  const difference = ((today - yesterday) / yesterday) * 100;
  return `${Math.abs(difference).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% ${difference >= 0 ? "acima" : "abaixo"} de ontem`;
}
function demand(order: Awaited<ReturnType<typeof getDashboardSnapshot>>["priority_orders"][number]) {
  if (order.demand_unit === "kg") return formatKg(order.target_kg ?? 0);
  return `${number.format(order.target_quantity ?? 0)} ${order.demand_unit === "bars" ? "barras" : "peças"}`;
}
function dateTime(value: string) { return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }

export default async function DashboardPage() {
  const [user, snapshot] = await Promise.all([requireCurrentUser(), getDashboardSnapshot()]);
  const firstName = user.display_name.trim().split(/\s+/)[0] || user.username;
  const canImport = user.role === "admin" || user.role === "pcp";
  const kpis = [
    { label: "Produção concluída hoje", value: formatKg(snapshot.kpis.production_today_kg), note: comparison(snapshot.kpis.production_today_kg, snapshot.kpis.production_yesterday_kg), icon: Boxes, color: "text-orange-600 bg-orange-50" },
    { label: "Itens em andamento", value: integer.format(snapshot.kpis.in_progress_orders), note: `${snapshot.kpis.queued_orders.toLocaleString("pt-BR")} item(ns) aguardando na fila`, icon: Clock3, color: "text-violet-600 bg-violet-50" },
    { label: "Paradas abertas", value: integer.format(snapshot.kpis.open_stoppages), note: snapshot.kpis.open_stoppages ? "Exigem acompanhamento" : "Nenhuma ocorrência aberta", icon: AlertTriangle, color: snapshot.kpis.open_stoppages ? "text-red-600 bg-red-50" : "text-emerald-600 bg-emerald-50" },
    { label: "Concluídas hoje", value: integer.format(snapshot.kpis.completed_today), note: "Itens com apontamento de encerramento", icon: PackageCheck, color: "text-emerald-600 bg-emerald-50" },
  ];

  return <>
    <DashboardLiveRefresh />
    <PageHeading eyebrow="Centro de operações" title={`Bom dia, ${firstName}`} description="Indicadores calculados com os apontamentos reais do sistema." action={canImport ? <Button render={<Link href="/importar" />} className="bg-orange-500 hover:bg-orange-600">Importar programação <ArrowRight className="size-4" /></Button> : undefined} />
    {!snapshot.available && <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><TriangleAlert className="size-4" />Não foi possível atualizar os indicadores agora. Nenhum valor demonstrativo foi exibido.</div>}
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {kpis.map((kpi) => <Card key={kpi.label} className="gap-3 border-0 py-4 shadow-sm"><CardContent className="flex items-start justify-between px-5"><div className="min-w-0"><p className="text-xs font-medium text-slate-500">{kpi.label}</p><p className="font-heading mt-1.5 text-2xl font-extrabold tracking-tight">{kpi.value}</p><p className="mt-1 truncate text-[11px] text-slate-400">{kpi.note}</p></div><span className={`grid size-10 shrink-0 place-items-center rounded-xl ${kpi.color}`}><kpi.icon className="size-5" /></span></CardContent></Card>)}
    </section>
    <section className="mt-4 grid gap-4 xl:grid-cols-[1.45fr_1fr]">
      <Card className="border-0 shadow-sm"><CardHeader className="flex-row items-center justify-between pb-2"><div><CardTitle className="font-heading text-base">Produção concluída por hora</CardTitle><p className="mt-1 text-xs text-slate-500">Volume informado no encerramento dos itens de hoje.</p></div><span className="flex items-center gap-1.5 text-[11px] text-slate-500"><i className="size-2 rounded-full bg-orange-500" />Real</span></CardHeader><CardContent><DashboardChart data={snapshot.hourly_production} /></CardContent></Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <Card className="border-0 shadow-sm"><CardHeader className="flex-row items-center justify-between pb-2"><div><CardTitle className="font-heading text-base">Pessoas online</CardTitle><p className="mt-1 text-xs text-slate-500">Atividade nos últimos 2 minutos</p></div><span className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-sm font-bold text-emerald-700"><Radio className="size-3.5" />{snapshot.online_users.length}</span></CardHeader><CardContent className="space-y-2">
          {snapshot.online_users.slice(0, 6).map((online) => <div key={online.id} className="flex items-center gap-3 rounded-xl border bg-slate-50/60 p-2.5"><div className="relative"><Avatar className="size-8"><AvatarFallback className="text-[10px] font-bold">{userInitials(online.display_name)}</AvatarFallback></Avatar><span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-white bg-emerald-500" /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-slate-900">{online.display_name}</p><p className="truncate text-[10px] text-slate-500">{roleLabels[online.role]} · {online.machine_codes.length ? `P${online.machine_codes.join(" · P")}` : "Todas as prensas"}</p></div></div>)}
          {!snapshot.online_users.length && <div className="grid min-h-20 place-items-center text-xs text-slate-500">Nenhum usuário com atividade recente.</div>}
          {user.role === "admin" && <Button variant="ghost" size="sm" render={<Link href="/usuarios" />} className="w-full text-orange-600">Ver equipe <ArrowRight className="size-3.5" /></Button>}
        </CardContent></Card>
        <Card className="border-0 shadow-sm"><CardHeader className="pb-2"><CardTitle className="font-heading text-base">Status das prensas</CardTitle><p className="text-xs text-slate-500">Ordens e paradas registradas agora</p></CardHeader><CardContent className="space-y-2">
          {snapshot.machines.map((machine) => { const stopped = machine.status === "stopped"; const producing = machine.status === "producing"; return <div key={machine.code} className={`rounded-xl border p-3 ${stopped ? "border-red-100 bg-red-50/60" : producing ? "border-emerald-100 bg-emerald-50/60" : "bg-slate-50/70"}`}><div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2"><span className={`size-2.5 rounded-full ${stopped ? "bg-red-500" : producing ? "bg-emerald-500" : "bg-slate-400"}`} /><b className="text-xs">{machine.name}</b></div><span className={`text-[9px] font-bold ${stopped ? "text-red-700" : producing ? "text-emerald-700" : "text-slate-500"}`}>{stopped ? "PARADA" : producing ? "PRODUZINDO" : "DISPONÍVEL"}</span></div>{producing && <><p className="mt-2 truncate font-mono text-[10px] text-slate-500">{machine.order_number} · {machine.tool_code}</p><div className="mt-2 flex items-center gap-2"><Progress value={machine.progress} className="h-1.5 flex-1" /><b className="text-[10px]">{number.format(machine.progress)}%</b></div></>}{stopped && <p className="mt-2 truncate text-[10px] text-red-700">{machine.stoppage_reason || "Ocorrência em aberto"}</p>}{!producing && !stopped && <p className="mt-2 text-[10px] text-slate-500">Sem ordem iniciada.</p>}</div>; })}
          {!snapshot.machines.length && <div className="grid min-h-20 place-items-center text-xs text-slate-500">Nenhuma prensa ativa cadastrada.</div>}
        </CardContent></Card>
      </div>
    </section>
    <Card className="mt-4 border-0 shadow-sm"><CardHeader className="flex-row items-center justify-between pb-2"><div><CardTitle className="font-heading text-base">Fila prioritária</CardTitle><p className="mt-1 text-xs text-slate-500">Em produção primeiro; depois prazo e sequência.</p></div><div className="flex items-center gap-3"><span className="hidden text-[10px] text-slate-400 md:inline">{snapshot.available ? `Atualizado ${dateTime(snapshot.generated_at)}` : "Aguardando sincronização"}</span><Button variant="ghost" render={<Link href="/ordens" />} className="text-xs text-orange-600">Ver todas <ArrowRight className="size-3.5" /></Button></div></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-xs"><thead className="border-b text-[10px] uppercase tracking-wider text-slate-400"><tr><th className="pb-3 font-semibold">Ordem / Plano</th><th className="pb-3 font-semibold">Prensa</th><th className="pb-3 font-semibold">Ferramenta</th><th className="pb-3 font-semibold">Cliente</th><th className="pb-3 font-semibold">Demanda</th><th className="pb-3 font-semibold">Prazo</th><th className="pb-3 font-semibold">Status</th></tr></thead><tbody>{snapshot.priority_orders.map((order) => <tr key={order.order_number} className="border-b last:border-0"><td className="py-3 font-mono font-semibold"><div>{order.order_number}</div>{order.plan_code && <span className="font-sans text-[10px] font-normal text-slate-400">Plano {order.plan_code}</span>}</td><td>{order.machine_code}</td><td className="font-mono text-orange-600">{order.tool_code}</td><td className="max-w-48 truncate">{order.customer_name || "—"}</td><td>{demand(order)}</td><td>{order.due_date ? new Intl.DateTimeFormat("pt-BR").format(new Date(`${order.due_date}T12:00:00`)) : "—"}</td><td><StatusBadge status={order.status} /></td></tr>)}</tbody></table>{!snapshot.priority_orders.length && <div className="grid min-h-28 place-items-center"><div className="text-center"><CheckCircle2 className="mx-auto mb-2 size-6 text-emerald-500" /><p className="text-sm font-semibold">Nenhum item pendente na fila.</p></div></div>}</CardContent></Card>
  </>;
}
