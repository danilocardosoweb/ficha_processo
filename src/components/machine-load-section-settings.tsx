"use client";

import { useState } from "react";
import { ArrowRight, Eye, EyeOff, RotateCcw, Settings2 } from "lucide-react";
import { useCurrentUser } from "@/components/current-user-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  machineLoadSectionSettings,
  useMachineLoadSectionVisibility,
} from "@/lib/machine-load-visibility";

export function MachineLoadSectionSettings() {
  const { user_id: userId } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const { visibility, setSectionVisible, resetVisibility } =
    useMachineLoadSectionVisibility(userId);
  const visibleCount = machineLoadSectionSettings.filter(
    (item) => visibility[item.key],
  ).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group rounded-2xl border bg-slate-50/70 p-5 text-left transition hover:-translate-y-0.5 hover:border-violet-200 hover:bg-violet-50/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40"
      >
        <div className="flex items-start justify-between gap-4">
          <span className="grid size-11 place-items-center rounded-xl bg-white text-violet-600 shadow-sm ring-1 ring-violet-100 transition group-hover:bg-violet-50">
            <Settings2 className="size-5" />
          </span>
          <ArrowRight className="size-5 text-slate-300 transition group-hover:translate-x-1 group-hover:text-violet-500" />
        </div>
        <h3 className="mt-5 font-heading text-base font-bold text-slate-900">Exibição da Base Teste · IA</h3>
        <p className="mt-1.5 min-h-10 text-sm leading-5 text-slate-500">
          Escolha quais seções aparecem na simulação antes de evoluir a Base Oficial.
        </p>
        <p className="mt-4 text-xs font-semibold text-violet-700">
          {visibleCount} de {machineLoadSectionSettings.length} seções visíveis
        </p>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto p-0 sm:max-w-3xl" showCloseButton={false}>
          <DialogHeader className="border-b px-5 py-5 md:px-6">
            <div className="flex items-start gap-3 pr-10">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600">
                <Settings2 className="size-5" />
              </span>
              <div>
                <DialogTitle className="font-heading text-lg font-bold text-slate-900">Exibição da Base Teste · IA</DialogTitle>
                <DialogDescription className="mt-1">Escolha o que aparece na aba de simulação. A Base Oficial não é alterada.</DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="border-b bg-violet-50/50 px-5 py-3 text-xs text-violet-950 md:px-6">
            {visibleCount} de {machineLoadSectionSettings.length} seções visíveis. A escolha é salva automaticamente neste navegador.
          </div>
          <div className="divide-y">
            {machineLoadSectionSettings.map((item) => {
              const visible = visibility[item.key];
              return (
                <div key={item.key} className="flex items-center gap-4 px-5 py-4 md:px-6">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900">{item.title}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{item.description}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={visible}
                    aria-label={`${visible ? "Ocultar" : "Mostrar"} ${item.title}`}
                    onClick={() => setSectionVisible(item.key, !visible)}
                    className={`relative inline-flex h-8 w-[74px] shrink-0 items-center rounded-full border px-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500/40 ${visible ? "justify-end border-emerald-300 bg-emerald-100" : "justify-start border-slate-300 bg-slate-100"}`}
                  >
                    <span className={`grid size-6 place-items-center rounded-full bg-white shadow-sm transition ${visible ? "text-emerald-700" : "text-slate-500"}`}>
                      {visible ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
                    </span>
                    <span className={`absolute text-[10px] font-bold ${visible ? "left-2 text-emerald-800" : "right-2 text-slate-500"}`}>
                      {visible ? "Visível" : "Oculto"}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
          <DialogFooter className="sticky bottom-0 mt-0">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Concluir</Button>
            <Button type="button" variant="outline" onClick={resetVisibility} disabled={visibleCount === machineLoadSectionSettings.length}>
              <RotateCcw className="size-4" />
              Mostrar todos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
