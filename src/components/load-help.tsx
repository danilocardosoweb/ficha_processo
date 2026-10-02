"use client";

import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { Tooltip } from "@base-ui/react/tooltip";
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { loadHelp, findLoadHelp, type LoadHelpKey, type LoadHelpTopic } from "@/modules/planning/load-help";

function Explanation({ topic }: { topic: LoadHelpTopic }) {
  return <div className="space-y-4 text-sm leading-relaxed text-slate-700">
    <div><h3 className="font-bold text-slate-950">O que muda na prática?</h3><p>{topic.effect}</p></div>
    {topic.example && <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-blue-950">{topic.example}</div>}
    <div><h3 className="font-bold text-slate-950">Como conferir</h3><ol className="mt-2 list-decimal space-y-2 pl-5">{topic.steps.map(step => <li key={step}>{step}</li>)}</ol></div>
  </div>;
}
export function FieldHelp({ topic: key }: { topic: LoadHelpKey }) {
  const item = loadHelp[key];
  return <Dialog>
    <Tooltip.Provider delay={350}>
      <Tooltip.Root>
        <DialogTrigger render={<Tooltip.Trigger />} type="button"
          aria-label={`Ajuda: ${item.title}`}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-full text-slate-500 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600">
          <CircleHelp className="size-4" aria-hidden="true" />
        </DialogTrigger>
        <Tooltip.Portal><Tooltip.Positioner sideOffset={6} className="z-[80]"><Tooltip.Popup className="max-w-[min(320px,90vw)] rounded-lg bg-slate-900 px-3 py-2 text-xs leading-relaxed text-white shadow-lg">{item.summary} Clique para ver como conferir.</Tooltip.Popup></Tooltip.Positioner></Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
    <DialogContent showCloseButton={false} className="max-h-[85dvh] overflow-y-auto sm:max-w-lg">
      <DialogTitle className="pr-2 text-lg font-bold">{item.title}</DialogTitle>
      <DialogDescription>{item.summary}</DialogDescription>
      <Explanation topic={item} />
      <DialogClose className="mt-2 rounded-lg border px-4 py-2 font-semibold hover:bg-slate-50">Entendi, voltar ao campo</DialogClose>
    </DialogContent>
  </Dialog>;
}
export function HelpLabel({ label, topic }: {label: string; topic: LoadHelpKey}) {
  return <div className="flex items-center justify-between gap-2"><span>{label}</span><FieldHelp topic={topic} /></div>;
}
export function LoadHelpGuide() {
  const [query,setQuery] = useState("");
  const found = findLoadHelp(query);
  return <Dialog>
    <DialogTrigger type="button" className="inline-flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-blue-50">
      <CircleHelp className="size-4" aria-hidden="true" />Ajuda desta tela
    </DialogTrigger>
    <DialogContent showCloseButton={false} className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogTitle className="text-lg font-bold">Ajuda da Carga Máquina</DialogTitle>
      <DialogDescription>Procure o nome do campo ou abra um assunto. Os ícones de interrogação junto aos campos abrem essa explicação diretamente.</DialogDescription>
      <label className="text-sm font-semibold">Qual é sua dúvida?<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Ex.: carcaça, peso, salvar, produtividade" className="mt-1 w-full rounded-lg border px-3 py-2 font-normal" /></label>
      <p role="status" className="text-xs text-slate-500">{found.length} assuntos encontrados</p>
      <div className="space-y-2">{found.map(([key,topic])=><details key={key} className="rounded-xl border p-3"><summary className="cursor-pointer font-semibold text-slate-900">{topic.title}</summary><p className="my-3 text-sm text-slate-600">{topic.summary}</p><Explanation topic={topic}/></details>)}</div>
      {!found.length && <p className="text-sm">Não encontramos esse termo. Tente “prazo”, “carcaça” ou “salvar”.</p>}
      <DialogClose className="rounded-lg border px-4 py-2 font-semibold hover:bg-slate-50">Fechar ajuda</DialogClose>
    </DialogContent>
  </Dialog>;
}
