import type { LocalRole } from "@/lib/local-auth/types";

export const accessAreas = [
  { key: "dashboard", label: "Visão geral" },
  { key: "production", label: "Produção" },
  { key: "orders", label: "Ordens e planos" },
  { key: "import", label: "Importação" },
  { key: "oven", label: "Forno" },
  { key: "planning", label: "Planejamento" },
  { key: "simulation", label: "Carga Máquina" },
  { key: "engineering", label: "Engenharia" },
  { key: "maintenance", label: "Manutenção" },
  { key: "quality", label: "Qualidade" },
  { key: "indicators", label: "Indicadores" },
  { key: "messages", label: "Avisos operacionais" },
  { key: "audit", label: "Auditoria" },
  { key: "administration", label: "Administração" },
] as const;

export type AccessArea = (typeof accessAreas)[number]["key"];
type AccessFlags = Record<AccessArea, boolean>;

const none = (): AccessFlags => Object.fromEntries(accessAreas.map((area) => [area.key, false])) as AccessFlags;
const grant = (...areas: AccessArea[]): AccessFlags => ({ ...none(), ...Object.fromEntries(areas.map((area) => [area, true])) });

export const assignableRoles: LocalRole[] = ["admin", "manager", "pcp", "engineering", "maintenance", "quality", "viewer"];

export const roleAccess: Record<LocalRole, AccessFlags> = {
  admin: grant(...accessAreas.map((area) => area.key)),
  manager: grant("dashboard", "production", "orders", "import", "oven", "planning", "simulation", "engineering", "maintenance", "quality", "indicators", "messages", "audit"),
  pcp: grant("dashboard", "production", "orders", "import", "oven", "planning", "simulation", "indicators", "messages", "audit"),
  engineering: grant("dashboard", "orders", "oven", "planning", "simulation", "engineering", "quality", "indicators"),
  maintenance: grant("dashboard", "oven", "maintenance", "indicators"),
  quality: grant("dashboard", "orders", "quality", "indicators"),
  viewer: grant("dashboard", "orders", "oven", "indicators"),
  operator: grant("dashboard", "production", "orders", "oven", "indicators"),
};

export const roleDescriptions: Record<LocalRole, string> = {
  admin: "Controle integral, usuários, configurações e auditoria.",
  manager: "Visão gerencial de toda a operação, decisões, avisos e auditoria.",
  pcp: "Programação, materiais, forno, simulação e comunicação operacional.",
  engineering: "Receitas, recursos técnicos, simulação e acompanhamento do processo.",
  maintenance: "Forno, paradas, manutenção e avisos destinados à área.",
  quality: "Produção, ordens, qualidade e indicadores.",
  viewer: "Consulta ampla sem acesso às áreas administrativas ou de apontamento.",
  operator: "Perfil operacional legado. Reclassifique quando possível.",
};

export function canAccess(role: LocalRole, area: AccessArea) {
  return roleAccess[role]?.[area] ?? false;
}

export function visibleAccessAreas(role: LocalRole) {
  return accessAreas.filter((area) => canAccess(role, area.key));
}
