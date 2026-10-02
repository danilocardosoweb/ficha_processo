"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Flame,
  LogOut,
  Maximize,
  Minimize,
  Plus,
  RotateCcw,
  ShieldCheck,
  Thermometer,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LocalUser } from "@/lib/local-auth/types";
import { cn } from "@/lib/utils";

type MachineCode = "18" | "19";
type SlotStatus = "free" | "heating" | "ready" | "alert";
type OvenSlot = {
  id: string;
  machine: MachineCode;
  oven: number;
  position: number;
  status: SlotStatus;
  tool?: string;
  plan?: string;
  readyAt?: string;
};
type QueueTool = {
  id: string;
  tool: string;
  machine: MachineCode;
  plan: string;
  sequence: number;
  test?: boolean;
};

const seedSlots: OvenSlot[] = [
  { id: "18-1-1", machine: "18", oven: 1, position: 1, status: "heating", tool: "PU-0804", plan: "17429", readyAt: "01h 18min" },
  { id: "18-1-5", machine: "18", oven: 1, position: 5, status: "ready", tool: "TSU-108", plan: "17429", readyAt: "Pronta há 42min" },
  { id: "19-1-1", machine: "19", oven: 1, position: 1, status: "alert", tool: "TDS-152", plan: "17555", readyAt: "Limite excedido" },
  { id: "19-2-5", machine: "19", oven: 2, position: 5, status: "ready", tool: "TG-2004", plan: "17555", readyAt: "Pronta há 24min" },
  { id: "19-3-2", machine: "19", oven: 3, position: 2, status: "ready", tool: "BC-0050", plan: "17555", readyAt: "Pronta há 6h" },
];

const seedQueue: QueueTool[] = [
  { id: "tg-7403", tool: "TG-7403", machine: "18", plan: "17429", sequence: 2 },
  { id: "sba-023", tool: "SBA-023", machine: "18", plan: "17429", sequence: 4 },
  { id: "bc-0009", tool: "BC-0009", machine: "19", plan: "17555", sequence: 1 },
  { id: "tg-0072", tool: "TG-0072", machine: "19", plan: "17555", sequence: 3, test: true },
  { id: "pu-0804", tool: "PU-0804", machine: "19", plan: "17555", sequence: 5 },
];

const labels: Record<SlotStatus, string> = { free: "Livre", heating: "Aquecendo", ready: "Pronta", alert: "Limite excedido" };
const slotTone: Record<SlotStatus, string> = {
  free: "border-dashed border-slate-300 bg-white text-slate-500",
  heating: "border-orange-300 bg-orange-50 text-orange-900",
  ready: "border-emerald-300 bg-emerald-50 text-emerald-900",
  alert: "border-red-400 bg-red-50 text-red-900",
};
const storageKey = (user: LocalUser, suffix: string) => `tecnomes:forno-operacional-teste:${suffix}:${user.user_id}`;

function allSlots(machine: MachineCode) {
  return [1, 2, 3].flatMap((oven) => Array.from({ length: 7 }, (_, index) => {
    const position = index + 1;
    return seedSlots.find((slot) => slot.machine === machine && slot.oven === oven && slot.position === position) ?? { id: `${machine}-${oven}-${position}`, machine, oven, position, status: "free" as const };
  }));
}

