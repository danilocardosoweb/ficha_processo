"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrainCircuit, CheckCircle2, Loader2, RefreshCw, Save, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { defaultIntelligenceWeights, type IntelligenceWeights } from "@/modules/planning/planning-intelligence";

type ModelOption = { id: string; name: string };
type OpenRouterModel = ModelOption & { contextLength?: number | null };

const directModels: Record<IntelligenceWeights["aiProvider"], ModelOption[]> = {
  openai: [
    { id: "gpt-4.1-mini", name: "GPT-4.1 mini · rápido e econômico" },
    { id: "gpt-4.1", name: "GPT-4.1 · maior capacidade de análise" },
    { id: "gpt-5-mini", name: "GPT-5 mini · raciocínio mais forte" },
    { id: "gpt-4o-mini", name: "GPT-4o mini · alternativa econômica" },
  ],
  openrouter: [],
  lmstudio: [],
  openclaw: [],
};

function WeightField({ label, value, onChange, samples = false }: { label: string; value: number; onChange: (value: number) => void; samples?: boolean }) {
  return <label className="text-sm font-bold text-slate-800">{label}<div className="mt-1.5 flex h-11 items-center rounded-xl border bg-white px-3"><input type="number" min="0" max={samples ? 100 : 100} value={value} onChange={(event) => onChange(Number(event.target.value))} className="min-w-0 flex-1 outline-none" /><span className="text-xs font-bold text-slate-400">{samples ? "execuções" : "%"}</span></div></label>;
}

function NumberField({ label, value, suffix, onChange, max }: { label: string; value: number; suffix: string; onChange: (value: number) => void; max?: number }) {
  return <label className="text-sm font-bold text-slate-800">{label}<div className="mt-1.5 flex h-11 items-center rounded-xl border bg-white px-3"><input type="number" min="1" max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="min-w-0 flex-1 outline-none" /><span className="text-xs font-semibold text-slate-400">{suffix}</span></div></label>;
}

