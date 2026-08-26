import { Layers3 } from "lucide-react";

export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-10 place-items-center rounded-xl bg-orange-500 text-white shadow-lg shadow-orange-950/30">
        <Layers3 className="size-5" strokeWidth={2.4} />
      </div>
      {!compact && <div><p className="font-heading text-lg font-extrabold tracking-tight">Tecno<span className="text-orange-500">MES</span></p><p className="text-[10px] font-medium uppercase tracking-[.18em] text-slate-500">Extrusion intelligence</p></div>}
    </div>
  );
}
