"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Layers3, LockKeyhole, UserRound } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setLoading(true);
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/session/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: form.get("login"), password: form.get("password") }) });
    const result = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) { setError(result.error || "Não foi possível entrar."); return; }
    const next = search.get("next");
    router.replace(result.mustChangePassword ? "/perfil?trocar=1" : next?.startsWith("/") ? next : "/dashboard");
    router.refresh();
  }

  return <main className="grid min-h-screen lg:grid-cols-[1.05fr_.95fr]">
    <section className="relative hidden overflow-hidden bg-[#111927] p-12 text-white grid-noise lg:flex lg:flex-col lg:justify-between">
      <div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl bg-orange-500"><Layers3 className="size-6" /></span><div><p className="font-heading text-xl font-extrabold">Alum<span className="text-orange-500">MES</span></p><p className="text-[10px] uppercase tracking-[.22em] text-slate-400">Extrusion Intelligence</p></div></div>
      <div className="max-w-xl"><span className="rounded-full border border-orange-400/20 bg-orange-500/10 px-3 py-1 text-xs font-semibold text-orange-300">Operação rastreável</span><h1 className="mt-6 font-heading text-5xl font-extrabold leading-[1.08]">Cada ação ligada ao operador certo.</h1><p className="mt-5 max-w-lg text-base leading-7 text-slate-400">Acesse o planejamento, forno, produção e apontamentos com sua identificação individual.</p></div>
      <p className="text-xs text-slate-500">AlumMES V1 · Acesso interno Tecnoperfil</p>
    </section>
    <section className="grid place-items-center bg-[#f8f7f4] p-5"><form onSubmit={submit} className="w-full max-w-md rounded-3xl border bg-white p-7 shadow-xl shadow-slate-200/60 sm:p-9">
      <div className="lg:hidden"><span className="grid size-12 place-items-center rounded-2xl bg-orange-500 text-white"><Layers3 className="size-6" /></span></div>
      <p className="mt-5 text-xs font-bold uppercase tracking-[.2em] text-orange-600">Bem-vindo</p><h2 className="mt-2 font-heading text-3xl font-extrabold tracking-tight text-slate-900">Acesse sua operação</h2><p className="mt-2 text-sm text-slate-500">Entre com o usuário fornecido pelo administrador.</p>
      <label className="mt-7 block text-sm font-semibold text-slate-800">Usuário ou e-mail<div className="mt-2 flex h-12 items-center gap-3 rounded-xl border px-3 focus-within:border-orange-500 focus-within:ring-3 focus-within:ring-orange-100"><UserRound className="size-4 text-slate-400" /><input name="login" autoComplete="username" required autoFocus className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Ex.: danilo" /></div></label>
      <label className="mt-4 block text-sm font-semibold text-slate-800">Senha<div className="mt-2 flex h-12 items-center gap-3 rounded-xl border px-3 focus-within:border-orange-500 focus-within:ring-3 focus-within:ring-orange-100"><LockKeyhole className="size-4 text-slate-400" /><input name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required className="min-w-0 flex-1 bg-transparent text-sm outline-none" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="text-slate-400 hover:text-slate-700" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></div></label>
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p>}
      <button type="submit" disabled={loading} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 text-sm font-bold text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600 disabled:opacity-60">{loading ? "Validando..." : "Entrar no sistema"}<ArrowRight className="size-4" /></button>
      <p className="mt-5 text-center text-xs text-slate-400">Sessão protegida · validade de 12 horas</p>
    </form></section>
  </main>;
}
