"use client";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { hourlyProduction } from "@/data/mock";

export function DashboardChart() {
  return <div className="h-[260px] w-full"><ResponsiveContainer width="100%" height="100%"><AreaChart data={hourlyProduction} margin={{ top:10, right:5, left:-24, bottom:0 }}><defs><linearGradient id="fillOrange" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f97316" stopOpacity={.3}/><stop offset="100%" stopColor="#f97316" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#e8e5df" strokeDasharray="3 3"/><XAxis dataKey="hora" axisLine={false} tickLine={false} tick={{ fontSize:11, fill:"#94a3b8" }} dy={10}/><YAxis axisLine={false} tickLine={false} tick={{ fontSize:11, fill:"#94a3b8" }}/><Tooltip contentStyle={{ borderRadius:10, border:"1px solid #e2e8f0", boxShadow:"0 8px 30px rgba(15,23,42,.08)", fontSize:12 }}/><Area type="monotone" dataKey="meta" stroke="#cbd5e1" strokeDasharray="5 5" fill="transparent" strokeWidth={2}/><Area type="monotone" dataKey="produzido" stroke="#f97316" fill="url(#fillOrange)" strokeWidth={2.5}/></AreaChart></ResponsiveContainer></div>;
}
