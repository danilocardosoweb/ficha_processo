"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, CircleGauge, Loader2, MapPin, PackageOpen, Pencil, Plus, RefreshCw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BilletLot {
  id: string;
  alloyCode: string;
  lotCode: string;
  barWeightKg: number | string;
  totalBars: number;
  reservedBars: number;
  availableBars: number;
  status: "available" | "blocked" | "depleted";
  location: string | null;
  receivedAt: string;
  notes: string | null;
  updatedAt: string;
}

interface BilletSummary {
  alloyCode: string;
  lotCount: number;
  totalBars: number;
  reservedBars: number;
  availableBars: number;
  totalWeightKg: number | string;
  availableWeightKg: number | string;
}

interface Payload { lots: BilletLot[]; summary: BilletSummary[]; }
interface LotDraft { id: string | null; alloyCode: string; lotCode: string; barWeightKg: string; totalBars: string; status: BilletLot["status"]; location: string; receivedAt: string; notes: string; }

const emptyDraft = (): LotDraft => ({ id: null, alloyCode: "", lotCode: "", barWeightKg: "415", totalBars: "0", status: "available", location: "", receivedAt: new Date().toISOString().slice(0, 10), notes: "" });
const asNumber = (value: number | string) => Number(value) || 0;
const formatNumber = (value: number, digits = 0) => value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const statusLabel = { available: "Disponível", blocked: "Bloqueado", depleted: "Esgotado" } as const;
const statusClass = { available: "bg-emerald-50 text-emerald-700", blocked: "bg-amber-50 text-amber-700", depleted: "bg-slate-100 text-slate-500" } as const;

