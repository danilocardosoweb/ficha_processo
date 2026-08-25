"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { DesktopNav } from "@/components/app-nav";
import { cn } from "@/lib/utils";
import { CurrentUserProvider } from "@/components/current-user-provider";
import type { LocalUser } from "@/lib/local-auth/types";
import { OperationalMessagesProvider } from "@/components/operational-messages-provider";

const storageKey = "alummes-sidebar-collapsed";

export function AppShell({ children, user }: { children: ReactNode; user: LocalUser }) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      setCollapsed(window.localStorage.getItem(storageKey) === "true");
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  function toggleSidebar() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(storageKey, String(next));
      return next;
    });
  }

  return (
    <CurrentUserProvider user={user}><OperationalMessagesProvider><div className="min-h-screen bg-[#f6f5f2]">
      <DesktopNav collapsed={collapsed} onToggle={toggleSidebar} />
      <div
        className={cn(
          "transition-[padding] duration-200",
          collapsed ? "lg:pl-[72px]" : "lg:pl-64",
        )}
      >
        <AppHeader user={user} />
        <main className="mx-auto max-w-[1800px] p-4 md:p-8">{children}</main>
      </div>
    </div></OperationalMessagesProvider></CurrentUserProvider>
  );
}
