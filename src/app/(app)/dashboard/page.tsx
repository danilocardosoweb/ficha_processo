import Link from "next/link";
import {
  ArrowRight,
  Boxes,
  Clock3,
  Gauge,
  PackageCheck,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { DashboardChart } from "@/components/dashboard-chart";
import { PageHeading } from "@/components/page-heading";
import { StatusBadge } from "@/components/status-badge";
import { orders } from "@/data/mock";
import { requireCurrentUser } from "@/lib/local-auth/server";

const kpis = [
  {
    label: "Producao hoje",
    value: "4.294 kg",
    note: "8,4% acima de ontem",
    icon: Boxes,
    color: "text-orange-600 bg-orange-50",
  },
  {
    label: "OEE medio",
    value: "78,6%",
    note: "Meta: 82,0%",
    icon: Gauge,
    color: "text-blue-600 bg-blue-50",
  },
  {
    label: "Ordens em curso",
    value: "03",
    note: "11 na programacao",
    icon: Clock3,
    color: "text-violet-600 bg-violet-50",
  },
  {
    label: "Concluidas",
    value: "07",
    note: "63% do plano diario",
    icon: PackageCheck,
    color: "text-emerald-600 bg-emerald-50",
  },
];

export default async function DashboardPage() {
  const user = await requireCurrentUser();
  const firstName = user.display_name.trim().split(/\s+/)[0] || user.username;
  const canImport = user.role === "admin" || user.role === "pcp";
  return (
    <>
      <PageHeading
        eyebrow="Centro de operacoes"
        title={`Bom dia, ${firstName}`}
        description="Acompanhe a programacao e o ritmo das prensas neste turno."
        action={canImport ? (
          <Button
            render={<Link href="/importar" />}
            className="bg-orange-500 hover:bg-orange-600"
          >
            Importar programacao <ArrowRight className="size-4" />
          </Button>
        ) : undefined}
      />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="gap-3 border-0 py-5 shadow-sm">
            <CardContent className="flex items-start justify-between px-5">
              <div>
                <p className="text-xs font-medium text-slate-500">
                  {kpi.label}
                </p>
                <p className="font-heading mt-2 text-2xl font-extrabold tracking-tight">
                  {kpi.value}
                </p>
                <p className="mt-1 text-[11px] text-slate-400">{kpi.note}</p>
              </div>
              <span
                className={`grid size-10 place-items-center rounded-xl ${kpi.color}`}
              >
                <kpi.icon className="size-5" />
              </span>
            </CardContent>
          </Card>
        ))}
      </section>
      <section className="mt-5 grid gap-5 xl:grid-cols-[1.55fr_1fr]">
        <Card className="border-0 shadow-sm">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle className="font-heading text-base">
                Producao por hora
              </CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                Volume extrudado x meta do turno
              </p>
            </div>
            <div className="flex gap-4 text-[11px] text-slate-500">
              <span className="flex items-center gap-1.5">
                <i className="size-2 rounded-full bg-orange-500" />
                Real
              </span>
              <span className="flex items-center gap-1.5">
                <i className="size-2 rounded-full bg-slate-300" />
                Meta
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <DashboardChart />
          </CardContent>
        </Card>
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="font-heading text-base">
              Status das prensas
            </CardTitle>
            <p className="text-xs text-slate-500">
              Atualizado ha poucos segundos
            </p>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,.12)]" />
                  <b className="text-sm">Prensa 1800T</b>
                </div>
                <span className="text-[11px] font-semibold text-emerald-700">
                  PRODUZINDO
                </span>
              </div>
              <p className="mt-3 font-mono text-xs text-slate-500">
                OP 126330010 · TP-8221
              </p>
              <div className="mt-3 flex items-center gap-3">
                <Progress value={57} className="h-1.5 flex-1" />
                <b className="text-xs">57%</b>
              </div>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <TriangleAlert className="size-4 text-amber-500" />
                  <b className="text-sm">Prensa 2500T</b>
                </div>
                <span className="text-[11px] font-semibold text-amber-700">
                  AGUARDANDO
                </span>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Troca de ferramenta · 18 min
              </p>
            </div>
          </CardContent>
        </Card>
      </section>
      <Card className="mt-5 border-0 shadow-sm">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="font-heading text-base">
              Ordens prioritarias
            </CardTitle>
            <p className="mt-1 text-xs text-slate-500">
              Sequenciamento atual das prensas
            </p>
          </div>
          <Button
            variant="ghost"
            render={<Link href="/ordens" />}
            className="text-xs text-orange-600"
          >
            Ver todas <ArrowRight className="size-3.5" />
          </Button>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-left text-xs">
            <thead className="border-b text-[10px] uppercase tracking-wider text-slate-400">
              <tr>
                <th className="pb-3 font-semibold">Ordem</th>
                <th className="pb-3 font-semibold">Prensa</th>
                <th className="pb-3 font-semibold">Ferramenta</th>
                <th className="pb-3 font-semibold">Cliente</th>
                <th className="pb-3 font-semibold">Programado</th>
                <th className="pb-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.slice(0, 4).map((order) => (
                <tr key={order.id} className="border-b last:border-0">
                  <td className="py-4 font-mono font-semibold">
                    {order.order_number}
                  </td>
                  <td>{order.machine_code}</td>
                  <td className="font-mono">{order.tool_code}</td>
                  <td>{order.customer_name}</td>
                  <td>{order.target_kg == null ? `${order.target_quantity?.toLocaleString("pt-BR") ?? 0} ${order.demand_unit === "bars" ? "barras" : "peças"}` : `${order.target_kg.toLocaleString("pt-BR")} kg`}</td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </>
  );
}
