"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Boxes, ChartNoAxesCombined, ChevronLeft, ChevronRight, Flame, Gauge, Import, Menu, PackageSearch, Settings, ShieldCheck, UnlockKeyhole, Wrench } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const navigationGroups = [
  { label: "Operação", items: [
    { label: "Visão geral", href: "/dashboard", icon: Gauge },
    { label: "Produção", href: "/producao", icon: Boxes },
    { label: "Ordens e planos", href: "/ordens", icon: PackageSearch },
    { label: "Importar simplificada", href: "/importar", icon: Import },
    { label: "Forno de ferramentas", href: "/forno", icon: Flame },
    { label: "Carteira e planejamento", href: "/planejamento", icon: ChartNoAxesCombined },
  ] },
  { label: "Acompanhamento", items: [
    { label: "Manutenção", href: "/manutencao", icon: Wrench },
    { label: "Qualidade", href: "/qualidade", icon: ShieldCheck },
    { label: "Indicadores", href: "/indicadores", icon: BarChart3 },
  ] },
];

const settingsPaths = ["/configuracoes", "/prensas", "/engenharia", "/ferramentas"];

function NavLink({ label, href, icon: Icon, active, compact, onNavigate }: {
  label: string; href: string; icon: typeof Gauge; active: boolean; compact: boolean; onNavigate?: () => void;
}) {
  return (
    <Link href={href} onClick={onNavigate} title={compact ? label : undefined} aria-label={label} aria-current={active ? "page" : undefined}
      className={cn("group flex h-11 items-center rounded-xl text-[15px] font-semibold transition-all", compact ? "justify-center px-0" : "gap-3 px-3", active ? "bg-orange-500 text-white shadow-lg shadow-orange-950/30" : "text-slate-400 hover:bg-white/[.06] hover:text-white")}
    >
      <Icon className="size-5 shrink-0" />
      {!compact && <span className="truncate">{label}</span>}
    </Link>
  );
}

function NavContent({ compact = false, onNavigate, onToggle }: { compact?: boolean; onNavigate?: () => void; onToggle?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#111927] text-slate-200">
      <div className={cn("flex h-24 shrink-0 items-center transition-all", compact ? "justify-center px-3" : "px-6")}><BrandMark compact={compact} /></div>
      <nav className={cn("flex-1 overflow-y-auto pb-3", compact ? "px-2" : "px-3")} aria-label="Navegação principal">
        {navigationGroups.map((group, groupIndex) => (
          <div key={group.label} className={cn(groupIndex > 0 && "mt-5")}>
            {!compact && <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[.2em] text-slate-600">{group.label}</p>}
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                return <NavLink key={item.href} {...item} active={active} compact={compact} onNavigate={onNavigate} />;
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="shrink-0 space-y-1 border-t border-white/[.07] p-2.5">
        <NavLink label="Configurações" href="/configuracoes" icon={Settings} active={settingsPaths.some((path) => pathname.startsWith(path))} compact={compact} onNavigate={onNavigate} />
        {onToggle && (
          <button type="button" onClick={onToggle} aria-label={compact ? "Expandir menu" : "Recolher menu"} title={compact ? "Expandir menu" : undefined}
            className={cn("flex h-10 w-full items-center rounded-xl text-sm font-semibold text-slate-400 transition hover:bg-white/[.06] hover:text-white", compact ? "justify-center" : "gap-3 px-3")}
          >
            {compact ? <ChevronRight className="size-5" /> : <><ChevronLeft className="size-5" /><span>Recolher menu</span></>}
          </button>
        )}
        <div title={compact ? "Acesso local · V1" : undefined} className={cn("flex h-9 items-center rounded-lg text-[11px] text-slate-600", compact ? "justify-center" : "gap-3 px-3")}>
          <UnlockKeyhole className="size-[17px] shrink-0" />{!compact && <span>Acesso local · V1</span>}
        </div>
      </div>
    </div>
  );
}

export function DesktopNav({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return <aside className={cn("fixed inset-y-0 left-0 z-30 hidden transition-[width] duration-200 lg:block", collapsed ? "w-[72px]" : "w-64")}><NavContent compact={collapsed} onToggle={onToggle} /></aside>;
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="outline" size="icon" className="lg:hidden" />}><Menu className="size-5" /></SheetTrigger>
      <SheetContent side="left" className="w-72 border-0 p-0"><SheetTitle className="sr-only">Menu principal</SheetTitle><NavContent onNavigate={() => setOpen(false)} /></SheetContent>
    </Sheet>
  );
}
