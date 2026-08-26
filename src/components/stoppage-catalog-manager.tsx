"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createClient } from "@/lib/supabase/client";

type Catalog = { id: string; catalog_type: "stoppage_type" | "stoppage_reason"; code: string; label: string; group_code: string | null; responsible_department: string | null; routes_to_maintenance: boolean; sort_order: number; is_active: boolean };
const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;

export function StoppageCatalogManager() {
  const [rows, setRows] = useState<Catalog[]>([]); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [message, setMessage] = useState("");
  const [form, setForm] = useState({ type: "stoppage_reason", code: "", label: "", groupCode: "E", department: "Manutenção", routes: true });
  const load = useCallback(async () => { if (!organizationId) return; setLoading(true); const { data, error } = await createClient().from("operational_catalogs").select("id,catalog_type,code,label,group_code,responsible_department,routes_to_maintenance,sort_order,is_active").eq("organization_id", organizationId).in("catalog_type", ["stoppage_type", "stoppage_reason"]).order("catalog_type").order("sort_order"); if (error) setMessage(error.message); else setRows((data ?? []) as Catalog[]); setLoading(false); }, []);
  // The catalog is loaded once when the client component mounts.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  const types = useMemo(() => rows.filter((row) => row.catalog_type === "stoppage_type"), [rows]); const reasons = useMemo(() => rows.filter((row) => row.catalog_type === "stoppage_reason"), [rows]);
  async function save(event: React.FormEvent) { event.preventDefault(); if (!organizationId || !form.code.trim() || !form.label.trim()) return; setSaving(true); setMessage(""); const { error } = await createClient().from("operational_catalogs").upsert({ organization_id: organizationId, catalog_type: form.type, code: form.code.trim().toUpperCase(), label: form.label.trim(), group_code: form.type === "stoppage_reason" ? form.groupCode : null, responsible_department: form.department || null, routes_to_maintenance: form.routes, sort_order: rows.length + 1, is_active: true }, { onConflict: "organization_id,catalog_type,code" }); if (error) setMessage(error.message); else { setMessage("Cadastro salvo e disponível nos apontamentos."); setForm({ ...form, code: "", label: "" }); await load(); } setSaving(false); }
  async function toggle(row: Catalog) { const { error } = await createClient().from("operational_catalogs").update({ is_active: !row.is_active }).eq("id", row.id); if (error) setMessage(error.message); else setRows((current) => current.map((item) => item.id === row.id ? { ...item, is_active: !item.is_active } : item)); }
  return <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="flex items-center gap-3 border-b px-5 py-4"><span className="grid size-10 place-items-center rounded-xl bg-orange-50 text-orange-600"><Wrench className="size-5" /></span><div><h2 className="font-heading text-lg font-bold text-slate-900">Catálogo de paradas</h2><p className="text-sm text-slate-500">Tipos e motivos exibidos nos apontamentos de Produção e Manutenção.</p></div></div><form onSubmit={save} className="grid gap-3 border-b bg-slate-50/60 p-5 md:grid-cols-6"><label className="text-xs font-bold md:col-span-1">Cadastro<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm"><option value="stoppage_reason">Motivo</option><option value="stoppage_type">Tipo</option></select></label><label className="text-xs font-bold">Código<Input className="mt-1" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="Ex.: 52" required /></label><label className="text-xs font-bold md:col-span-2">Descrição<Input className="mt-1" value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Ex.: Vazamento hidráulico" required /></label>{form.type === "stoppage_reason" && <label className="text-xs font-bold">Grupo<select value={form.groupCode} onChange={(event) => setForm({ ...form, groupCode: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm">{types.map((type) => <option key={type.id} value={type.code}>{type.code} · {type.label}</option>)}</select></label>}<label className="text-xs font-bold">Área<select value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3 text-sm"><option>Manutenção</option><option>Produção</option><option>Qualidade</option><option>Engenharia</option></select></label><label className="flex items-center gap-2 self-end pb-2 text-xs font-semibold"><input type="checkbox" checked={form.routes} onChange={(event) => setForm({ ...form, routes: event.target.checked })} className="size-4 accent-orange-500" /> Encaminhar manutenção</label><Button disabled={saving} className="self-end bg-orange-500 hover:bg-orange-600">{saving ? <Loader2 className="animate-spin" /> : <Plus />} Adicionar</Button>{message && <p className="text-xs text-slate-600 md:col-span-6">{message}</p>}</form><div className="grid gap-5 p-5 md:grid-cols-2">{loading ? <Loader2 className="animate-spin text-orange-500" /> : <><CatalogGroup title="Tipos" rows={types} onToggle={toggle} /><CatalogGroup title="Motivos" rows={reasons} onToggle={toggle} /></>}</div></section>;
}
function CatalogGroup({ title, rows, onToggle }: { title: string; rows: Catalog[]; onToggle: (row: Catalog) => void }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">
        {title} · {rows.length}
      </h3>
      <div className="max-h-72 divide-y overflow-y-auto rounded-xl border">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`flex items-center justify-between gap-3 px-3 py-2 text-sm ${row.is_active ? "bg-white" : "bg-slate-50 opacity-50"}`}
          >
            <span>
              <b className="mr-2 font-mono text-orange-600">{row.code}</b>
              {row.label}
              <small className="ml-2 text-xs text-slate-400">
                {row.group_code ? `· ${row.group_code}` : ""}
              </small>
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => onToggle(row)}>
              {row.is_active ? "Desativar" : "Ativar"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