export function PlanningIntelligenceSettings() {
  const [draft, setDraft] = useState<IntelligenceWeights>(defaultIntelligenceWeights);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [catalog, setCatalog] = useState<OpenRouterModel[]>([]);
  const [catalogState, setCatalogState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const total = useMemo(() => draft.thermal + draft.resources + draft.material + draft.delivery + draft.flow + draft.holeSequence + draft.shortRun, [draft]);
  const update = (patch: Partial<IntelligenceWeights>) => setDraft((current) => ({ ...current, ...patch }));

  const loadSettings = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/planning-intelligence", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { settings?: IntelligenceWeights; aiConfigured?: boolean; error?: string } | null;
      if (!response.ok || !payload?.settings) throw new Error(payload?.error || "Não foi possível carregar os critérios.");
      setDraft({ ...defaultIntelligenceWeights, ...payload.settings });
      setConfigured(Boolean(payload.aiConfigured));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível carregar os critérios.");
    } finally { setLoading(false); }
  }, []);

  const loadCatalog = useCallback(async () => {
    setCatalogState("loading");
    try {
      const response = await fetch("/api/planning-ai", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { models?: OpenRouterModel[]; error?: string } | null;
      if (!response.ok || !Array.isArray(payload?.models)) throw new Error(payload?.error || "Catálogo indisponível.");
      setCatalog(payload.models.filter((model) => model.id !== "openrouter/auto"));
      setCatalogState("ready");
    } catch { setCatalogState("error"); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSettings(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSettings]);

  async function save() {
    setSaving(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/planning-intelligence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const payload = await response.json().catch(() => null) as { settings?: IntelligenceWeights; error?: string } | null;
      if (!response.ok || !payload?.settings) throw new Error(payload?.error || "Não foi possível salvar os critérios.");
      setDraft(payload.settings);
      setNotice("Configurações de critérios e IA salvas e registradas na auditoria.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar os critérios.");
    } finally { setSaving(false); }
  }

  if (loading) return <section className="grid min-h-72 place-items-center rounded-2xl border bg-white"><Loader2 className="size-7 animate-spin text-violet-600" /></section>;

  return <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
    <header className="flex flex-col gap-4 border-b px-5 py-5 md:flex-row md:items-start md:px-6">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700"><BrainCircuit className="size-5" /></span>
      <div className="flex-1"><p className="text-[10px] font-black uppercase tracking-[.16em] text-violet-600">Planejamento e IA</p><h2 className="font-heading text-xl font-black text-slate-950">Critérios e analista IA do AluPilot</h2><p className="mt-1 text-sm text-slate-500">Administre regras de decisão e a conexão da IA sem ocupar as telas operacionais.</p></div>
      <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ${configured ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-900"}`}>{configured ? "Servidor de IA configurado" : "Chave de IA pendente"}</span>
    </header>
    <div className="space-y-6 p-5 md:p-6">
      <div><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-heading font-bold text-slate-900">Pesos da decisão</h3><p className="text-xs text-slate-500">Definem como a sequência é avaliada pelo motor determinístico.</p></div><span className={`rounded-xl px-3 py-2 text-sm font-bold ${total === 100 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>Soma: {total}%</span></div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <WeightField label="Cobertura térmica" value={draft.thermal} onChange={(thermal) => update({ thermal })} />
          <WeightField label="Recursos físicos" value={draft.resources} onChange={(resources) => update({ resources })} />
          <WeightField label="Material" value={draft.material} onChange={(material) => update({ material })} />
          <WeightField label="Prazo" value={draft.delivery} onChange={(delivery) => update({ delivery })} />
          <WeightField label="Fluidez" value={draft.flow} onChange={(flow) => update({ flow })} />
          <WeightField label="Sequência de furos" value={draft.holeSequence} onChange={(holeSequence) => update({ holeSequence })} />
          <WeightField label="Corridas curtas" value={draft.shortRun} onChange={(shortRun) => update({ shortRun })} />
          <WeightField label="Amostras para calibrar" value={draft.minimumConfidenceSamples} samples onChange={(minimumConfidenceSamples) => update({ minimumConfidenceSamples })} />
        </div>
      </div>

      <div className="rounded-2xl border bg-slate-50 p-4"><h3 className="font-heading font-bold text-slate-900">Limites operacionais</h3><p className="mt-1 text-xs text-slate-500">Ajuste parâmetros da fábrica sem alterar o código.</p><div className="mt-4 grid gap-4 sm:grid-cols-3"><NumberField label="Furos considerados altos" value={draft.highHoleThreshold} suffix="furos" max={100} onChange={(highHoleThreshold) => update({ highHoleThreshold })} /><NumberField label="Máximo consecutivo" value={draft.maxConsecutiveHighHoleTools} suffix="ferramentas" max={20} onChange={(maxConsecutiveHighHoleTools) => update({ maxConsecutiveHighHoleTools })} /><NumberField label="Volume baixo" value={draft.lowVolumeThresholdKg} suffix="kg" onChange={(lowVolumeThresholdKg) => update({ lowVolumeThresholdKg })} /></div></div>

      <div className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><h3 className="font-heading font-bold text-slate-900">Analista IA</h3><p className="mt-1 text-xs text-slate-600">A chave fica apenas no servidor; esta tela não exibe nem salva segredos.</p></div><label className="flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={draft.aiEnabled} onChange={(event) => update({ aiEnabled: event.target.checked })} className="size-4 accent-violet-600" />Ativar IA</label></div>
        {!configured ? <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Cadastre a chave do provedor no ambiente do servidor antes de ativar. Para uso local, o LM Studio não exige chave de nuvem.</p> : null}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-bold text-slate-800">Provedor de IA<select value={draft.aiProvider} onChange={(event) => { const aiProvider = event.target.value as IntelligenceWeights["aiProvider"]; update({ aiProvider, aiModelMode: aiProvider === "openrouter" ? draft.aiModelMode : "manual", aiModel: aiProvider === "openrouter" ? draft.aiModel || "openrouter/auto" : aiProvider === "lmstudio" && draft.aiModel !== "openrouter/auto" ? draft.aiModel : "" }); }} className="mt-1.5 h-11 w-full rounded-xl border bg-white px-3"><option value="openrouter">OpenRouter</option><option value="lmstudio">LM Studio · local</option><option value="openai">OpenAI API</option><option value="openclaw">OpenClaw · servidor aprovado</option></select></label>
          <label className="text-sm font-bold text-slate-800">Endpoint do provedor<input value={draft.aiProviderEndpoint} onChange={(event) => update({ aiProviderEndpoint: event.target.value })} placeholder={draft.aiProvider === "lmstudio" ? "http://127.0.0.1:1234/v1" : draft.aiProvider === "openclaw" ? "https://servidor-aprovado/v1" : "Padrão seguro do provedor"} className="mt-1.5 h-11 w-full rounded-xl border bg-white px-3 font-normal" /><span className="mt-1 block text-[10px] font-normal text-slate-500">Endpoints externos são conferidos pelo servidor.</span></label>
          <label className="flex items-start gap-2 rounded-xl border bg-white p-3 text-xs text-slate-700 sm:col-span-2"><input type="checkbox" checked={draft.aiExternalDataEnabled} onChange={(event) => update({ aiExternalDataEnabled: event.target.checked })} className="mt-0.5 size-4 accent-violet-600" /><span><strong className="block text-sm text-slate-900">Permitir enviar o pacote mínimo a um provedor externo</strong>Desative para impedir uso de OpenAI, OpenRouter e OpenClaw. O LM Studio local continua disponível.</span></label>
          {draft.aiProvider === "openrouter" ? <><label className="text-sm font-bold text-slate-800">Seleção do modelo<select value={draft.aiModelMode} onChange={(event) => { const aiModelMode = event.target.value as "auto" | "manual"; update({ aiModelMode, aiModel: aiModelMode === "auto" ? "openrouter/auto" : draft.aiModel }); if (aiModelMode === "manual" && catalogState !== "ready") void loadCatalog(); }} className="mt-1.5 h-11 w-full rounded-xl border bg-white px-3"><option value="auto">Automática · recomendada</option><option value="manual">Modelo específico</option></select></label><label className="text-sm font-bold text-slate-800">Modelo OpenRouter{draft.aiModelMode === "auto" ? <div className="mt-1.5 flex h-11 items-center rounded-xl border bg-slate-100 px-3 text-sm font-normal text-slate-600">Automático · o OpenRouter escolhe o modelo</div> : catalogState === "ready" && catalog.length ? <select value={draft.aiModel === "openrouter/auto" ? "" : draft.aiModel} onChange={(event) => update({ aiModel: event.target.value })} className="mt-1.5 h-11 w-full rounded-xl border bg-white px-3 font-normal"><option value="" disabled>Selecione um modelo</option>{catalog.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.id}</option>)}</select> : <div className="mt-1.5 flex gap-2"><input value={draft.aiModel === "openrouter/auto" ? "" : draft.aiModel} onChange={(event) => update({ aiModel: event.target.value })} placeholder="provedor/modelo" className="h-11 min-w-0 flex-1 rounded-xl border bg-white px-3 font-normal" /><Button type="button" variant="outline" onClick={() => void loadCatalog()} disabled={catalogState === "loading"}>{catalogState === "loading" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}</Button></div>}</label></> : <label className="text-sm font-bold text-slate-800 sm:col-span-2">Modelo{directModels[draft.aiProvider].length ? <select value={directModels[draft.aiProvider].some((model) => model.id === draft.aiModel) ? draft.aiModel : "custom"} onChange={(event) => update({ aiModel: event.target.value === "custom" ? "" : event.target.value })} className="mt-1.5 h-11 w-full rounded-xl border bg-white px-3 font-normal"><option value="" disabled>Selecione um modelo</option>{directModels[draft.aiProvider].map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}<option value="custom">Outro identificador…</option></select> : null}{(!directModels[draft.aiProvider].length || !directModels[draft.aiProvider].some((model) => model.id === draft.aiModel)) ? <input value={draft.aiModel === "openrouter/auto" ? "" : draft.aiModel} onChange={(event) => update({ aiModel: event.target.value })} placeholder={draft.aiProvider === "lmstudio" ? "Identificador do modelo carregado no LM Studio" : "Modelo configurado neste provedor"} className="mt-1.5 h-11 w-full rounded-xl border bg-white px-3 font-normal" /> : null}</label>}
          <NumberField label="Máximo de recomendações" value={draft.aiMaxRecommendations} suffix="itens" max={12} onChange={(aiMaxRecommendations) => update({ aiMaxRecommendations })} />
          <div className="rounded-xl border bg-white p-3 text-xs text-slate-600"><strong className="block text-sm text-slate-900">Uso seguro</strong>O assistente só consulta dados autorizados; ele não inicia produção nem altera registros.</div>
          <label className="text-sm font-bold text-slate-800 sm:col-span-2">Personalidade da analista<textarea rows={4} value={draft.aiPersonalityPrompt} onChange={(event) => update({ aiPersonalityPrompt: event.target.value })} className="mt-1.5 w-full rounded-xl border bg-white px-3 py-2 font-normal outline-none focus:border-violet-400" /></label>
          <label className="text-sm font-bold text-slate-800 sm:col-span-2">Critérios adicionais para observar<textarea rows={5} value={draft.aiAnalysisCriteria} onChange={(event) => update({ aiAnalysisCriteria: event.target.value })} className="mt-1.5 w-full rounded-xl border bg-white px-3 py-2 font-normal outline-none focus:border-violet-400" /></label>
        </div>
      </div>
      {error ? <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
      {notice ? <p className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{notice}</p> : null}
    </div>
    <footer className="flex justify-end border-t bg-slate-50 px-5 py-4 md:px-6"><Button onClick={() => void save()} disabled={saving || total !== 100 || (draft.aiProvider === "openrouter" ? draft.aiModelMode === "manual" && (!draft.aiModel || draft.aiModel === "openrouter/auto") : !draft.aiModel)}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}{saving ? "Salvando…" : "Salvar critérios e IA"}</Button></footer>
  </section>;
}
