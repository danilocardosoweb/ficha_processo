"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type HourlyProduction = { hour: string; produced_kg: number };

export function DashboardChart({ data }: { data: HourlyProduction[] }) {
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 5, left: -18, bottom: 0 }}>
          <defs><linearGradient id="dashboardProduction" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f97316" stopOpacity={0.3} /><stop offset="100%" stopColor="#f97316" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="#e8e5df" strokeDasharray="3 3" />
          <XAxis dataKey="hour" axisLine={false} tickLine={false} interval={2} tick={{ fontSize: 10, fill: "#94a3b8" }} dy={8} />
          <YAxis axisLine={false} tickLine={false} width={48} tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(value) => `${Number(value).toLocaleString("pt-BR")} kg`} />
          <Tooltip formatter={(value) => [`${Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`, "Produção"]} contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0", boxShadow: "0 8px 30px rgba(15,23,42,.08)", fontSize: 12 }} />
          <Area type="monotone" dataKey="produced_kg" stroke="#f97316" fill="url(#dashboardProduction)" strokeWidth={2.5} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
