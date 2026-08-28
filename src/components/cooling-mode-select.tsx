"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getOfflineSnapshot, requestOfflineSync } from "@/lib/offline-store";
import { createClient, withSupabaseTimeout } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type CoolingMode = {
  id: string;
  catalog_type: string;
  code: string;
  label: string;
  sort_order: number;
  is_active: boolean;
};

const organizationId = process.env.NEXT_PUBLIC_DEFAULT_ORGANIZATION_ID;

function toCatalogCode(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

export function CoolingModeSelect({
  name = "cooling_mode",
  label = "Resfriamento",
  value,
  onValueChange,
  required,
  className,
}: {
  name?: string;
  label?: string;
  value?: string | null;
  onValueChange?: (value: string) => void;
  required?: boolean;
  className?: string;
}) {
  const [options, setOptions] = useState<CoolingMode[]>([]);
  const [current, setCurrent] = useState(value ?? "");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newMode, setNewMode] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");

  const loadOptions = useCallback(async () => {
    try {
      if (!organizationId) throw new Error("Organização não configurada.");
      const supabase = createClient();
      const { data, error } = await withSupabaseTimeout(
        supabase
          .from("operational_catalogs")
          .select("id,catalog_type,code,label,sort_order,is_active")
          .eq("organization_id", organizationId)
          .eq("catalog_type", "cooling_mode")
          .eq("is_active", true)
          .order("sort_order")
          .order("label"),
      );
      if (error) throw error;
      setOptions((data ?? []) as CoolingMode[]);
    } catch {
      const snapshot = await getOfflineSnapshot<CoolingMode>(
        "operational_catalogs",
      );
      setOptions(
        (snapshot?.rows ?? [])
          .filter(
            (option) =>
              option.catalog_type === "cooling_mode" && option.is_active,
          )
          .sort(
            (a, b) =>
              a.sort_order - b.sort_order || a.label.localeCompare(b.label),
          ),
      );
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadOptions(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadOptions]);

  function select(valueToSelect: string) {
    setCurrent(valueToSelect);
    onValueChange?.(valueToSelect);
  }

  async function addMode() {
    const labelToSave = newMode.trim();
    const code = toCatalogCode(labelToSave);
    if (!labelToSave || !code) {
      setProblem("Informe o nome do novo modo de resfriamento.");
      return;
    }
    if (
      options.some(
        (option) =>
          option.label.localeCompare(labelToSave, "pt-BR", {
            sensitivity: "accent",
          }) === 0 || option.code === code,
      )
    ) {
      setProblem("Este modo de resfriamento já está cadastrado.");
      return;
    }
    if (!organizationId) {
      setProblem("Organização não configurada.");
      return;
    }

    setSaving(true);
    setProblem("");
    try {
      const supabase = createClient();
      const sortOrder =
        Math.max(0, ...options.map((option) => option.sort_order || 0)) + 10;
      const { data, error } = await withSupabaseTimeout(
        supabase
          .from("operational_catalogs")
          .insert({
            organization_id: organizationId,
            catalog_type: "cooling_mode",
            code,
            label: labelToSave,
            responsible_department: "Engenharia",
            routes_to_maintenance: false,
            sort_order: sortOrder,
            metadata: { source: "manual" },
            is_active: true,
          })
          .select("id,catalog_type,code,label,sort_order,is_active")
          .single(),
      );
      if (error) throw error;
      const created = data as CoolingMode;
      setOptions((previous) => [...previous, created]);
      select(created.label);
      setNewMode("");
      setDialogOpen(false);
      requestOfflineSync("operational_catalogs");
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Não foi possível cadastrar o novo resfriamento.",
      );
    } finally {
      setSaving(false);
    }
  }

  const selectedValue = onValueChange ? (value ?? "") : current;
  const currentExists = options.some(
    (option) =>
      option.label === selectedValue || option.code === selectedValue,
  );

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={name}>{label}</Label>
      <div className="flex gap-2">
        <select
          id={name}
          name={name}
          value={selectedValue}
          onChange={(event) => select(event.target.value)}
          required={required}
          className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm"
        >
          <option value="">Selecione</option>
          {selectedValue && !currentExists && (
            <option value={selectedValue}>{selectedValue} · legado</option>
          )}
          {options.map((option) => (
            <option key={option.id} value={option.label}>
              {option.label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setProblem("");
            setDialogOpen(true);
          }}
          className="shrink-0"
        >
          <Plus /> Novo
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Novo modo de resfriamento</DialogTitle>
            <DialogDescription>
              O novo modo ficará disponível imediatamente nas fichas de
              processo e na Produção.
            </DialogDescription>
          </DialogHeader>
          <label className="space-y-2">
            <span className="text-sm font-semibold">Nome</span>
            <Input
              value={newMode}
              onChange={(event) => setNewMode(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void addMode();
                }
              }}
              placeholder="Ex.: Ventilador 1 e Spray"
              autoFocus
            />
          </label>
          {problem && <p className="text-sm text-red-600">{problem}</p>}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => void addMode()}
              disabled={saving || !newMode.trim()}
              className="bg-orange-500 font-bold hover:bg-orange-600"
            >
              {saving ? <Loader2 className="animate-spin" /> : <Plus />}
              Adicionar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
