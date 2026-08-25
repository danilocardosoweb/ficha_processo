"use client";

import { useRouter } from "next/navigation";
import { Bell, ChevronDown, LogOut, Megaphone, Settings, UserRound } from "lucide-react";
import { MobileNav } from "@/components/app-nav";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { OfflineStatus } from "@/components/offline-status";
import type { LocalUser } from "@/lib/local-auth/types";
import { roleLabels, userInitials } from "@/lib/local-auth/types";
import { useOperationalMessages } from "@/components/operational-messages-provider";

export function AppHeader({ user }: { user: LocalUser }) {
  const router = useRouter();
  const { unreadCount, setOpen } = useOperationalMessages();
  const initials = userInitials(user.display_name);
  async function logout() {
    await fetch("/api/session/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-white/95 px-4 backdrop-blur md:px-8">
      <div className="flex items-center gap-3"><MobileNav /><OfflineStatus /></div>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" className="relative text-slate-500" aria-label={`Notificações${unreadCount ? `: ${unreadCount} não lidas` : ""}`} onClick={() => setOpen(true)}>
          <Bell className="size-5" />{unreadCount > 0 && <span className="absolute right-0.5 top-0.5 grid min-w-4 place-items-center rounded-full bg-orange-500 px-1 text-[9px] font-bold leading-4 text-white">{unreadCount > 9 ? "9+" : unreadCount}</span>}
        </Button>
        <div className="mx-1 h-7 w-px bg-slate-200" />
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center gap-2 rounded-xl p-1.5 pr-2 text-left outline-none transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-orange-500/40 data-popup-open:bg-slate-100">
            <Avatar className="size-9"><AvatarFallback className="bg-slate-900 text-xs font-bold text-white">{initials}</AvatarFallback></Avatar>
            <div className="hidden min-w-28 sm:block"><p className="text-xs font-bold text-slate-900">{user.display_name}</p><p className="text-[10px] text-slate-500">{roleLabels[user.role]}</p></div>
            <ChevronDown className="size-4 text-slate-400" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={8} className="w-64 rounded-xl p-2 shadow-xl">
            <div className="flex items-center gap-3 px-2 py-2.5">
              <Avatar className="size-10"><AvatarFallback className="bg-orange-50 text-xs font-bold text-orange-600">{initials}</AvatarFallback></Avatar>
              <span><span className="block text-sm font-bold text-slate-900">{user.display_name}</span><span className="block text-[11px] font-normal text-slate-500">{roleLabels[user.role]} · {user.username}</span></span>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/perfil")} className="gap-3 px-2.5 py-2.5 font-medium"><UserRound className="size-4 text-slate-500" />Meu perfil</DropdownMenuItem>
            {(["admin", "pcp"] as string[]).includes(user.role) && <DropdownMenuItem onClick={() => router.push("/mensagens")} className="gap-3 px-2.5 py-2.5 font-medium"><Megaphone className="size-4 text-slate-500" />Mensagens e prioridades</DropdownMenuItem>}
            {user.role === "admin" && <DropdownMenuItem onClick={() => router.push("/configuracoes")} className="gap-3 px-2.5 py-2.5 font-medium"><Settings className="size-4 text-slate-500" />Configurações</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => void logout()} className="gap-3 px-2.5 py-2.5 font-semibold"><LogOut className="size-4" />Sair do sistema</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
