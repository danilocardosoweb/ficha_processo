"use client";

import { useState, type FormEvent } from "react";
import { CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, Save, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LocalUser } from "@/lib/local-auth/types";

type Feedback = { type: "success" | "error"; text: string } | null;

function FeedbackBox({ value }: { value: Feedback }) {
  if (!value) return null;
  return <div role="status" className={`mt-4 flex items-start gap-2 rounded-xl border p-3 text-sm font-medium ${value.type === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{value.type === "error" ? <ShieldAlert className="mt-0.5 size-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0" />}{value.text}</div>;
}

export function ProfileSettings({ user }: { user: LocalUser }) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [email, setEmail] = useState(user.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [profileFeedback, setProfileFeedback] = useState<Feedback>(null);
  const [passwordFeedback, setPasswordFeedback] = useState<Feedback>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);

  async function request(payload: object) {
    const response = await fetch("/api/profile", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Não foi possível salvar.");
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setSavingProfile(true); setProfileFeedback(null);
    try {
      await request({ operation: "profile", displayName, email });
      setProfileFeedback({ type: "success", text: "Identificação salva no banco. Atualizando seus dados..." });
      window.setTimeout(() => window.location.reload(), 650);
    } catch (cause) { setProfileFeedback({ type: "error", text: cause instanceof Error ? cause.message : "Não foi possível salvar." }); }
    finally { setSavingProfile(false); }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setPasswordFeedback(null);
    if (newPassword !== confirmPassword) { setPasswordFeedback({ type: "error", text: "A confirmação não corresponde à nova senha." }); return; }
    if (currentPassword === newPassword) { setPasswordFeedback({ type: "error", text: "A nova senha precisa ser diferente da atual." }); return; }
    setSavingPassword(true);
    try {
      await request({ operation: "password", currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      setPasswordFeedback({ type: "success", text: "Senha alterada e auditada com sucesso. Atualizando sua sessão..." });
      window.setTimeout(() => window.location.reload(), 650);
    } catch (cause) { setPasswordFeedback({ type: "error", text: cause instanceof Error ? cause.message : "Não foi possível alterar a senha." }); }
    finally { setSavingPassword(false); }
  }

  const passwordType = showPasswords ? "text" : "password";
  return <div className="grid gap-5 lg:grid-cols-2">
    <form onSubmit={saveProfile} className="rounded-2xl border bg-white p-6 shadow-sm">
      <h2 className="font-heading text-lg font-bold text-slate-900">Identificação</h2><p className="mt-1 text-sm text-slate-500">Nome utilizado nos apontamentos e auditorias.</p>
      <div className="mt-5 space-y-4"><label className="block text-sm font-semibold">Nome completo<Input className="mt-1 h-10" value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" minLength={2} required /></label><label className="block text-sm font-semibold">E-mail<Input className="mt-1 h-10" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label><label className="block text-sm font-semibold">Usuário<Input className="mt-1 h-10 bg-slate-50" value={user.username} disabled /></label></div>
      <Button className="mt-6" disabled={savingProfile || displayName.trim().length < 2}>{savingProfile ? <LoaderCircle className="animate-spin" /> : <Save />}{savingProfile ? "Salvando..." : "Salvar identificação"}</Button><FeedbackBox value={profileFeedback} />
    </form>
    <form onSubmit={changePassword} className="rounded-2xl border bg-white p-6 shadow-sm" autoComplete="off">
      <div className="flex items-start justify-between gap-3"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-xl bg-orange-50 text-orange-600"><KeyRound className="size-5" /></span><div><h2 className="font-heading text-lg font-bold text-slate-900">Alterar senha</h2><p className="text-sm text-slate-500">Use pelo menos 8 caracteres.</p></div></div><Button type="button" size="icon" variant="ghost" onClick={() => setShowPasswords((value) => !value)} aria-label={showPasswords ? "Ocultar senhas" : "Mostrar senhas"}>{showPasswords ? <EyeOff /> : <Eye />}</Button></div>
      {user.must_change_password && <div className="mt-5 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><ShieldAlert className="mt-0.5 size-4 shrink-0" /><span><strong>Troca obrigatória.</strong> Informe exatamente a senha temporária usada no login e defina sua senha pessoal.</span></div>}
      <div className="mt-5 space-y-4"><label className="block text-sm font-semibold">Senha atual<Input className="mt-1 h-10" type={passwordType} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label><label className="block text-sm font-semibold">Nova senha<Input className="mt-1 h-10" type={passwordType} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label><label className="block text-sm font-semibold">Confirmar nova senha<Input className="mt-1 h-10" type={passwordType} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label></div>
      <Button className="mt-6" disabled={savingPassword || newPassword.length < 8 || confirmPassword.length < 8}>{savingPassword ? <LoaderCircle className="animate-spin" /> : <KeyRound />}{savingPassword ? "Alterando..." : "Alterar senha"}</Button><FeedbackBox value={passwordFeedback} />
    </form>
  </div>;
}
