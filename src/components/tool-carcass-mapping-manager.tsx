"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Link2, Loader2, Pencil, Plus, RefreshCw, Search, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Mapping { id: string; toolCode: string; machineCode: string | null; sequenceNumber: number | null; carcassCode: string; quantity: number; notes: string | null; isActive: boolean; updatedBy: string | null; updatedAt: string; }
interface Tool { code: string; description: string | null; }
interface Carcass { code: string; availableQuantity: number; }
interface Machine { code: string; name: string; }
interface Payload { mappings: Mapping[]; tools: Tool[]; carcasses: Carcass[]; machines: Machine[]; }
type Draft = { id: string | null; toolCode: string; machineCode: string; sequenceNumber: string; carcassCode: string; quantity: string; notes: string; isActive: boolean; };

const blank = (): Draft => ({ id: null, toolCode: "", machineCode: "", sequenceNumber: "", carcassCode: "", quantity: "1", notes: "", isActive: true });

export function ToolCarcassMappingManager() {
  const [data, setData] = useState<Payload>({ mappings: [], tools: [], carcasses: [], machines: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/tool-carcass-mappings", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as Payload | { error?: string } | null;
      if (!response.ok || !payload || !("mappings" in payload)) throw new Error(payload && "error" in payload ? payload.error : "Não foi possível carregar os vínculos.");
      setData(payload);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar os vínculos."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toUpperCase();
    return normalized ? data.mappings.filter((item) => `${item.toolCode} ${item.carcassCode} ${item.machineCode ?? ""}`.toUpperCase().includes(normalized)) : data.mappings;
  }, [data.mappings, query]);
  const mappedTools = useMemo(() => new Set(data.mappings.filter((item) => item.isActive).map((item) => item.toolCode.toUpperCase())).size, [data.mappings]);

  function edit(item: Mapping) {
    setDraft({ id: item.id, toolCode: item.toolCode, machineCode: item.machineCode ?? "", sequenceNumber: item.sequenceNumber ? String(item.sequenceNumber) : "", carcassCode: item.carcassCode, quantity: String(item.quantity), notes: item.notes ?? "", isActive: item.isActive });
  }
  async function save() {
    if (!draft) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/tool-carcass-mappings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...draft, machineCode: draft.machineCode || null, sequenceNumber: draft.sequenceNumber ? Number(draft.sequenceNumber) : null, quantity: Number(draft.quantity) }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Não foi possível salvar o vínculo.");
      setDraft(null); setNotice("Vínculo salvo. As próximas simulações já utilizarão esta carcaça."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar o vínculo."); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="grid min-h-52 place-items-center rounded-2xl border bg-white"><Loader2 className="size-7 animate-spin text-orange-500" /></div>;
  return <div className="space-y-4">
    {error ? <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"><TriangleAlert className="size-5" /><span className="flex-1">{error}</span><Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="size-4" />Atualizar</Button></div> : null}
    {notice ? <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700"><CheckCircle2 className="size-4" />{notice}</div> : null}
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b px-5 py-4 md:flex-row md:items-center"><span className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-600"><Link2 className="size-5" /></span><div className="flex-1"><h2 className="font-heading text-lg font-black">Carcaça exigida por ferramenta</h2><p className="text-sm text-slate-500">{mappedTools} ferramenta(s) mapeada(s). Use prensa e sequência apenas quando o setup fugir do padrão.</p></div><Button className="bg-orange-600 text-white hover:bg-orange-700" onClick={() => setDraft(blank())}><Plus className="size-4" />Novo vínculo</Button></header>
      <div className="border-b bg-slate-50/60 p-4"><label className="flex max-w-md items-center gap-2 rounded-xl border bg-white px-3"><Search className="size-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="h-10 flex-1 bg-transparent text-sm outline-none" placeholder="Buscar ferramenta ou carcaça" /></label></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Ferramenta</th><th className="px-4 py-3">Aplicação</th><th className="px-4 py-3">Carcaça</th><th className="px-4 py-3 text-right">Qtd.</th><th className="px-4 py-3">Situação física</th><th className="px-4 py-3">Status</th><th className="px-5 py-3 text-right">Ação</th></tr></thead><tbody>{filtered.length ? filtered.map((item) => { const carcass = data.carcasses.find((candidate) => candidate.code === item.carcassCode); return <tr key={item.id} className="border-t hover:bg-orange-50/30"><td className="px-5 py-3"><strong className="font-mono text-orange-600">{item.toolCode}</strong></td><td className="px-4 py-3 text-slate-600">{item.machineCode ? data.machines.find((machine) => machine.code === item.machineCode)?.name || `Prensa ${item.machineCode}` : "Todas as prensas"}{item.sequenceNumber ? ` · seq. ${item.sequenceNumber}` : " · setup padrão"}</td><td className="px-4 py-3 font-mono font-bold">{item.carcassCode}</td><td className="px-4 py-3 text-right font-bold">{item.quantity}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${carcass?.availableQuantity ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{carcass ? `${carcass.availableQuantity} física(s)` : "Não cadastrada"}</span></td><td className="px-4 py-3">{item.isActive ? "Ativo" : "Inativo"}</td><td className="px-5 py-3 text-right"><Button variant="ghost" size="sm" onClick={() => edit(item)}><Pencil className="size-4" />Editar</Button></td></tr>; }) : <tr><td colSpan={7} className="h-36 text-center text-slate-400">Nenhum vínculo encontrado.</td></tr>}</tbody></table></div>
    </section>
    {draft ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4"><section className="w-full max-w-2xl overflow-hidden rounded-2xl border bg-white shadow-2xl"><header className="flex items-start border-b px-5 py-4"><div className="flex-1"><h2 className="font-heading text-lg font-black">{draft.id ? "Editar vínculo" : "Vincular ferramenta e carcaça"}</h2><p className="text-xs text-slate-500">O vínculo padrão vale para as duas prensas. Refine por prensa ou sequência somente quando necessário.</p></div><button type="button" aria-label="Fechar" onClick={() => setDraft(null)}><X className="size-5" /></button></header><div className="grid gap-4 p-5 sm:grid-cols-2">
      <Field label="Ferramenta"><input list="mapping-tools" autoFocus value={draft.toolCode} onChange={(event) => setDraft({ ...draft, toolCode: event.target.value.toUpperCase() })} placeholder="Ex.: TBX-061" /><datalist id="mapping-tools">{data.tools.map((tool) => <option key={tool.code} value={tool.code}>{tool.description ?? ""}</option>)}</datalist></Field>
      <Field label="Carcaça"><select value={draft.carcassCode} onChange={(event) => setDraft({ ...draft, carcassCode: event.target.value })}><option value="">Selecione...</option>{data.carcasses.map((item) => <option key={item.code} value={item.code}>{item.code} · {item.availableQuantity} física(s)</option>)}</select></Field>
      <Field label="Prensa (opcional)"><select value={draft.machineCode} onChange={(event) => setDraft({ ...draft, machineCode: event.target.value })}><option value="">Todas as prensas</option>{data.machines.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></Field>
      <Field label="Sequência física (opcional)"><input type="number" min="1" value={draft.sequenceNumber} onChange={(event) => setDraft({ ...draft, sequenceNumber: event.target.value })} placeholder="Setup padrão" /></Field>
      <Field label="Quantidade simultânea"><input type="number" min="1" max="100" value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} /></Field>
      <label className="flex items-center gap-3 rounded-xl border bg-slate-50 p-3 text-sm font-bold"><input type="checkbox" checked={draft.isActive} onChange={(event) => setDraft({ ...draft, isActive: event.target.checked })} className="size-4 accent-orange-500" />Vínculo ativo</label>
      <label className="text-sm font-bold sm:col-span-2">Observações<textarea rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} className="mt-1.5 w-full rounded-xl border px-3 py-2 outline-none focus:border-orange-400" placeholder="Ex.: usar carcaça reforçada nesta sequência" /></label>
    </div><footer className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-3"><Button variant="outline" onClick={() => setDraft(null)}>Cancelar</Button><Button disabled={saving || !draft.toolCode.trim() || !draft.carcassCode} onClick={() => void save()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Link2 className="size-4" />}Salvar vínculo</Button></footer></section></div> : null}
  </div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="text-sm font-bold">{label}<span className="[&>input]:mt-1.5 [&>input]:h-11 [&>input]:w-full [&>input]:rounded-xl [&>input]:border [&>input]:px-3 [&>input]:outline-none [&>select]:mt-1.5 [&>select]:h-11 [&>select]:w-full [&>select]:rounded-xl [&>select]:border [&>select]:bg-white [&>select]:px-3">{children}</span></label>; }
