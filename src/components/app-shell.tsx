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
  const [compactViewport, setCompactViewport] = useState(false);

  useEffect(() => {
    const restore = window.setTimeout(() => {
      setCollapsed(window.localStorage.getItem(storageKey) === "true");
    }, 0);
    return () => window.clearTimeout(restore);
  }, []);

  useEffect(() => {
    const heartbeat = () => {
      if (document.visibilityState === "visible") {
        void fetch("/api/session/heartbeat", { method: "POST", cache: "no-store" });
      }
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 45_000);
    document.addEventListener("visibilitychange", heartbeat);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", heartbeat);
    };
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1439px)");
    const update = () => setCompactViewport(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  function toggleSidebar() {
    setCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem(storageKey, String(next));
      return next;
    });
  }

  const effectiveCollapsed = collapsed || compactViewport;

  return (
    <CurrentUserProvider user={user}><OperationalMessagesProvider><div className="min-h-screen bg-[#f6f5f2]">
      <DesktopNav collapsed={effectiveCollapsed} onToggle={compactViewport ? undefined : toggleSidebar} />
      <div
        className={cn(
          "transition-[padding] duration-200",
          effectiveCollapsed ? "lg:pl-[72px]" : "lg:pl-64",
        )}
      >
        <AppHeader user={user} />
        <main className="mx-auto max-w-[1800px] p-4 md:p-8">{children}</main>
      </div>
    </div></OperationalMessagesProvider></CurrentUserProvider>
  );
}
