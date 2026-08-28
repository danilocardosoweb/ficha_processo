"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  CopyPlus,
  FilePlus2,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoolingModeSelect } from "@/components/cooling-mode-select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { createClient, withSupabaseTimeout } from "@/lib/supabase/client";
import {
  getOfflineSnapshot,
  normalizeCode,
  requestOfflineSync,
} from "@/lib/offline-store";

type Machine = { code: string; name: string };
type CatalogOption = {
  id: string;
  catalog_type: string;
  code: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};
type Parameters = {
  extrusion?: {
    profile_linear_weight_kg_m?: number;
    total_linear_weight_kg_m?: number;
    holes?: number;
    cuts_per_pull?: number;
    cut_length_mm?: number;
    discard_mm?: number;
    cut_length_m?: number;
    discard_m?: number;
    ram_speed_mm_s?: number;
    initial_pressure?: number;
    target_productivity_kg_h?: number;
  };
  temperatures?: {
    billet_c?: number;
    container_c?: number;
    die_c?: number;
    exit_c?: number;
    zone_1_c?: number;
    zone_2_c?: number;
    zone_3_c?: number;
    zone_4_c?: number;
    exit_min_c?: number;
    exit_max_c?: number;
  };
  pulling?: {
    puller_speed_mm_min?: number;
    puller_speed_m_min?: number;
    stretch_percent?: number;
  };
  cooling?: { mode?: string; notes?: string };
  saw?: { piece_length_mm?: number; tolerance_mm?: number };
  billet?: {
    casing?: string;
    linear_weight_kg_m?: number;
    nominal_weight_kg_m?: number;
    loss_factor?: number;
    operational_margin?: number;
    calculated_length_mm?: number;
    calculated_pull_mm?: number;
    calculated_pull_m?: number;
    butt_mm?: number;
  };
  notes?: string;
  [key: string]: unknown;
};
type ProcessSheet = {
  id: string;
  machine_code: string | null;
  tool_code: string;
  product_code: string | null;
  alloy_code: string;
  temper: string | null;
  revision: number;
  tool_sequence: number | null;
  parameters: Parameters;
  is_active: boolean;
  updated_at: string;
  achieved_productivity_kg_h?: number | null;
  achieved_productivity_recorded_at?: string | null;
  copied_from_process_sheet_id?: string | null;
  copied_from_sequence?: number | null;
};

const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;
const pageSize = 30;
const numberFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});
const num = (form: FormData, key: string, fallback = 0) =>
  Number(String(form.get(key) ?? "").replace(",", ".")) || fallback;
const millimeters = (mm?: number, legacyM?: number) =>
  mm ?? (legacyM == null ? undefined : legacyM * 1000);
const cutLengthMm = (p: Parameters) =>
  millimeters(p.extrusion?.cut_length_mm, p.extrusion?.cut_length_m);
const discardMm = (p: Parameters) =>
  millimeters(p.extrusion?.discard_mm, p.extrusion?.discard_m);
const pullerSpeedMmMin = (p: Parameters) =>
  millimeters(p.pulling?.puller_speed_mm_min, p.pulling?.puller_speed_m_min);
const formatMm = (value?: number) =>
  value == null ? "—" : `${numberFormatter.format(value)} mm`;
