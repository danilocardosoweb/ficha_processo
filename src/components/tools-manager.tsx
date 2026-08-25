"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Search, X } from "lucide-react";
import { ToolHistoryImport } from "@/components/tool-history-import";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { createClient, withSupabaseTimeout } from "@/lib/supabase/client";
import { getOfflineSnapshot, normalizeCode, requestOfflineSync } from "@/lib/offline-store";

type Tool = {
  id: string; code: string; description: string | null; lifecycle_kg: number; status: string; updated_at: string;
  matrix_code: string | null; sequence_number: number | null; holes: number | null;
  theoretical_linear_weight_kg_m: number | null; actual_linear_weight_kg_m: number | null;
  useful_life_kg: number | null; produced_kg: number | null; remaining_kg: number | null;
  source_status: string | null; source_available: boolean | null; machine_codes: string | null;
};
const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
const pageSize = 25;
const toolName = (tool: Tool) => tool.matrix_code || tool.description?.replace(/^Perfil\s+/i, "") || tool.code;
const statusLabel = (tool: Tool) => tool.source_status || ({ available: "Disponível", in_use: "Em uso", maintenance: "Manutenção", inactive: "Inativa" }[tool.status] ?? tool.status);

export function ToolsManager() {
  const [tools, setTools] = useState<Tool[]>([]);
  const [editing, setEditing] = useState<Tool | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => { setPage(0); setSearch(searchInput.trim()); }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const showCached = useCallback(async (notice: string) => {
    const snapshot = await getOfflineSnapshot<Tool>("tools");
    if (!snapshot) return false;
    const token = normalizeCode(search);
    const filtered = snapshot.rows.filter(tool => {
      if (!token) return true;
      return [tool.matrix_code, tool.sequence_number, tool.source_status, tool.machine_codes]
        .some(value => normalizeCode(String(value ?? "")).includes(token));
    });
    setTools(filtered.slice(page * pageSize, (page + 1) * pageSize));
    setTotal(filtered.length);
    setError(notice);
    return true;
  }, [page, search]);

  const load = useCallback(async () => {
    if (!organizationId) { setError("Organização padrão não configurada."); setLoading(false); return; }
    setLoading(true);
    try {
      let query = createClient().from("tools").select("id,code,description,lifecycle_kg,status,updated_at,matrix_code,sequence_number,holes,theoretical_linear_weight_kg_m,actual_linear_weight_kg_m,useful_life_kg,produced_kg,remaining_kg,source_status,source_available,machine_codes", { count: "exact" }).eq("organization_id", organizationId).not("matrix_code", "is", null);
      const safeSearch = normalizeCode(search);
      if (safeSearch) query = query.ilike("matrix_search", `%${safeSearch}%`);
      const { data, error: loadError, count } = await withSupabaseTimeout(query.order("matrix_code").order("sequence_number").range(page * pageSize, (page + 1) * pageSize - 1));
      if (loadError) {
        if (!await showCached(`Sem conexão com o banco. Exibindo o cadastro salvo neste computador. (${loadError.message})`)) setError(loadError.message);
      } else { setError(""); setTools((data ?? []) as Tool[]); setTotal(count ?? 0); }
    } catch { if (!await showCached("Modo offline: exibindo o cadastro salvo neste computador.")) setError("Não foi possível conectar ao Supabase e ainda não há uma cópia local."); }
    finally { setLoading(false); }
  }, [page, search, showCached]);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  function openForm(tool: Tool | null) { setEditing(tool); setError(""); setMessage(""); setFormOpen(true); }
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(""); setMessage("");
    if (!organizationId) { setError("Organização padrão não configurada."); setSaving(false); return; }
    const form = new FormData(event.currentTarget);
    const matrixCode = String(form.get("matrix_code") ?? "").trim().toUpperCase();
    const sequence = Number(form.get("sequence_number")) || 0;
    const payload = {
      organization_id: organizationId,
      code: editing?.code || `MANUAL:${matrixCode}:${String(sequence).padStart(3, "0")}`,
      matrix_code: matrixCode,
      sequence_number: sequence,
      description: String(form.get("description") ?? "").trim() || `Matriz ${matrixCode} · Seq. ${sequence}`,
      holes: Number(form.get("holes")) || null,
      theoretical_linear_weight_kg_m: Number(form.get("theoretical_linear_weight_kg_m")) || null,
      useful_life_kg: Number(form.get("useful_life_kg")) || null,
      lifecycle_kg: Number(form.get("produced_kg")) || 0,
      produced_kg: Number(form.get("produced_kg")) || 0,
      status: String(form.get("status") ?? "available"),
    };
    const query = editing ? createClient().from("tools").update(payload).eq("id", editing.id) : createClient().from("tools").insert(payload);
    try {
      const { error: saveError } = await withSupabaseTimeout(query);
      if (saveError) setError(saveError.code === "23505" ? "Já existe esta ferramenta e sequência." : saveError.message);
      else { setMessage(editing ? "Ferramenta atualizada." : "Ferramenta cadastrada."); setFormOpen(false); setEditing(null); requestOfflineSync(); await load(); }
    } catch { setError("Não foi possível salvar. Verifique a conexão com o Supabase e tente novamente."); }
    finally { setSaving(false); }
  }

  return <section className="rounded-xl border bg-white shadow-sm">
    <div className="flex flex-col gap-4 border-b p-5 lg:flex-row lg:items-end lg:justify-between">
      <div><h2 className="font-heading font-bold">Ferramentas cadastradas</h2><p className="mt-1 text-xs text-slate-500">{total.toLocaleString("pt-BR")} ferramenta(s) física(s). Dados do histórico Excel, separados por matriz e sequência.</p></div>
      <div className="flex flex-wrap gap-2"><ToolHistoryImport onImported={() => { setPage(0); requestOfflineSync(); void load(); }} /><Button type="button" variant="outline" onClick={() => openForm(null)}><Plus className="size-4" />Nova ferramenta</Button></div>
    </div>
    <div className="flex flex-col gap-3 border-b p-4 lg:flex-row">
      <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input value={searchInput} onChange={event => setSearchInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { setPage(0); setSearch(searchInput); } }} className="pl-9" placeholder="Buscar ferramenta (ex.: DIN7501 ou DIN-7501)..." /></div>
      <Button type="button" variant="outline" onClick={() => { setPage(0); setSearch(searchInput); }}>Buscar</Button>
      {(search || searchInput) && <Button type="button" variant="ghost" onClick={() => { setSearchInput(""); setSearch(""); setPage(0); }}>Limpar</Button>}
    </div>
    {error && !formOpen && <p role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    {loading ? <div className="grid min-h-72 place-items-center"><Loader2 className="size-6 animate-spin text-orange-500" /></div> : tools.length === 0 ? <div className="grid min-h-72 place-items-center text-sm text-slate-400">Nenhuma ferramenta encontrada.</div> : <>
      <div className="max-h-[calc(100vh-330px)] min-h-72 overflow-auto"><table className="w-full min-w-[1080px] text-left text-sm"><thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 shadow-[0_1px_0_0_#e2e8f0]"><tr><th className="px-4 py-3">Ferramenta</th><th className="px-4 py-3">Seq.</th><th className="px-4 py-3">Furos</th><th className="px-4 py-3">Peso linear</th><th className="px-4 py-3">Produzido / vida útil</th><th className="px-4 py-3">Prensas</th><th className="px-4 py-3">Situação</th><th className="px-4 py-3 text-right">Ação</th></tr></thead><tbody>{tools.map(tool => <tr key={tool.id} className="border-t hover:bg-orange-50/40"><td className="px-4 py-3 font-mono font-bold text-orange-600">{toolName(tool)}</td><td className="px-4 py-3 font-semibold">{tool.sequence_number ?? "—"}</td><td className="px-4 py-3">{tool.holes ?? "—"}</td><td className="px-4 py-3 tabular-nums">{(tool.theoretical_linear_weight_kg_m ?? tool.actual_linear_weight_kg_m)?.toLocaleString("pt-BR") ?? "—"} kg/m</td><td className="px-4 py-3 tabular-nums"><strong>{(tool.produced_kg ?? tool.lifecycle_kg).toLocaleString("pt-BR")} kg</strong><span className="text-slate-400"> / {tool.useful_life_kg?.toLocaleString("pt-BR") ?? "—"} kg</span></td><td className="px-4 py-3">{tool.machine_codes || "—"}</td><td className="px-4 py-3"><span title={tool.source_status || ""} className={tool.source_available ?? tool.status === "available" ? "inline-block max-w-48 truncate rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700" : "inline-block max-w-48 truncate rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600"}>{statusLabel(tool)}</span></td><td className="px-4 py-3 text-right"><Button variant="ghost" size="sm" className="text-orange-600" onClick={() => openForm(tool)}><Pencil className="size-3.5" />Editar</Button></td></tr>)}</tbody></table></div>
      <div className="flex items-center justify-between border-t p-4 text-xs text-slate-500"><span>Mostrando {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} de {total.toLocaleString("pt-BR")}</span><div className="flex items-center gap-2"><span>Página {page + 1} de {Math.max(1, Math.ceil(total / pageSize))}</span><Button variant="outline" size="icon" disabled={page === 0} onClick={() => setPage(current => current - 1)} aria-label="Página anterior"><ChevronLeft className="size-4" /></Button><Button variant="outline" size="icon" disabled={(page + 1) * pageSize >= total} onClick={() => setPage(current => current + 1)} aria-label="Próxima página"><ChevronRight className="size-4" /></Button></div></div>
    </>}

    <Sheet open={formOpen} onOpenChange={setFormOpen}><SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-xl"><SheetHeader className="border-b px-6 py-5 pr-16"><SheetTitle>{editing ? "Editar ferramenta" : "Nova ferramenta"}</SheetTitle><SheetDescription>Cadastro físico por matriz e sequência.</SheetDescription><Button type="button" variant="ghost" size="icon" className="absolute right-4 top-4" onClick={() => setFormOpen(false)} aria-label="Fechar"><X className="size-4" /></Button></SheetHeader><form key={editing?.id ?? "new"} onSubmit={save} className="space-y-5 p-6"><div className="grid grid-cols-[1fr_110px] gap-4"><Field label="Ferramenta / matriz" name="matrix_code" defaultValue={editing ? toolName(editing) : ""} required /><Field label="Sequência" name="sequence_number" type="number" min="0" defaultValue={editing?.sequence_number ?? 0} required /></div><Field label="Descrição" name="description" defaultValue={editing?.description ?? ""} /><div className="grid grid-cols-2 gap-4"><Field label="Furos" name="holes" type="number" min="0" defaultValue={editing?.holes ?? ""} /><Field label="Peso linear (kg/m)" name="theoretical_linear_weight_kg_m" type="number" step="0.0001" min="0" defaultValue={editing?.theoretical_linear_weight_kg_m ?? ""} /><Field label="Produzido (kg)" name="produced_kg" type="number" step="0.001" min="0" defaultValue={editing?.produced_kg ?? editing?.lifecycle_kg ?? 0} /><Field label="Vida útil (kg)" name="useful_life_kg" type="number" step="0.001" min="0" defaultValue={editing?.useful_life_kg ?? ""} /></div><div className="space-y-2"><Label htmlFor="tool-status">Situação</Label><select id="tool-status" name="status" defaultValue={editing?.status ?? "available"} className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"><option value="available">Disponível</option><option value="in_use">Em uso</option><option value="maintenance">Em manutenção</option><option value="inactive">Inativa</option></select></div>{error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}{message && <p role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}<Button type="submit" className="h-11 w-full bg-orange-500 font-semibold hover:bg-orange-600" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Plus className="size-4" />}{editing ? "Salvar alterações" : "Cadastrar ferramenta"}</Button></form></SheetContent></Sheet>
  </section>;
}

function Field({ label, name, defaultValue, type = "text", ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <div className="space-y-2"><Label htmlFor={`tool-${name}`}>{label}</Label><Input id={`tool-${name}`} name={name} type={type} defaultValue={defaultValue} {...props} /></div>;
}
