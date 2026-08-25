"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { LocalUser } from "@/lib/local-auth/types";

const CurrentUserContext = createContext<LocalUser | null>(null);

export function CurrentUserProvider({ user, children }: { user: LocalUser; children: ReactNode }) {
  return <CurrentUserContext.Provider value={user}>{children}</CurrentUserContext.Provider>;
}

export function useCurrentUser() {
  const user = useContext(CurrentUserContext);
  if (!user) throw new Error("Usuário local não disponível.");
  return user;
}
