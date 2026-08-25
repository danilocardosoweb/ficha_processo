export const localRoles = ["admin", "pcp", "operator", "engineering", "maintenance", "quality", "viewer"] as const;
export const LOCAL_SESSION_COOKIE = "alummes_session";
export type LocalRole = (typeof localRoles)[number];

export const roleLabels: Record<LocalRole, string> = {
  admin: "Administrador",
  pcp: "PCP",
  operator: "Operador",
  engineering: "Engenharia",
  maintenance: "Manutenção",
  quality: "Qualidade",
  viewer: "Consulta",
};

export type LocalUser = {
  user_id: string;
  organization_id: string;
  username: string;
  email: string | null;
  display_name: string;
  role: LocalRole;
  machine_codes: string[];
  must_change_password: boolean;
  expires_at: string;
};

export type ManagedUser = {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  role: LocalRole;
  machine_codes: string[];
  is_active: boolean;
  must_change_password: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export function userInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "US";
}