const sanitizeToken = (value: string) => normalizeCode(value);
export function ProcessSheetsManager({
  initialToolCode = "",
  returnToProductionInitially = false,
}: {
  initialToolCode?: string;
  returnToProductionInitially?: boolean;
}) {
  const router = useRouter();
  const normalizedInitialTool = normalizeCode(initialToolCode);
  const [sheets, setSheets] = useState<ProcessSheet[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [draft, setDraft] = useState<ProcessSheet | null>(null);
  const [newSequence, setNewSequence] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [searchInput, setSearchInput] = useState(normalizedInitialTool);
  const [search, setSearch] = useState(normalizedInitialTool);
  const [cutFilter, setCutFilter] = useState("");
  const [cutOptions, setCutOptions] = useState<number[]>([]);
  const [loadingCuts, setLoadingCuts] = useState(false);
  const [machineFilter, setMachineFilter] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [creationGuideOpen, setCreationGuideOpen] = useState(
    Boolean(normalizedInitialTool),
  );
  const [requestedToolCode, setRequestedToolCode] = useState(
    normalizedInitialTool,
  );
  const [returnToProduction, setReturnToProduction] = useState(
    returnToProductionInitially,
  );
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateOptions, setTemplateOptions] = useState<ProcessSheet[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(
    Boolean(normalizedInitialTool),
  );
  const [targetSequence, setTargetSequence] = useState<number | null>(null);

  const visibleTemplates = useMemo(() => {
    const token = normalizeCode(templateSearch);
    return templateOptions
      .filter((sheet) => {
        if (!token) return true;
        return normalizeCode(
          `${sheet.product_code ?? ""} ${sheet.tool_code} ${sheet.machine_code ?? ""} ${sheet.alloy_code} ${sheet.temper ?? ""}`,
        ).includes(token);
      })
      .slice(0, 20);
  }, [templateOptions, templateSearch]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(0);
      setSearch(searchInput.trim());
      setCutFilter("");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!organizationId) return;
    const timer = window.setTimeout(async () => {
      try {
        const { data, error: machineError } = await withSupabaseTimeout(
          createClient()
            .from("machines")
            .select("code,name")
            .eq("organization_id", organizationId)
            .eq("is_active", true)
            .order("code"),
          30000,
        );
        if (!machineError) setMachines((data ?? []) as Machine[]);
      } catch {
        const cached = await getOfflineSnapshot<Machine>("machines");
        if (cached) setMachines(cached.rows);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!organizationId) return;
    let active = true;
    async function loadCatalog() {
      try {
        const { data, error: catalogError } = await withSupabaseTimeout(
          createClient()
            .from("operational_catalogs")
            .select("id,catalog_type,code,label,sort_order,is_active")
            .eq("organization_id", organizationId)
            .in("catalog_type", ["alloy", "cooling_mode", "billet_casing"])
            .eq("is_active", true)
            .order("catalog_type")
            .order("sort_order"),
          30000,
        );
        if (catalogError) throw catalogError;
        if (active) setCatalog((data ?? []) as CatalogOption[]);
      } catch {
        const cached = await getOfflineSnapshot<CatalogOption>(
          "operational_catalogs",
        );
        if (active)
          setCatalog(
            (cached?.rows ?? []).filter((option) =>
              ["alloy", "cooling_mode", "billet_casing"].includes(
                option.catalog_type,
              ),
            ),
          );
      }
    }
    void loadCatalog();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!requestedToolCode) return;

    let cancelled = false;

    async function loadTemplates() {
      try {
        if (!organizationId) throw new Error("Organização não configurada.");
        const { data, error: templateError } = await withSupabaseTimeout(
          createClient()
            .from("process_sheets")
            .select(
              "id,machine_code,tool_code,product_code,alloy_code,temper,revision,tool_sequence,parameters,is_active,updated_at,achieved_productivity_kg_h,achieved_productivity_recorded_at,copied_from_process_sheet_id,copied_from_sequence",
            )
            .eq("organization_id", organizationId)
            .eq("is_active", true)
            .order("updated_at", { ascending: false })
            .limit(250),
          30000,
        );
        if (templateError) throw templateError;
        if (!cancelled) setTemplateOptions((data ?? []) as ProcessSheet[]);
      } catch {
        const cached = await getOfflineSnapshot<ProcessSheet>("process_sheets");
        if (!cancelled)
          setTemplateOptions(
            (cached?.rows ?? []).filter((sheet) => sheet.is_active),
          );
      } finally {
        if (!cancelled) setLoadingTemplates(false);
      }
    }

    void loadTemplates();
    return () => {
      cancelled = true;
    };
  }, [requestedToolCode]);

  useEffect(() => {
    if (!organizationId || !search) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLoadingCuts(true);
      try {
        const token = sanitizeToken(search);
        const { data, error: cutError } = await withSupabaseTimeout(
          createClient()
            .from("process_sheets")
            .select("parameters")
            .eq("organization_id", organizationId)
            .ilike("tool_search", `%${token}%`)
            .limit(1000),
          30000,
        );
        if (!cancelled && !cutError) {
          const values = [
            ...new Set(
              ((data ?? []) as { parameters: Parameters }[])
                .map((row) => cutLengthMm(row.parameters))
                .filter((value): value is number => value != null && value > 0),
            ),
          ].sort((a, b) => a - b);
          setCutOptions(values);
        } else if (!cancelled) {
          const cached =
            await getOfflineSnapshot<ProcessSheet>("process_sheets");
          const values = [
            ...new Set(
              (cached?.rows ?? [])
                .filter((row) =>
                  normalizeCode(row.product_code || row.tool_code).includes(
                    token,
                  ),
                )
                .map((row) => cutLengthMm(row.parameters))
                .filter((value): value is number => value != null && value > 0),
            ),
          ].sort((a, b) => a - b);
          setCutOptions(values);
        }
      } catch {
        if (!cancelled) {
          const cached =
            await getOfflineSnapshot<ProcessSheet>("process_sheets");
          const values = [
            ...new Set(
              (cached?.rows ?? [])
                .filter((row) =>
                  normalizeCode(row.product_code || row.tool_code).includes(
                    sanitizeToken(search),
                  ),
                )
                .map((row) => cutLengthMm(row.parameters))
                .filter((value): value is number => value != null && value > 0),
            ),
          ].sort((a, b) => a - b);
          setCutOptions(values);
        }
      } finally {
        if (!cancelled) setLoadingCuts(false);
      }
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  const showCached = useCallback(
    async (notice: string) => {
      const snapshot = await getOfflineSnapshot<ProcessSheet>("process_sheets");
      if (!snapshot) return false;
      const token = sanitizeToken(search);
      const filtered = snapshot.rows
        .filter((sheet) => {
          if (!normalizeCode(sheet.product_code || "")) return false;
          if (machineFilter && sheet.machine_code !== machineFilter)
            return false;
          if (
            token &&
            !normalizeCode(sheet.product_code || sheet.tool_code).includes(
              token,
            )
          )
            return false;
          return (
            !cutFilter || cutLengthMm(sheet.parameters) === Number(cutFilter)
          );
        })
        .sort(
          (a, b) =>
            (a.product_code || a.tool_code).localeCompare(
              b.product_code || b.tool_code,
              "pt-BR",
            ) ||
            (a.machine_code || "").localeCompare(b.machine_code || "", "pt-BR"),
        );
      setSheets(filtered.slice(page * pageSize, (page + 1) * pageSize));
      setTotal(filtered.length);
      setError(notice);
      return true;
    },
    [cutFilter, machineFilter, page, search],
  );

  const load = useCallback(async () => {
    if (!organizationId) {
      setError("Organização padrão não configurada.");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const supabase = createClient();
      let query = supabase
        .from("process_sheets")
        .select(
          "id,machine_code,tool_code,product_code,alloy_code,temper,revision,tool_sequence,parameters,is_active,updated_at,achieved_productivity_kg_h,achieved_productivity_recorded_at,copied_from_process_sheet_id,copied_from_sequence",
          { count: "exact" },
        )
        .eq("organization_id", organizationId)
        .neq("tool_search", "");
      if (machineFilter) query = query.eq("machine_code", machineFilter);
      const token = sanitizeToken(search);
      if (token) query = query.ilike("tool_search", `%${token}%`);
      if (cutFilter) {
        const cutMm = Number(cutFilter);
        query = query.or(
          `parameters->extrusion->>cut_length_mm.eq.${cutMm},parameters->extrusion->>cut_length_m.eq.${cutMm / 1000},parameters->saw->>piece_length_mm.eq.${cutMm}`,
        );
      }
      const {
        data,
        error: sheetError,
        count,
      } = await withSupabaseTimeout(
        query
          .order("product_code")
          .order("tool_code")
          .order("machine_code")
          .range(page * pageSize, (page + 1) * pageSize - 1),
        30000,
      );
      if (sheetError) {
        if (
          !(await showCached(
            `Sem conexão com o banco. Exibindo as fichas salvas neste computador. (${sheetError.message})`,
          ))
        )
          setError(sheetError.message);
      } else {
        setError("");
        setSheets((data ?? []) as ProcessSheet[]);
        setTotal(count ?? 0);
      }
    } catch {
      if (
        !(await showCached(
          "Modo offline: exibindo as fichas salvas neste computador.",
        ))
      )
        setError(
          "Não foi possível conectar ao Supabase e ainda não há uma cópia local das fichas.",
        );
    } finally {
      setLoading(false);
    }
  }, [cutFilter, machineFilter, page, search, showCached]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function openNewSheet() {
    setDraft(null);
    setNewSequence(false);
    setRequestedToolCode("");
    setTargetSequence(null);
    setReturnToProduction(false);
    setError("");
    setMessage("");
    setFormOpen(true);
  }
  function openSheet(sheet: ProcessSheet, sequenceMode: boolean) {
    setDraft(sheet);
    setNewSequence(sequenceMode);
    setRequestedToolCode("");
    setTargetSequence(null);
    setReturnToProduction(false);
    setError("");
    setMessage("");
    setFormOpen(true);
  }
  function openBlankForRequested() {
    setDraft(null);
    setNewSequence(false);
    setTargetSequence(1);
    setError("");
    setMessage("");
    setCreationGuideOpen(false);
    setFormOpen(true);
  }
  function copyTemplateForRequested(sheet: ProcessSheet) {
    setDraft(sheet);
    setNewSequence(true);
    setTargetSequence(1);
    setError("");
    setMessage("");
    setCreationGuideOpen(false);
    setFormOpen(true);
  }
  function clearFilters() {
    setSearchInput("");
    setSearch("");
    setCutFilter("");
    setMachineFilter("");
    setPage(0);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setMessage("");
    if (!organizationId) {
      setError("Organização padrão não configurada.");
      setSaving(false);
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const profileWeight = num(form, "profile_linear_weight_kg_m");
    const holes = num(form, "holes", 1);
    const cuts = num(form, "cuts_per_pull", 1);
    const cutMm = num(form, "cut_length_mm");
    const discardLengthMm = num(form, "discard_mm");
    const billetLinear = num(form, "billet_linear_weight_kg_m", 67.2);
    const billetNominal = num(form, "billet_nominal_weight_kg_m", 69.92);
    const lossFactor = num(form, "loss_factor", 0.063);
    const margin = num(form, "operational_margin", 0.07);
    const totalLinearWeight = profileWeight * holes;
    const requiredWeight =
      totalLinearWeight * ((cuts * cutMm + discardLengthMm) / 1000);
    const billetLengthMm =
      billetLinear > 0
        ? (requiredWeight / billetLinear) * (1 + margin) * 1000
        : 0;
    const pullLengthMm =
      totalLinearWeight > 0
        ? (billetLengthMm * billetLinear -
            billetLengthMm * billetNominal * lossFactor) /
          totalLinearWeight
        : 0;

    const existing = draft?.parameters ?? {};
    const extrusion = { ...existing.extrusion };
    delete extrusion.cut_length_m;
    delete extrusion.discard_m;
    const pulling = { ...existing.pulling };
    delete pulling.puller_speed_m_min;
    const billet = { ...existing.billet };
    delete billet.calculated_pull_m;
    const parameters: Parameters = {
      ...existing,
      extrusion: {
        ...extrusion,
        profile_linear_weight_kg_m: profileWeight,
        total_linear_weight_kg_m: Number(totalLinearWeight.toFixed(6)),
        holes,
        cuts_per_pull: cuts,
        cut_length_mm: cutMm,
        discard_mm: discardLengthMm,
        ram_speed_mm_s: num(form, "ram_speed_mm_s"),
        initial_pressure: num(form, "initial_pressure"),
        target_productivity_kg_h: num(form, "target_productivity_kg_h"),
      },
      temperatures: {
        ...existing.temperatures,
        billet_c: num(form, "billet_c"),
        container_c: num(form, "container_c"),
        die_c: num(form, "die_c"),
        exit_c: num(form, "exit_c"),
        zone_1_c: num(form, "zone_1_c"),
        zone_2_c: num(form, "zone_2_c"),
        zone_3_c: num(form, "zone_3_c"),
        zone_4_c: num(form, "zone_4_c"),
        exit_min_c: num(form, "exit_min_c"),
        exit_max_c: num(form, "exit_max_c"),
      },
      pulling: {
        ...pulling,
        puller_speed_mm_min: num(form, "puller_speed_mm_min"),
        stretch_percent: num(form, "stretch_percent"),
      },
      cooling: {
        ...existing.cooling,
        mode: String(form.get("cooling_mode") ?? ""),
        notes: String(form.get("cooling_notes") ?? ""),
      },
      saw: {
        ...existing.saw,
        piece_length_mm: num(form, "piece_length_mm"),
        tolerance_mm: num(form, "tolerance_mm"),
      },
      billet: {
        ...billet,
        casing: String(form.get("billet_casing") ?? ""),
        linear_weight_kg_m: billetLinear,
        nominal_weight_kg_m: billetNominal,
        loss_factor: lossFactor,
        operational_margin: margin,
        calculated_length_mm: Number(billetLengthMm.toFixed(1)),
        calculated_pull_mm: Number(pullLengthMm.toFixed(1)),
        butt_mm: num(form, "butt_mm"),
      },
      notes: String(form.get("notes") ?? ""),
    };
    const actualToolCode = String(form.get("product_code") ?? "")
      .trim()
      .toUpperCase();
    const toolSequence = num(form, "tool_sequence", 1);
    const payload = {
      organization_id: organizationId,
      machine_code: String(form.get("machine_code") ?? "") || null,
      tool_code: requestedToolCode
        ? actualToolCode
        : draft?.tool_code || actualToolCode,
      product_code: actualToolCode,
      alloy_code: String(form.get("alloy_code")).trim().toUpperCase(),
      temper:
        String(form.get("temper") ?? "")
          .trim()
          .toUpperCase() || null,
      tool_sequence: toolSequence,
      revision: toolSequence,
      parameters,
      is_active: form.get("is_active") === "on",
    };
    const supabase = createClient();
    const query =
      draft && !newSequence
        ? supabase.from("process_sheets").update(payload).eq("id", draft.id)
        : supabase.from("process_sheets").insert({
            ...payload,
            copied_from_process_sheet_id: draft?.id ?? null,
            copied_from_sequence:
              draft == null ? null : draft.tool_sequence ?? draft.revision,
            achieved_productivity_kg_h: null,
            achieved_productivity_recorded_at: null,
          });
    try {
      const { error: saveError } = await withSupabaseTimeout(query);
      if (saveError)
        setError(
          saveError.code === "23505"
            ? "Já existe uma ficha para esta ferramenta, sequência, liga e prensa."
            : saveError.message,
        );
      else {
        const shouldReturn = returnToProduction && Boolean(requestedToolCode);
        const savedToolCode = actualToolCode;
        setMessage(
          draft && !newSequence
            ? "Ficha atualizada com sucesso."
            : "Ficha de processo criada.",
        );
        setFormOpen(false);
        setDraft(null);
        setNewSequence(false);
        setRequestedToolCode("");
        setTargetSequence(null);
        formElement.reset();
        requestOfflineSync("process_sheets");
        if (shouldReturn) {
          router.push(`/producao?tool=${encodeURIComponent(savedToolCode)}`);
          return;
        }
        await load();
      }
    } catch {
      setError(
        "Não foi possível salvar. Verifique a conexão com o Supabase e tente novamente.",
      );
    } finally {
      setSaving(false);
    }
  }

  const parameters = draft?.parameters ?? {};
  const sequence =
    targetSequence ??
    (newSequence
      ? (draft?.tool_sequence ?? draft?.revision ?? 0) + 1
      : (draft?.tool_sequence ?? draft?.revision ?? 1));
  const hasFilters = Boolean(searchInput || cutFilter || machineFilter);
  const firstResult = total === 0 ? 0 : page * pageSize + 1;
  const lastResult = Math.min((page + 1) * pageSize, total);

  return (
    <>
      <section className="flex h-[calc(100dvh-210px)] min-h-[420px] flex-col overflow-hidden rounded-xl border bg-white shadow-sm">
        <div className="border-b p-4 lg:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="font-heading text-lg font-bold">
                Fichas cadastradas
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {total.toLocaleString("pt-BR")} ficha(s) encontrada(s). Pesquise
                por qualquer dado da ficha.
              </p>
            </div>
            <Button
              type="button"
              className="h-10 bg-orange-500 font-semibold hover:bg-orange-600"
              onClick={openNewSheet}
            >
              <FilePlus2 className="size-4" />
              Nova ficha
            </Button>
          </div>
          <div className="mt-4 flex flex-col gap-2 lg:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={searchInput}
                onChange={(e) => {
                  setSearchInput(e.target.value);
                  setCutOptions([]);
                  setCutFilter("");
                }}
                className="h-10 pl-9 pr-10"
                placeholder="Ferramenta, ex.: 19-0065"
                aria-label="Filtrar por ferramenta"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="absolute right-2 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100"
                  aria-label="Limpar pesquisa"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <div className="relative min-w-56">
              <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <select
                value={cutFilter}
                onChange={(e) => {
                  setCutFilter(e.target.value);
                  setPage(0);
                }}
                disabled={!search || loadingCuts || cutOptions.length === 0}
                className="h-10 w-full appearance-none rounded-md border border-slate-200 bg-white pl-9 pr-8 text-sm outline-none focus:border-orange-400 disabled:bg-slate-50 disabled:text-slate-400"
                aria-label="Filtrar por comprimento de corte"
              >
                <option value="">
                  {loadingCuts
                    ? "Consultando cortes..."
                    : search
                      ? "Todos os comprimentos"
                      : "Informe a ferramenta primeiro"}
                </option>
                {cutOptions.map((cut) => (
                  <option key={cut} value={cut}>
                    {formatMm(cut)}
                  </option>
                ))}
              </select>
            </div>
            <div className="relative min-w-52">
              <SlidersHorizontal className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <select
                value={machineFilter}
                onChange={(e) => {
                  setMachineFilter(e.target.value);
                  setPage(0);
                }}
                className="h-10 w-full appearance-none rounded-md border border-slate-200 bg-white pl-9 pr-8 text-sm outline-none focus:border-orange-400"
                aria-label="Filtrar por prensa"
              >
                <option value="">Todas as prensas</option>
                {machines.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.code} · {m.name}
                  </option>
                ))}
              </select>
            </div>
            {hasFilters && (
              <Button
                type="button"
                variant="ghost"
                className="h-10"
                onClick={clearFilters}
              >
                <RotateCcw className="size-4" />
                Limpar filtros
              </Button>
            )}
          </div>
        </div>
        {message && (
          <p
            role="status"
            className="mx-4 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
          >
            {message}
          </p>
        )}
        {error && !formOpen && (
          <p
            role="alert"
            className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </p>
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="grid h-full min-h-64 place-items-center">
              <div className="text-center text-sm text-slate-500">
                <Loader2 className="mx-auto mb-3 size-6 animate-spin text-orange-500" />
                Consultando fichas...
              </div>
            </div>
          ) : sheets.length === 0 ? (
            <div className="grid h-full min-h-64 place-items-center text-center text-sm text-slate-400">
              <div>
                <ClipboardList className="mx-auto mb-3 size-10 stroke-1" />
                <p className="font-medium text-slate-600">
                  Nenhuma ficha encontrada
                </p>
                <p className="mt-1">Tente outro termo ou limpe os filtros.</p>
              </div>
            </div>
          ) : (
            <SheetTable
              sheets={sheets}
              onEdit={(s) => openSheet(s, false)}
              onDuplicateSequence={(s) => openSheet(s, true)}
            />
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-white px-4 py-3 text-xs text-slate-500 lg:px-5">
          <span>
            {total === 0
              ? "Nenhum resultado"
              : `Mostrando ${firstResult.toLocaleString("pt-BR")}–${lastResult.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}`}
          </span>
          <div className="flex items-center gap-2">
            <span className="mr-1">
              Página {page + 1} de {Math.max(1, Math.ceil(total / pageSize))}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={page === 0 || loading}
              onClick={() => setPage((v) => v - 1)}
              aria-label="Página anterior"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              disabled={(page + 1) * pageSize >= total || loading}
              onClick={() => setPage((v) => v + 1)}
              aria-label="Próxima página"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </section>

      <Dialog
        open={creationGuideOpen}
        onOpenChange={(open) => {
          if (!loadingTemplates) setCreationGuideOpen(open);
        }}
      >
        <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-2rem)] flex-col overflow-hidden p-0 sm:max-w-5xl">
          <DialogHeader className="border-b px-6 py-5 text-left">
            <DialogTitle>Criar ficha de processo</DialogTitle>
            <DialogDescription>
              A ferramenta <strong>{requestedToolCode}</strong> ainda não possui
              uma receita ativa. Comece em branco ou aproveite um setup já
              validado como ponto de partida.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 md:p-6">
            <section className="flex flex-col gap-4 rounded-2xl border border-orange-200 bg-orange-50/50 p-4 sm:flex-row sm:items-center">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-orange-100 text-orange-600">
                <FilePlus2 className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-slate-950">Começar em branco</h3>
                <p className="mt-1 text-sm leading-5 text-slate-600">Crie a sequência 1 de <strong>{requestedToolCode}</strong> e informe os parâmetros técnicos manualmente.</p>
              </div>
              <Button
                type="button"
                className="w-full shrink-0 bg-orange-500 font-semibold hover:bg-orange-600 sm:w-auto"
                onClick={openBlankForRequested}
              >
                <FilePlus2 className="size-4" />
                Criar ficha em branco
              </Button>
            </section>

            <section className="min-w-0 rounded-2xl border bg-white p-4 md:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-700">
                  <CopyPlus className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-slate-950">
                    Copiar uma ficha existente
                  </h3>
                  <p className="text-xs leading-5 text-slate-500">
                    A cópia será editável e manterá a origem registrada para
                    auditoria.
                  </p>
                </div>
              </div>
              <div className="relative mt-4 sm:mt-0 sm:w-80">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={templateSearch}
                  onChange={(event) => setTemplateSearch(event.target.value)}
                  className="pl-9"
                  placeholder="Buscar ferramenta, liga ou prensa"
                  aria-label="Buscar ficha para copiar"
                />
              </div>
              <div className="mt-4 max-h-[45dvh] overflow-y-auto pr-1">
                {loadingTemplates ? (
                  <div className="grid min-h-32 place-items-center text-sm text-slate-500">
                    <span className="flex items-center gap-2">
                      <Loader2 className="size-4 animate-spin text-orange-500" />
                      Consultando fichas...
                    </span>
                  </div>
                ) : visibleTemplates.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-5 text-center text-sm text-slate-500">
                    Nenhuma ficha encontrada para este filtro.
                  </div>
                ) : (
                  <div className="grid gap-2 lg:grid-cols-2">{visibleTemplates.map((sheet) => {
                    const productivity =
                      sheet.achieved_productivity_kg_h ??
                      sheet.parameters.extrusion?.target_productivity_kg_h;
                    return (
                      <div
                        key={sheet.id}
                        className="flex min-w-0 flex-col gap-3 rounded-xl border p-3 transition hover:border-orange-300 hover:bg-orange-50/30 sm:flex-row sm:items-center"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <strong className="font-mono text-sm text-slate-950">
                              {sheet.product_code || sheet.tool_code}
                            </strong>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                              Seq. {sheet.tool_sequence ?? sheet.revision}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {sheet.machine_code || "Prensa padrão"} · {sheet.alloy_code}{" "}
                            {sheet.temper || ""} · {formatMm(cutLengthMm(sheet.parameters))}
                            {productivity
                              ? ` · ${numberFormatter.format(productivity)} kg/h`
                              : ""}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="w-full shrink-0 sm:w-auto"
                          onClick={() => copyTemplateForRequested(sheet)}
                        >
                          Usar como modelo
                        </Button>
                      </div>
                    );
                  })}</div>
                )}
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <Sheet
        open={formOpen}
        onOpenChange={(open) => {
          if (!saving) setFormOpen(open);
        }}
      >
        <SheetContent
          className="gap-0 overflow-hidden p-0"
          style={{ width: "min(1024px, calc(100vw - 24px))", maxWidth: "none" }}
          showCloseButton={false}
        >
          <form
            key={`${draft?.id ?? "new"}-${newSequence}-${requestedToolCode}-${targetSequence ?? ""}`}
            onSubmit={save}
            className="flex min-h-0 flex-1 flex-col"
          >
            <SheetHeader className="border-b px-5 py-4 pr-16">
              <SheetTitle className="text-lg font-bold">
                {newSequence
                  ? "Nova sequência a partir do setup"
                  : draft
                    ? "Editar ficha"
                    : "Nova ficha de processo"}
              </SheetTitle>
              <SheetDescription>
                Preencha os parâmetros em milímetros. Os cálculos do tarugo e da
                puxada serão atualizados ao salvar.
              </SheetDescription>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-4 top-4"
                onClick={() => setFormOpen(false)}
                disabled={saving}
                aria-label="Fechar cadastro"
              >
                <X className="size-4" />
              </Button>
            </SheetHeader>
            <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/40 px-5 py-5">
              <div className="grid gap-4 rounded-xl border bg-white p-4 md:grid-cols-3 xl:grid-cols-5">
                <Field
                  label="Ferramenta"
                  name="product_code"
                  value={
                    requestedToolCode ||
                    draft?.product_code ||
                    draft?.tool_code
                  }
                  required
                />
                <CatalogSelect
                  label="Liga"
                  name="alloy_code"
                  value={draft?.alloy_code}
                  options={catalog.filter(
                    (option) => option.catalog_type === "alloy",
                  )}
                  required
                />
                <Field label="Têmpera" name="temper" value={draft?.temper} />
                <div className="space-y-2">
                  <Label htmlFor="machine_code">Prensa</Label>
                  <select
                    id="machine_code"
                    name="machine_code"
                    defaultValue={draft?.machine_code ?? ""}
                    className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                  >
                    <option value="">Todas / padrão</option>
                    {machines.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.code}
                      </option>
                    ))}
                  </select>
                </div>
                <Field
                  label="Sequência da ferramenta"
                  name="tool_sequence"
                  type="number"
                  value={sequence}
                  required
                />
              </div>
              <Section
                title="Extrusão"
                description="Dados do perfil, ferramenta e velocidade de processo."
              >
                <Field
                  label="Peso linear perfil (kg/m)"
                  name="profile_linear_weight_kg_m"
                  type="number"
                  step="0.001"
                  value={parameters.extrusion?.profile_linear_weight_kg_m}
                />
                <Field
                  label="Número de furos"
                  name="holes"
                  type="number"
                  value={parameters.extrusion?.holes ?? 1}
                />
                <Field
                  label="Cortes por puxada"
                  name="cuts_per_pull"
                  type="number"
                  value={parameters.extrusion?.cuts_per_pull ?? 1}
                />
                <Field
                  label="Comprimento do corte (mm)"
                  name="cut_length_mm"
                  type="number"
                  step="0.1"
                  value={cutLengthMm(parameters)}
                  placeholder="Ex.: 5000"
                />
                <Field
                  label="Descarte (mm)"
                  name="discard_mm"
                  type="number"
                  step="0.1"
                  value={discardMm(parameters)}
                />
                <Field
                  label="Velocidade principal (mm/s)"
                  name="ram_speed_mm_s"
                  type="number"
                  step="0.01"
                  value={parameters.extrusion?.ram_speed_mm_s}
                />
                <Field
                  label="Pressão inicial"
                  name="initial_pressure"
                  type="number"
                  step="0.01"
                  value={parameters.extrusion?.initial_pressure}
                />
                <Field
                  label="Produtividade (kg/h)"
                  name="target_productivity_kg_h"
                  type="number"
                  step="0.01"
                  value={parameters.extrusion?.target_productivity_kg_h}
                />
              </Section>
              <Section
                title="Temperaturas"
                description="Setpoints de aquecimento e saída do perfil."
              >
                <Field
                  label="Zona 1 (°C)"
                  name="zone_1_c"
                  type="number"
                  value={parameters.temperatures?.zone_1_c}
                />
                <Field
                  label="Zona 2 (°C)"
                  name="zone_2_c"
                  type="number"
                  value={parameters.temperatures?.zone_2_c}
                />
                <Field
                  label="Zona 3 (°C)"
                  name="zone_3_c"
                  type="number"
                  value={parameters.temperatures?.zone_3_c}
                />
                <Field
                  label="Zona 4 (°C)"
                  name="zone_4_c"
                  type="number"
                  value={parameters.temperatures?.zone_4_c}
                />
                <Field
                  label="Emergente mínima (°C)"
                  name="exit_min_c"
                  type="number"
                  value={parameters.temperatures?.exit_min_c}
                />
                <Field
                  label="Emergente máxima (°C)"
                  name="exit_max_c"
                  type="number"
                  value={parameters.temperatures?.exit_max_c}
                />
                <Field
                  label="Tarugo (°C)"
                  name="billet_c"
                  type="number"
                  value={parameters.temperatures?.billet_c}
                />
                <Field
                  label="Container (°C)"
                  name="container_c"
                  type="number"
                  value={parameters.temperatures?.container_c}
                />
                <Field
                  label="Ferramenta (°C)"
                  name="die_c"
                  type="number"
                  value={parameters.temperatures?.die_c}
                />
                <Field
                  label="Saída do perfil (°C)"
                  name="exit_c"
                  type="number"
                  value={parameters.temperatures?.exit_c}
                />
              </Section>
              <Section
                title="Puxada, resfriamento e serra"
                description="Parâmetros usados pelo operador durante a ordem."
              >
                <Field
                  label="Velocidade do puller (mm/min)"
                  name="puller_speed_mm_min"
                  type="number"
                  step="0.1"
                  value={pullerSpeedMmMin(parameters)}
                />
                <Field
                  label="Estiramento (%)"
                  name="stretch_percent"
                  type="number"
                  step="0.01"
                  value={parameters.pulling?.stretch_percent}
                />
                <CoolingModeSelect
                  label="Modo de resfriamento"
                  name="cooling_mode"
                  value={parameters.cooling?.mode}
                />
                <Field
                  label="Comprimento da peça (mm)"
                  name="piece_length_mm"
                  type="number"
                  step="0.1"
                  value={parameters.saw?.piece_length_mm}
                />
                <Field
                  label="Tolerância (mm)"
                  name="tolerance_mm"
                  type="number"
                  step="0.01"
                  value={parameters.saw?.tolerance_mm}
                />
                <Field
                  label="Obs. resfriamento"
                  name="cooling_notes"
                  value={parameters.cooling?.notes}
                />
              </Section>
              <Section
                title="Tarugo e motor de engenharia"
                description="Comprimentos calculados e armazenados em milímetros."
              >
                <CatalogSelect
                  label="Carcaça"
                  name="billet_casing"
                  value={parameters.billet?.casing}
                  options={catalog.filter(
                    (option) => option.catalog_type === "billet_casing",
                  )}
                />
                <Field
                  label="Peso linear tarugo (kg/m)"
                  name="billet_linear_weight_kg_m"
                  type="number"
                  step="0.01"
                  value={parameters.billet?.linear_weight_kg_m ?? 67.2}
                />
                <Field
                  label="Peso linear nominal (kg/m)"
                  name="billet_nominal_weight_kg_m"
                  type="number"
                  step="0.01"
                  value={parameters.billet?.nominal_weight_kg_m ?? 69.92}
                />
                <Field
                  label="Fator de perda"
                  name="loss_factor"
                  type="number"
                  step="0.001"
                  value={parameters.billet?.loss_factor ?? 0.063}
                />
                <Field
                  label="Margem operacional"
                  name="operational_margin"
                  type="number"
                  step="0.01"
                  value={parameters.billet?.operational_margin ?? 0.07}
                />
                <Field
                  label="Talão (mm)"
                  name="butt_mm"
                  type="number"
                  step="0.1"
                  value={parameters.billet?.butt_mm}
                />
              </Section>
              {(parameters.billet?.calculated_length_mm != null ||
                parameters.billet?.calculated_pull_mm != null ||
                parameters.billet?.calculated_pull_m != null) && (
                <div className="mt-5 grid gap-3 rounded-xl border border-orange-100 bg-orange-50/60 p-4 sm:grid-cols-2">
                  <CalculatedValue
                    label="Último tarugo calculado"
                    value={parameters.billet?.calculated_length_mm}
                  />
                  <CalculatedValue
                    label="Última puxada calculada"
                    value={millimeters(
                      parameters.billet?.calculated_pull_mm,
                      parameters.billet?.calculated_pull_m,
                    )}
                  />
                </div>
              )}
              <div className="mt-5 space-y-2">
                <Label htmlFor="notes">Observações da ficha</Label>
                <textarea
                  id="notes"
                  name="notes"
                  defaultValue={parameters.notes}
                  className="min-h-24 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400"
                />
              </div>
              <label className="mt-4 flex items-center gap-3 rounded-lg border bg-white px-3 py-3 text-sm">
                <input
                  name="is_active"
                  type="checkbox"
                  defaultChecked={draft?.is_active ?? true}
                  className="size-4 accent-orange-500"
                />
                Ficha ativa para uso nas ordens
              </label>
              {error && (
                <p
                  role="alert"
                  className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {error}
                </p>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 border-t bg-white px-5 py-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
                disabled={saving}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                className="min-w-40 bg-orange-500 font-semibold hover:bg-orange-600"
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FilePlus2 className="size-4" />
                )}
                {draft && !newSequence ? "Salvar alterações" : "Criar ficha"}
              </Button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

