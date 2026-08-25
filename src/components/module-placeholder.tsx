import { ArrowRight, Construction } from "lucide-react";
import { PageHeading } from "@/components/page-heading";
import { Button } from "@/components/ui/button";

export function ModulePlaceholder({ title, description, features }: { title:string; description:string; features:string[] }) {
  return <><PageHeading eyebrow="Modulo preparado" title={title} description={description}/><div className="rounded-xl border bg-white p-8 shadow-sm"><span className="grid size-12 place-items-center rounded-xl bg-orange-50 text-orange-600"><Construction className="size-6"/></span><h2 className="font-heading mt-5 text-lg font-bold">Fundacao pronta para evoluir</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">A navegacao e o dominio deste modulo ja fazem parte da arquitetura da V1. As proximas entregas podem ser adicionadas sem alterar o nucleo de Ordens de Producao.</p><div className="mt-6 grid gap-3 sm:grid-cols-3">{features.map((feature,i)=><div key={feature} className="rounded-lg border bg-slate-50 p-4"><span className="text-[10px] font-bold text-orange-600">0{i+1}</span><p className="mt-2 text-sm font-semibold">{feature}</p></div>)}</div><Button variant="outline" className="mt-6">Ver roadmap <ArrowRight className="size-4"/></Button></div></>;
}
