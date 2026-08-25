"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Pencil, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient, withSupabaseTimeout } from "@/lib/supabase/client";

type Machine = {
  id: string;
  code: string;
  name: string;
  capacity_tons: number | null;
  is_active: boolean;
};

const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;

export function MachineManager() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [editing, setEditing] = useState<Machine | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!organizationId) { setError("Organizacao padrao nao configurada."); setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error: loadError } = await withSupabaseTimeout(createClient()
        .from("machines")
        .select("id,code,name,capacity_tons,is_active")
        .eq("organization_id", organizationId)
        .order("code"));
      if (loadError) setError(loadError.message);
      else { setError(""); setMachines((data ?? []) as Machine[]); }
    } catch { setError("Nao foi possivel conectar ao Supabase. Verifique a internet e recarregue a pagina."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    if (!organizationId) { setError("Organizacao padrao nao configurada."); setSaving(false); return; }
    const payload = {
      organization_id: organizationId,
      code: String(form.get("code")).trim().toUpperCase(),
      name: String(form.get("name")).trim(),
      capacity_tons: Number(form.get("capacity_tons")) || null,
      is_active: form.get("is_active") === "on",
    };
    const query = editing
      ? createClient().from("machines").update(payload).eq("id", editing.id)
      : createClient().from("machines").insert(payload);
    try {
      const { error: saveError } = await withSupabaseTimeout(query);
      if (saveError) setError(saveError.code === "23505" ? "Ja existe uma prensa com este codigo." : saveError.message);
      else { setMessage(editing ? "Prensa atualizada." : "Prensa cadastrada."); setEditing(null); formElement.reset(); await load(); }
    } catch { setError("Nao foi possivel salvar. Verifique a conexao com o Supabase e tente novamente."); }
    finally { setSaving(false); }
  }

  return <div className="grid gap-5 xl:grid-cols-[.85fr_1.4fr]">
    <form key={editing?.id ?? "new"} onSubmit={save} className="rounded-xl border bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between"><div><h2 className="font-heading font-bold">{editing ? "Editar prensa" : "Nova prensa"}</h2><p className="mt-1 text-xs text-slate-500">Cadastre os equipamentos usados no planejamento.</p></div>{editing && <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(null)}><RotateCcw className="size-4" />Cancelar</Button>}</div>
      <div className="mt-6 space-y-4">
        <div className="space-y-2"><Label htmlFor="code">Codigo da prensa</Label><Input id="code" name="code" defaultValue={editing?.code} placeholder="P1800" required /></div>
        <div className="space-y-2"><Label htmlFor="name">Nome</Label><Input id="name" name="name" defaultValue={editing?.name} placeholder="Prensa 1800T" required /></div>
        <div className="space-y-2"><Label htmlFor="capacity_tons">Capacidade (toneladas)</Label><Input id="capacity_tons" name="capacity_tons" type="number" min="1" defaultValue={editing?.capacity_tons ?? ""} placeholder="1800" /></div>
        <label className="flex items-center gap-3 rounded-lg border bg-slate-50 px-3 py-3 text-sm"><input name="is_active" type="checkbox" defaultChecked={editing?.is_active ?? true} className="size-4 accent-orange-500" />Prensa ativa para programacao</label>
      </div>
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && <p role="status" className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
      <Button type="submit" className="mt-5 h-11 w-full bg-orange-500 font-semibold hover:bg-orange-600" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Plus className="size-4" />}{editing ? "Salvar alteracoes" : "Cadastrar prensa"}</Button>
    </form>
    <section className="rounded-xl border bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between"><div><h2 className="font-heading font-bold">Prensas cadastradas</h2><p className="mt-1 text-xs text-slate-500">{machines.length} equipamento(s) disponivel(is).</p></div></div>
      {loading ? <div className="grid min-h-56 place-items-center"><Loader2 className="size-6 animate-spin text-orange-500" /></div> : machines.length === 0 ? <div className="grid min-h-56 place-items-center text-sm text-slate-400">Nenhuma prensa cadastrada.</div> : <div className="mt-5 grid gap-3 md:grid-cols-2">{machines.map(machine => <article key={machine.id} className="rounded-xl border p-4 transition hover:border-orange-200 hover:bg-orange-50/20"><div className="flex items-start justify-between"><div><p className="font-mono text-sm font-bold text-orange-600">{machine.code}</p><h3 className="mt-1 font-heading font-bold">{machine.name}</h3></div><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${machine.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{machine.is_active ? "ATIVA" : "INATIVA"}</span></div><p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><CheckCircle2 className="size-4 text-slate-400" />{machine.capacity_tons ? `${machine.capacity_tons.toLocaleString("pt-BR")} toneladas` : "Capacidade nao informada"}</p><Button variant="ghost" size="sm" className="mt-3 px-0 text-orange-600" onClick={() => { setEditing(machine); setMessage(""); setError(""); }}><Pencil className="size-3.5" />Editar cadastro</Button></article>)}</div>}
    </section>
  </div>;
}
