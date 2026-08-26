"use client";

import { useMemo, useState, type FormEvent } from "react";
import { CheckCircle2, Copy, KeyRound, Pencil, Plus, Search, UsersRound, XCircle } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { localRoles, roleLabels, userInitials, type LocalRole, type ManagedUser } from "@/lib/local-auth/types";

const machines = [{ code: "18", label: "Prensa 1.8" }, { code: "19", label: "Prensa 1.9" }];
const emptyForm = { username: "", email: "", displayName: "", role: "operator" as LocalRole, machineCodes: [] as string[], password: "", isActive: true };

function dateTime(value: string | null) { return value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Nunca acessou"; }
function generatePassword() { return `Alum#${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 6)}9A`; }

export function UsersManager({ initialUsers, currentUserId }: { initialUsers: ManagedUser[]; currentUserId: string }) {
  const [users, setUsers] = useState(initialUsers);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ManagedUser | "new" | null>(null);
  const [resetting, setResetting] = useState<ManagedUser | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [resetPassword, setResetPassword] = useState("");
  const [resetCompleted, setResetCompleted] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const filtered = useMemo(() => users.filter((user) => `${user.display_name} ${user.username} ${user.email ?? ""} ${roleLabels[user.role]}`.toLowerCase().includes(query.toLowerCase())), [users, query]);

  async function refresh() { const response = await fetch("/api/users"); const result = await response.json(); if (response.ok) setUsers(result.users); }
  function openNew() { setForm({ ...emptyForm, password: generatePassword() }); setError(""); setEditing("new"); }
  function openEdit(user: ManagedUser) { setForm({ username: user.username, email: user.email ?? "", displayName: user.display_name, role: user.role, machineCodes: user.machine_codes, password: "", isActive: user.is_active }); setError(""); setEditing(user); }
  function toggleMachine(code: string) { setForm((value) => ({ ...value, machineCodes: value.machineCodes.includes(code) ? value.machineCodes.filter((item) => item !== code) : [...value.machineCodes, code] })); }

  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    const creating = editing === "new";
    const payload = creating ? form : { id: (editing as ManagedUser).id, email: form.email, displayName: form.displayName, role: form.role, machineCodes: form.machineCodes, isActive: form.isActive };
    const response = await fetch("/api/users", { method: creating ? "POST" : "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({})); setSaving(false);
    if (!response.ok) { setError(result.error || "Não foi possível salvar."); return; }
    setEditing(null); setMessage(creating ? `Usuário ${form.username} criado. Entregue a senha temporária com segurança.` : "Usuário atualizado e alteração registrada."); await refresh();
  }

  async function reset(event: FormEvent) {
    event.preventDefault(); if (!resetting) return; setSaving(true); setError("");
    const response = await fetch("/api/users", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "reset-password", id: resetting.id, password: resetPassword }) });
    const result = await response.json().catch(() => ({})); setSaving(false);
    if (!response.ok) { setError(result.error || "Não foi possível redefinir."); return; }
    setResetCompleted(true); setMessage(""); await refresh();
  }

  return <>
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b p-5 md:flex-row md:items-center md:justify-between md:px-6">
        <div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-orange-50 text-orange-600"><UsersRound className="size-5" /></span><div><h2 className="font-heading text-lg font-bold text-slate-900">Equipe cadastrada</h2><p className="text-sm text-slate-500">{users.filter((user) => user.is_active).length} ativos · {users.length} no total</p></div></div>
        <Button onClick={openNew} className="h-10 bg-orange-500 hover:bg-orange-600"><Plus />Novo usuário</Button>
      </div>
      <div className="border-b bg-slate-50/60 p-4 md:px-6"><div className="flex h-10 max-w-xl items-center gap-2 rounded-xl border bg-white px-3 focus-within:border-orange-400"><Search className="size-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar nome, usuário, e-mail ou perfil" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></div></div>
      {message && <div className="mx-5 mt-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700"><CheckCircle2 className="size-4" />{message}</div>}
      <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr><th className="px-6 py-3">Usuário</th><th className="px-4 py-3">Perfil</th><th className="px-4 py-3">Prensas</th><th className="px-4 py-3">Último acesso</th><th className="px-4 py-3">Status</th><th className="px-6 py-3 text-right">Ações</th></tr></thead><tbody className="divide-y">
        {filtered.map((user) => <tr key={user.id} className="hover:bg-slate-50/70"><td className="px-6 py-3.5"><div className="flex items-center gap-3"><Avatar className="size-9"><AvatarFallback className="bg-slate-100 text-xs font-bold text-slate-700">{userInitials(user.display_name)}</AvatarFallback></Avatar><div><p className="text-sm font-bold text-slate-900">{user.display_name}{user.id === currentUserId && <span className="ml-2 text-[10px] font-bold uppercase text-orange-600">Você</span>}</p><p className="text-xs text-slate-500">{user.username}{user.email ? ` · ${user.email}` : ""}</p></div></div></td><td className="px-4 py-3.5"><span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{roleLabels[user.role]}</span></td><td className="px-4 py-3.5 text-sm text-slate-600">{user.machine_codes.length ? user.machine_codes.join(" · ") : "Todas"}</td><td className="px-4 py-3.5 text-sm text-slate-600">{dateTime(user.last_login_at)}</td><td className="px-4 py-3.5"><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${user.is_active ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{user.is_active ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}{user.is_active ? "Ativo" : "Bloqueado"}</span>{user.must_change_password && <span className="ml-1 inline-flex rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">Trocar senha</span>}</td><td className="px-6 py-3.5"><div className="flex justify-end gap-1"><Button variant="ghost" size="sm" onClick={() => openEdit(user)}><Pencil />Editar</Button><Button variant="ghost" size="sm" onClick={() => { setResetPassword(generatePassword()); setResetCompleted(false); setError(""); setResetting(user); }}><KeyRound />Senha</Button></div></td></tr>)}
      </tbody></table></div>
      {!filtered.length && <div className="grid place-items-center p-12 text-sm text-slate-500">Nenhum usuário encontrado.</div>}
    </section>

    <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>{editing === "new" ? "Novo usuário" : "Editar usuário"}</DialogTitle><DialogDescription>Defina a identificação, o perfil e as prensas disponíveis.</DialogDescription></DialogHeader><form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-semibold">Nome completo<Input className="mt-1 h-10" value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} required /></label><label className="text-sm font-semibold">Usuário<Input className="mt-1 h-10" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} disabled={editing !== "new"} required /></label>
      <label className="text-sm font-semibold sm:col-span-2">E-mail (opcional)<Input className="mt-1 h-10" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label className="text-sm font-semibold">Perfil<select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as LocalRole })} className="mt-1 h-10 w-full rounded-lg border bg-white px-3">{localRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
      {editing === "new" && <label className="text-sm font-semibold">Senha temporária<div className="mt-1 flex gap-2"><Input className="h-10" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required /><Button type="button" variant="outline" onClick={() => setForm({ ...form, password: generatePassword() })}>Gerar</Button></div></label>}
      <fieldset className="sm:col-span-2"><legend className="text-sm font-semibold">Acesso às prensas</legend><div className="mt-2 flex gap-2">{machines.map((machine) => <button type="button" key={machine.code} onClick={() => toggleMachine(machine.code)} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${form.machineCodes.includes(machine.code) ? "border-orange-400 bg-orange-50 text-orange-700" : "bg-white text-slate-600"}`}>{machine.label}</button>)}<button type="button" onClick={() => setForm({ ...form, machineCodes: [] })} className={`rounded-xl border px-3 py-2 text-sm font-semibold ${!form.machineCodes.length ? "border-orange-400 bg-orange-50 text-orange-700" : "bg-white text-slate-600"}`}>Todas</button></div></fieldset>
      {editing && editing !== "new" && <label className="flex items-center gap-3 rounded-xl bg-slate-50 p-3 text-sm font-semibold sm:col-span-2"><input type="checkbox" checked={form.isActive} disabled={editing.id === currentUserId} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} className="size-4 accent-orange-500" />Usuário ativo</label>}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 sm:col-span-2">{error}</p>}<DialogFooter className="sm:col-span-2"><Button type="button" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Salvar usuário"}</Button></DialogFooter>
    </form></DialogContent></Dialog>

    <Dialog open={resetting !== null} onOpenChange={(open) => !open && setResetting(null)}><DialogContent><DialogHeader><DialogTitle>{resetCompleted ? "Senha confirmada" : "Redefinir senha"}</DialogTitle><DialogDescription>{resetCompleted ? `A nova credencial de ${resetting?.display_name} foi validada no banco.` : `${resetting?.display_name} será desconectado e deverá trocar a senha no próximo acesso.`}</DialogDescription></DialogHeader>{resetCompleted ? <div className="space-y-4"><div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex items-center gap-2 text-sm font-bold text-emerald-700"><CheckCircle2 className="size-4" />Senha temporária pronta para entrega</div><div className="mt-3 flex items-center gap-2"><code className="min-w-0 flex-1 overflow-x-auto rounded-lg border bg-white px-3 py-2 text-sm font-bold text-slate-900">{resetPassword}</code><Button type="button" variant="outline" onClick={() => navigator.clipboard.writeText(resetPassword)}><Copy />Copiar</Button></div><p className="mt-2 text-xs text-emerald-800">Esta senha vale somente até o usuário cadastrar a senha pessoal.</p></div><DialogFooter><Button type="button" onClick={() => setResetting(null)}>Concluir</Button></DialogFooter></div> : <form onSubmit={reset} className="space-y-4"><label className="text-sm font-semibold">Nova senha temporária<div className="mt-1 flex gap-2"><Input className="h-10" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} required /><Button type="button" variant="outline" onClick={() => setResetPassword(generatePassword())}>Gerar</Button></div></label>{error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}<DialogFooter><Button type="button" variant="outline" onClick={() => setResetting(null)}>Cancelar</Button><Button type="submit" disabled={saving}>{saving ? "Validando..." : "Redefinir e validar"}</Button></DialogFooter></form>}</DialogContent></Dialog>
  </>;
}