export function BilletStockManager() {
  const [payload, setPayload] = useState<Payload>({ lots: [], summary: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [draft, setDraft] = useState<LotDraft | null>(null);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/billet-stock", { cache: "no-store" });
      const body = await response.json().catch(() => null) as Payload | { error?: string } | null;
      if (!response.ok) throw new Error(body && "error" in body && body.error ? body.error : "Não foi possível carregar o estoque.");
      setPayload(body && "lots" in body ? body : { lots: [], summary: [] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível carregar o estoque."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const filteredLots = useMemo(() => {
    const query = filter.trim().toUpperCase();
    return query ? payload.lots.filter((lot) => `${lot.alloyCode} ${lot.lotCode} ${lot.location ?? ""}`.toUpperCase().includes(query)) : payload.lots;
  }, [filter, payload.lots]);
  const totals = useMemo(() => payload.summary.reduce((result, row) => ({ bars: result.bars + row.totalBars, reserved: result.reserved + row.reservedBars, available: result.available + row.availableBars, kg: result.kg + asNumber(row.availableWeightKg) }), { bars: 0, reserved: 0, available: 0, kg: 0 }), [payload.summary]);

  function editLot(lot: BilletLot) {
    setNotice(""); setError("");
    setDraft({ id: lot.id, alloyCode: lot.alloyCode, lotCode: lot.lotCode, barWeightKg: String(lot.barWeightKg), totalBars: String(lot.totalBars), status: lot.status, location: lot.location ?? "", receivedAt: lot.receivedAt.slice(0, 10), notes: lot.notes ?? "" });
  }

  async function saveLot() {
    if (!draft) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/billet-stock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        operation: "upsertLot", id: draft.id, alloyCode: draft.alloyCode, lotCode: draft.lotCode,
        barWeightKg: Number(draft.barWeightKg.replace(",", ".")), totalBars: Number(draft.totalBars), status: draft.status,
        location: draft.location, receivedAt: `${draft.receivedAt}T12:00:00.000Z`, notes: draft.notes,
      }) });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Não foi possível salvar o lote.");
      setDraft(null); setNotice("Lote salvo e registrado na auditoria."); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar o lote."); }
    finally { setSaving(false); }
  }

  if (loading) return <div className="grid min-h-72 place-items-center rounded-2xl border bg-white"><Loader2 className="size-7 animate-spin text-orange-500" /></div>;

  return <div className="space-y-4">
    {error ? <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"><TriangleAlert className="size-5 shrink-0" /><span className="flex-1">{error}</span><Button size="sm" variant="outline" onClick={() => void load()}><RefreshCw className="size-4" />Tentar novamente</Button></div> : null}
    {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div> : null}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric icon={Boxes} label="Barras físicas" value={formatNumber(totals.bars)} />
      <Metric icon={CircleGauge} label="Barras reservadas" value={formatNumber(totals.reserved)} tone="amber" />
      <Metric icon={PackageOpen} label="Barras disponíveis" value={formatNumber(totals.available)} tone="green" />
      <Metric icon={MapPin} label="Peso livre estimado" value={`${formatNumber(totals.kg, 0)} kg`} tone="blue" />
    </section>

    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <header className="flex flex-col gap-3 border-b px-5 py-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1"><h2 className="font-heading text-lg font-black text-slate-950">Lotes de tarugo</h2><p className="text-sm text-slate-500">O saldo livre desconta reservas ativas e ignora lotes bloqueados.</p></div>
        <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Buscar liga, lote ou local" className="h-10 min-w-64 rounded-xl border px-3 text-sm outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" />
        <Button className="h-10 bg-orange-600 px-4 text-white hover:bg-orange-700" onClick={() => setDraft(emptyDraft())}><Plus className="size-4" />Novo lote</Button>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Liga / lote</th><th className="px-4 py-3">Local</th><th className="px-4 py-3 text-right">kg/barra</th><th className="px-4 py-3 text-right">Físicas</th><th className="px-4 py-3 text-right">Peso físico</th><th className="px-4 py-3 text-right">Reservadas</th><th className="px-4 py-3 text-right">Livres</th><th className="px-4 py-3 text-right">Peso livre</th><th className="px-4 py-3">Status</th><th className="px-5 py-3 text-right">Ação</th></tr></thead>
          <tbody>{filteredLots.length ? filteredLots.map((lot) => <tr key={lot.id} className="border-t hover:bg-orange-50/30">
            <td className="px-5 py-3"><strong className="font-mono text-orange-600">{lot.alloyCode}</strong><span className="block text-xs text-slate-500">Lote {lot.lotCode} · entrada {new Date(lot.receivedAt).toLocaleDateString("pt-BR")}</span></td>
            <td className="px-4 py-3 text-slate-600">{lot.location || "—"}</td><td className="px-4 py-3 text-right tabular-nums">{formatNumber(asNumber(lot.barWeightKg), 1)}</td>
            <td className="px-4 py-3 text-right font-bold tabular-nums">{lot.totalBars}</td><td className="px-4 py-3 text-right font-bold tabular-nums">{formatNumber(lot.totalBars * asNumber(lot.barWeightKg), 0)} kg</td><td className="px-4 py-3 text-right font-bold tabular-nums text-amber-600">{lot.reservedBars}</td><td className="px-4 py-3 text-right text-lg font-black tabular-nums text-emerald-600">{lot.availableBars}</td><td className="px-4 py-3 text-right font-black tabular-nums text-blue-700">{formatNumber(lot.availableBars * asNumber(lot.barWeightKg), 0)} kg</td>
            <td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${statusClass[lot.status]}`}>{statusLabel[lot.status]}</span></td>
            <td className="px-5 py-3 text-right"><Button size="sm" variant="ghost" onClick={() => editLot(lot)}><Pencil className="size-4" />Editar</Button></td>
          </tr>) : <tr><td colSpan={10} className="h-40 text-center text-sm text-slate-400">Nenhum lote encontrado.</td></tr>}</tbody>
        </table>
      </div>
    </section>

    {draft ? <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4" role="dialog" aria-modal="true" aria-labelledby="billet-dialog-title">
      <section className="w-full max-w-3xl overflow-hidden rounded-2xl border bg-white shadow-2xl">
        <header className="flex items-start gap-3 border-b px-5 py-4"><span className="grid size-10 place-items-center rounded-xl bg-orange-50 text-orange-600"><PackageOpen className="size-5" /></span><div className="flex-1"><h2 id="billet-dialog-title" className="font-heading text-lg font-black">{draft.id ? "Editar lote" : "Cadastrar lote"}</h2><p className="text-xs text-slate-500">Informe a quantidade física. As reservas são controladas separadamente.</p></div><button type="button" aria-label="Fechar" onClick={() => setDraft(null)} className="rounded-lg p-2 hover:bg-slate-100"><X className="size-5" /></button></header>
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Liga"><input autoFocus value={draft.alloyCode} onChange={(event) => setDraft({ ...draft, alloyCode: event.target.value.toUpperCase() })} placeholder="Ex.: 6060" /></Field>
          <Field label="Código do lote"><input value={draft.lotCode} onChange={(event) => setDraft({ ...draft, lotCode: event.target.value })} placeholder="Ex.: L-2026-0815" /></Field>
          <Field label="Localização"><input value={draft.location} onChange={(event) => setDraft({ ...draft, location: event.target.value })} placeholder="Ex.: Rua A · posição 04" /></Field>
          <Field label="Quantidade de barras"><input type="number" min="0" step="1" value={draft.totalBars} onChange={(event) => setDraft({ ...draft, totalBars: event.target.value })} /></Field>
          <Field label="Peso por barra (kg)"><input type="number" min="0.001" step="0.001" value={draft.barWeightKg} onChange={(event) => setDraft({ ...draft, barWeightKg: event.target.value })} /></Field>
          <Field label="Data de entrada"><input type="date" value={draft.receivedAt} onChange={(event) => setDraft({ ...draft, receivedAt: event.target.value })} /></Field>
          <Field label="Status"><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as BilletLot["status"] })}><option value="available">Disponível</option><option value="blocked">Bloqueado</option><option value="depleted">Esgotado</option></select></Field>
          <label className="sm:col-span-2 text-sm font-bold text-slate-800">Observações<textarea rows={3} value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Certificado, condição, restrição ou referência." className="mt-1.5 w-full resize-none rounded-xl border px-3 py-2 font-medium outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100" /></label>
        </div>
        <footer className="flex justify-end gap-2 border-t bg-slate-50 px-5 py-3"><Button variant="outline" onClick={() => setDraft(null)}>Cancelar</Button><Button disabled={saving || !draft.alloyCode.trim() || !draft.lotCode.trim() || !draft.receivedAt} className="bg-orange-600 text-white hover:bg-orange-700" onClick={() => void saveLot()}>{saving ? <Loader2 className="size-4 animate-spin" /> : <PackageOpen className="size-4" />}Salvar lote</Button></footer>
      </section>
    </div> : null}
  </div>;
}

function Metric({ icon: Icon, label, value, tone = "slate" }: { icon: typeof Boxes; label: string; value: string; tone?: "slate" | "amber" | "green" | "blue" }) {
  const colors = { slate: "bg-slate-100 text-slate-700", amber: "bg-amber-50 text-amber-600", green: "bg-emerald-50 text-emerald-600", blue: "bg-blue-50 text-blue-600" };
  return <div className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm"><span className={`grid size-10 place-items-center rounded-xl ${colors[tone]}`}><Icon className="size-5" /></span><div><p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p><p className="text-lg font-black text-slate-900">{value}</p></div></div>;
}

function Field({ label, children }: { label: string; children: React.ReactElement<{ className?: string }> }) {
  return <label className="text-sm font-bold text-slate-800">{label}<span className="[&>*]:mt-1.5 [&>*]:h-11 [&>*]:w-full [&>*]:rounded-xl [&>*]:border [&>*]:bg-white [&>*]:px-3 [&>*]:font-medium [&>*]:outline-none focus-within:[&>*]:border-orange-400 focus-within:[&>*]:ring-2 focus-within:[&>*]:ring-orange-100">{children}</span></label>;
}