export function OvenOperationalTest({ user }: { user: LocalUser }) {
  const router = useRouter();
  const allowedMachines = useMemo<MachineCode[]>(() => user.role === "operator" && user.machine_codes.length ? (["18", "19"] as const).filter((code) => user.machine_codes.includes(code)) : ["18", "19"], [user.machine_codes, user.role]);
  const [machine, setMachine] = useState<MachineCode>(allowedMachines[0] ?? "18");
  const [slots, setSlots] = useState<OvenSlot[]>(seedSlots);
  const [queue, setQueue] = useState<QueueTool[]>(seedQueue);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null);
  const [notice, setNotice] = useState("Ambiente simulado: nenhuma ação altera a base atual.");
  const [clock, setClock] = useState("");
  const [online, setOnline] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    let active = true;
    try {
      const savedMachine = window.localStorage.getItem(storageKey(user, "machine"));
      const savedState = window.localStorage.getItem(storageKey(user, "state"));
      const parsed = savedState ? JSON.parse(savedState) as { slots?: OvenSlot[]; queue?: QueueTool[] } : null;
      queueMicrotask(() => {
        if (!active) return;
        if ((savedMachine === "18" || savedMachine === "19") && allowedMachines.includes(savedMachine)) setMachine(savedMachine);
        if (parsed?.slots) setSlots(parsed.slots);
        if (parsed?.queue) setQueue(parsed.queue);
      });
    } catch { /* Armazenamento local é opcional no modo de teste. */ }
    return () => { active = false; };
  }, [allowedMachines, user]);

  useEffect(() => { try { window.localStorage.setItem(storageKey(user, "machine"), machine); } catch {} }, [machine, user]);
  useEffect(() => { try { window.localStorage.setItem(storageKey(user, "state"), JSON.stringify({ slots, queue })); } catch {} }, [queue, slots, user]);
  useEffect(() => {
    const tick = () => setClock(new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date()));
    const connection = () => setOnline(navigator.onLine);
    tick(); connection();
    const timer = window.setInterval(tick, 1000);
    window.addEventListener("online", connection); window.addEventListener("offline", connection);
    return () => { window.clearInterval(timer); window.removeEventListener("online", connection); window.removeEventListener("offline", connection); };
  }, []);
  useEffect(() => { const change = () => setFullscreen(Boolean(document.fullscreenElement)); document.addEventListener("fullscreenchange", change); return () => document.removeEventListener("fullscreenchange", change); }, []);

  const visibleSlots = useMemo(() => allSlots(machine).map((base) => slots.find((slot) => slot.id === base.id) ?? base), [machine, slots]);
  const selectedSlot = visibleSlots.find((slot) => slot.id === selectedSlotId) ?? null;
  const selectedTool = queue.find((tool) => tool.id === selectedToolId) ?? null;
  const machineQueue = queue.filter((tool) => tool.machine === machine).sort((a, b) => a.sequence - b.sequence);
  const free = visibleSlots.filter((slot) => slot.status === "free").length;
  const heating = visibleSlots.filter((slot) => slot.status === "heating").length;
  const ready = visibleSlots.filter((slot) => slot.status === "ready").length;
  const alerts = visibleSlots.filter((slot) => slot.status === "alert").length;

  function selectSlot(slot: OvenSlot) {
    setSelectedSlotId(slot.id);
    if (slot.status === "free") setNotice(selectedTool ? `${selectedTool.tool} e a vaga ${slot.position} do Forno ${slot.oven} foram selecionadas. Confirme a colocação.` : `Vaga ${slot.position} do Forno ${slot.oven} selecionada. Escolha uma ferramenta da fila.`);
  }
  function selectTool(tool: QueueTool) {
    setSelectedToolId(tool.id);
    setNotice(selectedSlot?.status === "free" ? `${tool.tool} e a vaga ${selectedSlot.position} do Forno ${selectedSlot.oven} foram selecionadas. Confirme a colocação.` : `${tool.tool} selecionada. Agora escolha uma vaga livre no mapa.`);
  }
  function placeTool() {
    if (!selectedSlot || !selectedTool || selectedSlot.status !== "free") return;
    setSlots((current) => [...current.filter((slot) => slot.id !== selectedSlot.id), { ...selectedSlot, status: "heating", tool: selectedTool.tool, plan: selectedTool.plan, readyAt: "4h 00min" }]);
    setQueue((current) => current.filter((tool) => tool.id !== selectedTool.id));
    setNotice(`${selectedTool.tool} entrou no Forno ${selectedSlot.oven}, vaga ${selectedSlot.position}.`);
    setSelectedSlotId(null); setSelectedToolId(null);
  }
  function removeTool(slot: OvenSlot) {
    setSlots((current) => current.filter((item) => item.id !== slot.id));
    setNotice(`${slot.tool} foi retirada. A vaga ${slot.position} está livre e a ferramenta aguarda produção.`);
    setSelectedSlotId(null);
  }
  function markReady(slot: OvenSlot) {
    setSlots((current) => current.map((item) => item.id === slot.id ? { ...item, status: "ready", readyAt: "Pronta agora" } : item));
    setNotice(`${slot.tool} está pronta, mas continua ocupando a vaga até a retirada.`);
  }
  function reset() {
    setSlots(seedSlots); setQueue(seedQueue); setSelectedSlotId(null); setSelectedToolId(null);
    setNotice("Simulação reiniciada. Nenhum dado real foi alterado.");
  }
  async function toggleFullscreen() {
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    await document.documentElement.requestFullscreen().catch(() => setNotice("Tela cheia não permitida pelo navegador. O modo estação continua disponível."));
  }

  return <div className="min-h-[100dvh] w-screen overflow-x-hidden bg-[#07101f] text-slate-950">
    <header className="border-b border-white/10 bg-[#0b172a] px-3 py-2 text-white sm:px-5"><div className="flex min-h-12 items-center justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-orange-500"><Flame className="size-5" /></span><div className="min-w-0"><p className="truncate text-[10px] font-black uppercase tracking-[0.18em] text-orange-300">Painel operacional</p><h1 className="truncate font-heading text-base font-black sm:text-xl">Fornos de ferramentas — Prensa {machine === "18" ? "1.8" : "1.9"}</h1></div></div><div className="flex shrink-0 items-center gap-2 text-xs font-bold sm:gap-4 sm:text-sm"><span className={cn("hidden items-center gap-1.5 sm:inline-flex", online ? "text-emerald-300" : "text-red-300")}><i className={cn("size-2 rounded-full", online ? "bg-emerald-400" : "bg-red-400")} />{online ? "ONLINE" : "SEM CONEXÃO"}</span><span className="font-mono tabular-nums text-slate-200">{clock}</span><button type="button" title={fullscreen ? "Sair da tela cheia" : "Tela cheia"} onClick={() => void toggleFullscreen()} className="grid size-10 place-items-center rounded-lg border border-white/15 hover:bg-white/10">{fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}</button><button type="button" title="Sair do modo operacional" onClick={() => router.push("/forno")} className="hidden size-10 place-items-center rounded-lg border border-white/15 hover:bg-white/10 sm:grid"><LogOut className="size-4" /></button></div></div><div className="mt-2 flex items-center justify-between gap-2 overflow-x-auto"><div className="flex min-w-0 gap-1 rounded-lg bg-white/5 p-1">{allowedMachines.map((code) => <button key={code} type="button" onClick={() => { setMachine(code); setSelectedSlotId(null); setSelectedToolId(null); }} className={cn("min-h-10 shrink-0 rounded-md px-4 text-xs font-black", machine === code ? "bg-orange-500 text-white" : "text-slate-300 hover:bg-white/10")}>PRENSA {code === "18" ? "1.8" : "1.9"}</button>)}</div><div className="hidden items-center gap-3 text-[11px] font-bold text-slate-300 md:flex"><span>{free} livres</span><span>{heating} aquecendo</span><span>{ready} prontas</span>{alerts > 0 && <span className="text-red-300">{alerts} alertas</span>}<button type="button" onClick={reset} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 hover:bg-white/10"><RotateCcw className="size-3.5" />Reiniciar</button></div></div></header>
    <main className="flex min-h-[calc(100dvh-76px)] flex-col gap-2 p-2 sm:gap-3 sm:p-3"><div className="flex min-h-8 items-center justify-between gap-2 rounded-lg border border-violet-300/40 bg-violet-100 px-3 py-2 text-xs font-semibold text-violet-950"><span className="truncate"><ShieldCheck className="mr-1 inline size-3.5" />TESTE SIMULADO — nenhuma ação altera a base atual.</span><span className="hidden whitespace-nowrap md:inline">{notice}</span></div><div className="grid min-h-0 flex-1 gap-2 xl:grid-cols-[minmax(0,1fr)_21rem]"><section className="min-w-0 rounded-2xl bg-white p-2 shadow-lg sm:p-3"><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-heading text-lg font-black">Mapa do forno</h2><p className="text-xs text-slate-500">Toque em uma vaga livre para colocar a próxima ferramenta.</p></div><div className="flex flex-wrap gap-1 text-[10px] font-semibold"><Legend icon={<Plus className="size-3" />} text="Livre" tone="slate" /><Legend icon={<Flame className="size-3" />} text="Aquecendo" tone="orange" /><Legend icon={<CheckCircle2 className="size-3" />} text="Pronta" tone="green" /><Legend icon={<AlertTriangle className="size-3" />} text="Atenção" tone="red" /></div></div><div className="grid gap-2 md:grid-cols-2 min-[1200px]:grid-cols-3">{[1, 2, 3].map((oven) => <OvenCard key={oven} oven={oven} slots={visibleSlots.filter((slot) => slot.oven === oven)} selectedSlotId={selectedSlotId} onSelect={selectSlot} />)}</div></section><aside className="min-w-0 rounded-2xl bg-white p-3 shadow-lg"><div className="flex items-start justify-between gap-3"><div><h2 className="font-heading text-lg font-black">Próximas para aquecer</h2><p className="text-xs text-slate-500">Sequência aprovada da prensa.</p></div><Thermometer className="size-5 text-orange-600" /></div><div className="mt-3 space-y-2">{machineQueue.length ? machineQueue.map((tool) => <button key={tool.id} type="button" aria-pressed={selectedToolId === tool.id} onClick={() => selectTool(tool)} className={cn("min-h-16 w-full rounded-xl border p-3 text-left transition", selectedToolId === tool.id ? "border-orange-400 bg-orange-50 ring-2 ring-orange-100" : "hover:border-orange-300 hover:bg-orange-50/40")}><div className="flex items-center justify-between gap-2"><p className="font-mono text-base font-black text-orange-700">{tool.tool}</p><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600">{selectedToolId === tool.id ? "Selecionada" : `Seq. ${tool.sequence}`}</span></div><p className="mt-1 text-xs text-slate-500">Plano {tool.plan}{tool.test ? " · teste previsto" : ""}</p></button>) : <p className="rounded-xl border border-dashed p-5 text-center text-sm text-slate-500">Não há ferramenta aguardando nesta prensa.</p>}</div><div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600"><Clock3 className="mr-1 inline size-4 text-slate-500" />Você pode escolher a ferramenta ou a vaga primeiro.</div></aside></div></main>
    {selectedSlot && <section className="fixed inset-x-2 bottom-2 z-20 rounded-2xl border-2 border-slate-950 bg-white p-4 shadow-2xl sm:inset-x-4"><div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="text-xs font-black uppercase tracking-wide text-slate-500">Vaga selecionada</p><p className="mt-1 font-heading text-lg font-black">Forno {selectedSlot.oven} · vaga {selectedSlot.position} · {labels[selectedSlot.status]}</p>{selectedSlot.tool && <p className="mt-1 text-sm text-slate-600">{selectedSlot.tool} · Plano {selectedSlot.plan} · {selectedSlot.readyAt}</p>}{selectedSlot.status === "free" && <p className="mt-1 text-sm font-semibold text-orange-700">{selectedTool ? `Ferramenta escolhida: ${selectedTool.tool}` : "Escolha uma ferramenta da fila"}</p>}</div><div className="flex flex-wrap gap-2">{selectedSlot.status === "free" && <Button className="min-h-12 px-5" disabled={!selectedTool} onClick={placeTool}><Flame />{selectedTool ? `Colocar ${selectedTool.tool}` : "Escolha uma ferramenta"}</Button>}{selectedSlot.status === "heating" && <Button className="min-h-12 px-5" variant="outline" onClick={() => markReady(selectedSlot)}><CheckCircle2 />Simular pronta</Button>}{["heating", "ready", "alert"].includes(selectedSlot.status) && <Button className="min-h-12 bg-emerald-600 px-5 hover:bg-emerald-700" onClick={() => removeTool(selectedSlot)}><Wrench />Retirar e liberar vaga</Button>}<Button className="min-h-12" variant="outline" onClick={() => { setSelectedSlotId(null); setSelectedToolId(null); }}>Fechar</Button></div></div></section>}
  </div>;
}

