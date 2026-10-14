import "server-only";

import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { appendLocalAuditEvent, getLocalDatabase, hashOpaqueToken } from "@/lib/local-db/database";
import { localRoles, type LocalRole, type LocalUser, type ManagedUser } from "@/lib/local-auth/types";

const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const lockDurationMs = 15 * 60 * 1000;
const passwordPrefix = "scrypt-v1";

type UserRow = {
  id: string;
  organization_id: string;
  username: string;
  email: string | null;
  display_name: string;
  password_hash: string;
  role: LocalRole;
  machine_codes_json: string;
  access_overrides_json: string;
  is_active: number;
  must_change_password: number;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  expires_at?: string;
};

function at() {
  return new Date().toISOString();
}

function parseObject(value: string): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, boolean> : {};
  } catch {
    return {};
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function localUser(row: UserRow): LocalUser {
  return {
    user_id: row.id,
    organization_id: row.organization_id,
    username: row.username,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    machine_codes: parseStringArray(row.machine_codes_json),
    must_change_password: Boolean(row.must_change_password),
    expires_at: row.expires_at ?? new Date(Date.now() + sessionLifetimeMs).toISOString(),
    access_overrides: parseObject(row.access_overrides_json),
  };
}

function passwordHash(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const derived = scryptSync(password, salt, 64).toString("base64url");
  return `${passwordPrefix}$${salt}$${derived}`;
}

function passwordMatches(password: string, stored: string) {
  const [prefix, salt, hash] = stored.split("$");
  if (prefix !== passwordPrefix || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function createSession(row: UserRow, userAgent?: string | null) {
  const token = randomBytes(32).toString("base64url");
  const createdAt = at();
  const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
  getLocalDatabase().prepare(`
    insert into local_sessions(id, user_id, token_hash, expires_at, created_at, last_seen_at, user_agent)
    values (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), row.id, hashOpaqueToken(token), expiresAt, createdAt, createdAt, userAgent?.slice(0, 500) ?? null);
  return { token, user: localUser({ ...row, expires_at: expiresAt }) };
}

export function hasLocalUsers() {
  const row = getLocalDatabase().prepare("select count(*) as count from local_users").get() as { count: number };
  return row.count > 0;
}

export function bootstrapLocalAdministrator(input: { username: string; displayName: string; password: string; email?: string | null; userAgent?: string | null }) {
  if (hasLocalUsers()) throw new Error("O primeiro acesso já foi configurado.");
  const username = input.username.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const email = input.email?.trim().toLowerCase() || null;
  const id = randomUUID();
  const timestamp = at();
  const row: UserRow = {
    id, organization_id: "local", username, email, display_name: displayName, password_hash: passwordHash(input.password),
    role: "admin", machine_codes_json: "[]", access_overrides_json: "{}", is_active: 1, must_change_password: 0,
    failed_login_attempts: 0, locked_until: null, last_login_at: null, created_at: timestamp, updated_at: timestamp,
  };

  const connection = getLocalDatabase();
  connection.transaction(() => {
    connection.prepare(`
      insert into local_users(id, organization_id, username, email, display_name, password_hash, role, machine_codes_json, access_overrides_json, is_active, must_change_password, failed_login_attempts, created_at, updated_at)
      values (@id, @organization_id, @username, @email, @display_name, @password_hash, @role, @machine_codes_json, @access_overrides_json, @is_active, @must_change_password, @failed_login_attempts, @created_at, @updated_at)
    `).run(row);
    appendLocalAuditEvent({ actorUserId: id, entityType: "user", entityId: id, eventType: "administrator_bootstrapped", details: { username } });
  })();
  return createSession(row, input.userAgent);
}

export function authenticateLocalUser(login: string, password: string, userAgent?: string | null) {
  const normalizedLogin = login.trim().toLowerCase();
  const connection = getLocalDatabase();
  const row = connection.prepare(`
    select * from local_users where username = ? or email = ? limit 1
  `).get(normalizedLogin, normalizedLogin) as UserRow | undefined;
  if (!row || !row.is_active) return { error: "INVALID" as const };
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) return { error: "LOCKED" as const };

  if (!passwordMatches(password, row.password_hash)) {
    const attempts = row.failed_login_attempts + 1;
    const lockedUntil = attempts >= 5 ? new Date(Date.now() + lockDurationMs).toISOString() : null;
    connection.prepare("update local_users set failed_login_attempts = ?, locked_until = ?, updated_at = ? where id = ?").run(attempts, lockedUntil, at(), row.id);
    appendLocalAuditEvent({ actorUserId: row.id, entityType: "user", entityId: row.id, eventType: "login_failed", details: { attempts } });
    return { error: lockedUntil ? "LOCKED" as const : "INVALID" as const };
  }

  connection.prepare("update local_users set failed_login_attempts = 0, locked_until = null, last_login_at = ?, updated_at = ? where id = ?").run(at(), at(), row.id);
  appendLocalAuditEvent({ actorUserId: row.id, entityType: "session", entityId: row.id, eventType: "login" });
  return createSession({ ...row, failed_login_attempts: 0, locked_until: null }, userAgent);
}

export function getLocalSession(token: string): LocalUser | null {
  const connection = getLocalDatabase();
  const row = connection.prepare(`
    select u.*, s.expires_at from local_sessions s
    join local_users u on u.id = s.user_id
    where s.token_hash = ? and s.revoked_at is null and s.expires_at > ? and u.is_active = 1
    limit 1
  `).get(hashOpaqueToken(token), at()) as UserRow | undefined;
  if (!row) return null;
  connection.prepare("update local_sessions set last_seen_at = ? where token_hash = ? and last_seen_at < ?").run(at(), hashOpaqueToken(token), new Date(Date.now() - 60_000).toISOString());
  return localUser(row);
}

export function revokeLocalSession(token: string) {
  getLocalDatabase().prepare("update local_sessions set revoked_at = ? where token_hash = ? and revoked_at is null").run(at(), hashOpaqueToken(token));
}

export function listManagedLocalUsers(): ManagedUser[] {
  return (getLocalDatabase().prepare("select * from local_users order by display_name collate nocase").all() as UserRow[]).map((row) => ({
    id: row.id,
    username: row.username,
    email: row.email,
    display_name: row.display_name,
    role: row.role,
    machine_codes: parseStringArray(row.machine_codes_json),
    is_active: Boolean(row.is_active),
    must_change_password: Boolean(row.must_change_password),
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    access_overrides: parseObject(row.access_overrides_json),
  }));
}

export function isValidLocalRole(role: string): role is LocalRole {
  return (localRoles as readonly string[]).includes(role);
}