function SheetTable({
  sheets,
  onEdit,
  onDuplicateSequence,
}: {
  sheets: ProcessSheet[];
  onEdit: (sheet: ProcessSheet) => void;
  onDuplicateSequence: (sheet: ProcessSheet) => void;
}) {
  const router = useRouter();
  const bestProductivityByTool = new Map<string, number>();
  for (const sheet of sheets) {
    if (sheet.achieved_productivity_kg_h == null) continue;
    const key = normalizeCode(sheet.product_code || sheet.tool_code);
    bestProductivityByTool.set(
      key,
      Math.max(
        bestProductivityByTool.get(key) ?? 0,
        sheet.achieved_productivity_kg_h,
      ),
    );
  }
  return (
    <table className="w-full min-w-[900px] border-collapse text-left text-sm">
      <thead className="sticky top-0 z-10 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_#e2e8f0]">
        <tr>
          <Th>Ferramenta</Th>
          <Th>Liga / têmpera</Th>
          <Th>Prensa</Th>
          <Th center>Sequência</Th>
          <Th right>Peso linear</Th>
          <Th right>Corte</Th>
          <Th right>Produtividade alcançada</Th>
          <Th>Status</Th>
          <Th right>Ações</Th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {sheets.map((sheet) => (
          <tr key={sheet.id} className="hover:bg-orange-50/40">
            <td className="px-5 py-3.5 font-mono font-bold text-orange-600">
              {sheet.product_code || sheet.tool_code}
            </td>
            <td className="px-4 py-3.5 text-slate-600">
              {sheet.alloy_code} {sheet.temper || ""}
            </td>
            <td className="px-4 py-3.5 text-slate-600">
              {sheet.machine_code || "Padrão"}
            </td>
            <td className="px-4 py-3.5 text-center">
              <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold">
                {sheet.tool_sequence ?? sheet.revision}
              </span>
            </td>
            <td className="px-4 py-3.5 text-right tabular-nums text-slate-700">
              {sheet.parameters.extrusion?.profile_linear_weight_kg_m == null
                ? "—"
                : `${sheet.parameters.extrusion.profile_linear_weight_kg_m.toLocaleString("pt-BR")} kg/m`}
            </td>
            <td className="px-4 py-3.5 text-right font-semibold tabular-nums">
              {formatMm(cutLengthMm(sheet.parameters))}
            </td>
            <td className="px-4 py-3.5 text-right tabular-nums">
              {sheet.achieved_productivity_kg_h == null ? (
                <span className="text-slate-400">Sem histórico</span>
              ) : (
                <div>
                  <div className="flex items-center justify-end gap-1.5">
                    <strong className="text-emerald-700">
                      {numberFormatter.format(sheet.achieved_productivity_kg_h)} kg/h
                    </strong>
                    {sheet.achieved_productivity_kg_h ===
                      bestProductivityByTool.get(
                        normalizeCode(sheet.product_code || sheet.tool_code),
                      ) && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                        Melhor
                      </span>
                    )}
                  </div>
                </div>
              )}
              {sheet.copied_from_sequence != null && (
                <span className="block text-[10px] text-slate-400">
                  Setup copiado da seq. {sheet.copied_from_sequence}
                </span>
              )}
            </td>
            <td className="px-4 py-3.5">
              <span
                className={
                  sheet.is_active
                    ? "rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700"
                    : "rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500"
                }
              >
                {sheet.is_active ? "Ativa" : "Inativa"}
              </span>
            </td>
            <td className="px-5 py-3.5">
              <div className="flex justify-end gap-1">
                <Button
                  type="button"
                  size="sm"
                  className="bg-orange-500 text-white hover:bg-orange-600"
                  onClick={() => {
                    const query = new URLSearchParams({
                      tool: sheet.product_code || sheet.tool_code,
                      cut: String(cutLengthMm(sheet.parameters) ?? ""),
                      machine: sheet.machine_code || "",
                    });
                    router.push(`/producao?${query}`);
                  }}
                >
                  <Play className="size-3.5" />
                  Produzir
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-orange-600"
                  onClick={() => onEdit(sheet)}
                >
                  <Pencil className="size-3.5" />
                  Editar
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-slate-600"
                  onClick={() => onDuplicateSequence(sheet)}
                >
                  <CopyPlus className="size-3.5" />
                  Copiar setup
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({
  children,
  center,
  right,
}: {
  children: React.ReactNode;
  center?: boolean;
  right?: boolean;
}) {
  return (
    <th
      className={`px-4 py-3 font-semibold ${center ? "text-center" : right ? "text-right" : ""}`}
    >
      {children}
    </th>
  );
}
function Field({
  label,
  name,
  value,
  type = "text",
  step,
  required,
  placeholder,
}: {
  label: string;
  name: string;
  value?: string | number | null;
  type?: string;
  step?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type={type}
        step={step}
        defaultValue={value ?? ""}
        required={required}
        placeholder={placeholder}
      />
    </div>
  );
}
function CatalogSelect({
  label,
  name,
  value,
  options,
  required,
}: {
  label: string;
  name: string;
  value?: string | null;
  options: CatalogOption[];
  required?: boolean;
}) {
  const currentExists = options.some(
    (option) => option.label === value || option.code === value,
  );
  return (
    <div className="space-y-2">
      <Label htmlFor={name}>{label}</Label>
      <select
        id={name}
        name={name}
        defaultValue={value ?? ""}
        required={required}
        className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
      >
        <option value="">Selecione</option>
        {value && !currentExists && (
          <option value={value}>{value} · legado</option>
        )}
        {options.map((option) => (
          <option key={option.id} value={option.label}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="mt-5 rounded-xl border bg-white p-4">
      <legend className="px-2 font-heading text-sm font-bold">{title}</legend>
      <p className="mb-4 text-xs text-slate-500">{description}</p>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </fieldset>
  );
}
function CalculatedValue({ label, value }: { label: string; value?: number }) {
  return (
    <div>
      <span className="text-xs text-slate-500">{label}</span>
      <strong className="mt-1 block text-lg text-slate-900">
        {formatMm(value)}
      </strong>
    </div>
  );
}
