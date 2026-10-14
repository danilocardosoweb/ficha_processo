import "server-only";

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/local-auth/server";
import { isLocalDesktopMode } from "@/lib/local-db/mode";

const catalogRoles = new Set(["admin", "manager", "pcp", "engineering"]);

export async function getLocalCatalogActor() {
  if (!isLocalDesktopMode()) {
    return { user: null, response: NextResponse.json({ error: "Edição local não habilitada." }, { status: 404 }) };
  }
  const user = await getCurrentUser();
  if (!user) return { user: null, response: NextResponse.json({ error: "Sessão encerrada." }, { status: 401 }) };
  if (!catalogRoles.has(user.role)) {
    return { user: null, response: NextResponse.json({ error: "Seu perfil não pode consultar ou alterar estes cadastros." }, { status: 403 }) };
  }
  return { user, response: null };
}

export async function getLocalResourceActor() {
  if (!isLocalDesktopMode()) {
    return { user: null, response: NextResponse.json({ error: "Edição local não habilitada." }, { status: 404 }) };
  }
  const user = await getCurrentUser();
  if (!user) return { user: null, response: NextResponse.json({ error: "Sessão encerrada." }, { status: 401 }) };
  return { user, response: null };
}

export function requireLocalResourceRole(user: { role: string }, roles: readonly string[], action: string) {
  return roles.includes(user.role)
    ? null
    : NextResponse.json({ error: `Seu perfil não pode ${action}.` }, { status: 403 });
}

export function localResourceError(error: unknown) {
  const sqliteCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (sqliteCode === "SQLITE_CONSTRAINT_UNIQUE") {
    return NextResponse.json({ error: "Já existe um cadastro com este código ou vínculo." }, { status: 409 });
  }
  const message = error instanceof Error ? error.message : "Não foi possível salvar o cadastro.";
  return NextResponse.json({ error: message }, { status: 400 });
}

export function localCatalogError(error: unknown) {
  const sqliteCode = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (sqliteCode === "SQLITE_CONSTRAINT_UNIQUE") {
    return NextResponse.json({ error: "Já existe um cadastro com este código, matriz e sequência." }, { status: 409 });
  }
  const message = error instanceof Error ? error.message : "Não foi possível salvar o cadastro.";
  return NextResponse.json({ error: message }, { status: 400 });
}
