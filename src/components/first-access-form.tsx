"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";

export function FirstAccessForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(event.currentTarget);
    if (form.get("password") !== form.get("passwordConfirmation")) {
      setLoading(false);
      setError("As senhas precisam ser iguais.");
      return;
    }
    const response = await fetch("/api/local/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        displayName: form.get("displayName"),
        email: form.get("email"),
        password: form.get("password"),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setError(result.error ?? "Não foi possível criar o administrador local.");
      return;
    }
    router.replace("/local");
    router.refresh();
  }

  return <main className="grid min-h-screen place-items-center bg-[#f8f7f4] p-5">
    <form onSubmit={submit} className="w-full max-w-lg rounded-3xl border bg-white p-7 shadow-xl shadow-slate-200/60 sm:p-9">
      <span className="grid size-12 place-items-center rounded-2xl bg-orange-500 text-white"><ShieldCheck className="size-6" /></span>
      <p className="mt-5 text-xs font-bold uppercase tracking-[.2em] text-orange-600">Configuração local</p>
      <h1 className="mt-2 font-heading text-3xl font-extrabold tracking-tight text-slate-900">Crie o administrador</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">Este é o primeiro acesso deste computador. Os dados e as senhas ficam somente no banco local do TecnoMES.</p>

      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-slate-800">Seu nome
          <input name="displayName" required minLength={3} maxLength={120} autoFocus className="mt-2 h-12 w-full rounded-xl border px-3 text-sm outline-none focus:border-orange-500 focus:ring-3 focus:ring-orange-100" placeholder="Ex.: Danilo Cardoso" />
        </label>
        <label className="block text-sm font-semibold text-slate-800">Usuário
          <div className="mt-2 flex h-12 items-center gap-3 rounded-xl border px-3 focus-within:border-orange-500 focus-within:ring-3 focus-within:ring-orange-100"><UserRound className="size-4 text-slate-400" /><input name="username" required minLength={3} maxLength={80} autoComplete="username" className="min-w-0 flex-1 bg-transparent text-sm outline-none" placeholder="Ex.: danilo" /></div>
        </label>
      </div>
      <label className="mt-4 block text-sm font-semibold text-slate-800">E-mail <span className="font-normal text-slate-400">(opcional)</span>
        <input name="email" type="email" maxLength={160} autoComplete="email" className="mt-2 h-12 w-full rounded-xl border px-3 text-sm outline-none focus:border-orange-500 focus:ring-3 focus:ring-orange-100" />
      </label>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-slate-800">Senha
          <div className="mt-2 flex h-12 items-center gap-3 rounded-xl border px-3 focus-within:border-orange-500 focus-within:ring-3 focus-within:ring-orange-100"><LockKeyhole className="size-4 text-slate-400" /><input name="password" type="password" required minLength={8} autoComplete="new-password" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></div>
        </label>
        <label className="block text-sm font-semibold text-slate-800">Confirmar senha
          <input name="passwordConfirmation" type="password" required minLength={8} autoComplete="new-password" className="mt-2 h-12 w-full rounded-xl border px-3 text-sm outline-none focus:border-orange-500 focus:ring-3 focus:ring-orange-100" />
        </label>
      </div>
      {error && <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-700">{error}</p>}
      <button type="submit" disabled={loading} className="mt-6 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-500 px-5 text-sm font-bold text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600 disabled:opacity-60">{loading ? "Criando acesso..." : "Criar administrador"}<ArrowRight className="size-4" /></button>
    </form>
  </main>;
}
