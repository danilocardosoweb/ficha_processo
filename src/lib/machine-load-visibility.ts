"use client";

import { useCallback, useEffect, useState } from "react";

export type MachineLoadSectionKey =
  | "intelligence"
  | "copilot"
  | "learning"
  | "thermal"
  | "alerts"
  | "simulation";

export type MachineLoadSectionVisibility = Record<
  MachineLoadSectionKey,
  boolean
>;

export const machineLoadSectionSettings: Array<{
  key: MachineLoadSectionKey;
  title: string;
  description: string;
}> = [
  {
    key: "intelligence",
    title: "Inteligência explicável e copiloto de decisão",
    description: "Nota da programação, bloqueios e explicações do motor.",
  },
  {
    key: "copilot",
    title: "Copiloto de decisão",
    description: "Cenário alternativo explicado passo a passo.",
  },
  {
    key: "learning",
    title: "Aprendizado operacional",
    description: "Comparação entre previsão e resultado real da produção.",
  },
  {
    key: "thermal",
    title: "Prontidão térmica das prensas",
    description: "Aquecimento das ferramentas e riscos de espera.",
  },
  {
    key: "alerts",
    title: "Alertas, materiais e recursos compartilhados",
    description: "Impedimentos de carcaças, BOs, tarugos e calendário.",
  },
  {
    key: "simulation",
    title: "Simulação operacional",
    description: "Programação visual em Gantt, tabela e consumo de tarugos.",
  },
];

export const machineLoadSectionKeys = machineLoadSectionSettings.map(
  (item) => item.key,
) as MachineLoadSectionKey[];

export const defaultMachineLoadSectionVisibility: MachineLoadSectionVisibility =
  Object.fromEntries(
    machineLoadSectionKeys.map((key) => [key, true]),
  ) as MachineLoadSectionVisibility;

const storagePrefix = "alummes-machine-load-section-visibility-v1";
const changeEvent = "alummes-machine-load-section-visibility-change";

function storageKey(userId?: string) {
  return `${storagePrefix}:${userId || "default"}`;
}

function sanitize(value: unknown): MachineLoadSectionVisibility {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaultMachineLoadSectionVisibility };
  }
  const source = value as Record<string, unknown>;
  return machineLoadSectionKeys.reduce(
    (result, key) => {
      result[key] =
        typeof source[key] === "boolean"
          ? source[key]
          : defaultMachineLoadSectionVisibility[key];
      return result;
    },
    {} as MachineLoadSectionVisibility,
  );
}

export function readMachineLoadSectionVisibility(
  userId?: string,
): MachineLoadSectionVisibility {
  if (typeof window === "undefined") {
    return { ...defaultMachineLoadSectionVisibility };
  }
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    return raw
      ? sanitize(JSON.parse(raw))
      : { ...defaultMachineLoadSectionVisibility };
  } catch {
    return { ...defaultMachineLoadSectionVisibility };
  }
}

export function saveMachineLoadSectionVisibility(
  userId: string | undefined,
  value: MachineLoadSectionVisibility,
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      storageKey(userId),
      JSON.stringify(sanitize(value)),
    );
  } catch {
    // A private browsing policy may prevent local storage. The UI still works for this session.
  }
}

export function useMachineLoadSectionVisibility(userId?: string) {
  const [visibility, setVisibility] = useState<MachineLoadSectionVisibility>(
    () => ({ ...defaultMachineLoadSectionVisibility }),
  );

  useEffect(() => {
    const key = storageKey(userId);
    const refresh = () => setVisibility(readMachineLoadSectionVisibility(userId));
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) refresh();
    };
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      if (!detail?.key || detail.key === key) refresh();
    };
    refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener(changeEvent, onChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(changeEvent, onChange);
    };
  }, [userId]);

  const setSectionVisible = useCallback(
    (section: MachineLoadSectionKey, visible: boolean) => {
      setVisibility((current) => {
        const next = { ...current, [section]: visible };
        saveMachineLoadSectionVisibility(userId, next);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent(changeEvent, { detail: { key: storageKey(userId) } }),
          );
        }
        return next;
      });
    },
    [userId],
  );

  const resetVisibility = useCallback(() => {
    const next = { ...defaultMachineLoadSectionVisibility };
    saveMachineLoadSectionVisibility(userId, next);
    setVisibility(next);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(changeEvent, { detail: { key: storageKey(userId) } }),
      );
    }
  }, [userId]);

  return { visibility, setSectionVisible, resetVisibility };
}