function OvenCard({ oven, slots, selectedSlotId, onSelect }: { oven: number; slots: OvenSlot[]; selectedSlotId: string | null; onSelect: (slot: OvenSlot) => void }) {
  const occupied = slots.filter((slot) => slot.status !== "free").length;
  return <article className="rounded-2xl border bg-slate-50/60 p-2 sm:p-3"><header className="mb-2 flex items-center justify-between"><div><h3 className="font-heading text-base font-black">Forno {oven}</h3><p className="text-xs text-slate-500">{occupied}/7 posições ocupadas</p></div><span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-slate-600">{7 - occupied} livres</span></header><div className="grid grid-cols-4 gap-1.5 sm:gap-2">{slots.map((slot) => <button key={slot.id} type="button" onClick={() => onSelect(slot)} className={cn("min-h-24 rounded-xl border p-2 text-left transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 sm:min-h-28", slotTone[slot.status], selectedSlotId === slot.id && "ring-2 ring-slate-950 ring-offset-2")}><p className="text-[10px] font-black uppercase sm:text-[11px]">Vaga {slot.position}</p>{slot.tool ? <><p className="mt-2 truncate font-mono text-xs font-black sm:text-sm">{slot.tool}</p><p className="mt-1 line-clamp-2 text-[10px] font-semibold sm:text-[11px]">{labels[slot.status]} · {slot.readyAt}</p></> : <p className="mt-5 text-xs font-bold sm:mt-7 sm:text-sm">Livre</p>}</button>)}</div></article>;
}

function Legend({ icon, text, tone }: { icon: ReactNode; text: string; tone: "slate" | "orange" | "green" | "red" }) {
  const tones = { slate: "bg-slate-100 text-slate-700", orange: "bg-orange-100 text-orange-700", green: "bg-emerald-100 text-emerald-700", red: "bg-red-100 text-red-700" };
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-1", tones[tone])}>{icon}{text}</span>;
}
