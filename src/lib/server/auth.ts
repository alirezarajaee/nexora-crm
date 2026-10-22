import { createHash, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";
import type { Locale, Role } from "@/types/api";

export const SESSION_COOKIE = "nexora_session";
const SESSION_DAYS = 30;

// ---------- Password hashing (scrypt, no external deps) ----------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

// ---------- Sessions ----------

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Resolves the current session token from incoming request context.
 *
 * Order of precedence:
 * 1. `Authorization: Bearer <token>` header — required when the app runs
 *    inside a cross-site iframe (e.g. preview panel) where browsers block
 *    SameSite cookies, so the client keeps the token in localStorage.
 * 2. httpOnly `nexora_session` cookie — classic same-site flow.
 */
export async function getRequestToken(): Promise<string | null> {
  try {
    const h = await headers();
    const authz = h.get("authorization");
    if (authz && authz.toLowerCase().startsWith("bearer ")) {
      const bearer = authz.slice(7).trim();
      if (bearer) return bearer;
    }
  } catch {
    // headers() unavailable outside request scope — ignore
  }
  const store = await cookies();
  return store.get(SESSION_COOKIE)?.value ?? null;
}

/**
 * Creates a DB session, sets an httpOnly cookie, and returns the raw token
 * so the login/register handlers can also hand it to the client for
 * Bearer-header storage (iframe-safe fallback).
 *
 * Cookie policy is environment-aware:
 * - HTTPS (detected via x-forwarded-proto): SameSite=None + Secure so the
 *   cookie also works when the app is embedded in a cross-site iframe.
 * - Plain HTTP: SameSite=Lax (browsers reject None without Secure).
 */
export async function createSession(userId: string): Promise<string> {
  // Opportunistic cleanup: drop this user's already-expired sessions so the
  // table cannot grow unboundedly and expired sessions never linger.
  await db.session
    .deleteMany({ where: { userId, expiresAt: { lt: new Date() } } })
    .catch(() => {});

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({
    data: { tokenHash: tokenHash(token), userId, expiresAt },
  });

  let isHttps = false;
  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto") ?? "";
    isHttps = proto.split(",")[0].trim() === "https";
  } catch {
    // default to non-secure cookie
  }

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: isHttps ? "none" : "lax",
    secure: isHttps,
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return token;
}

/**
 * Deletes the DB session bound to the current request token (Bearer header
 * or cookie) and clears the cookie.
 */
export async function destroySession(): Promise<void> {
  const token = await getRequestToken();
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: tokenHash(token) } });
  }
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  locale: Locale;
}

/**
 * Resolves the authenticated user. Accepts both Bearer-token auth (iframe
 * safe) and cookie auth. Falls back to the cookie when the Bearer token is
 * missing or no longer valid, so legacy sessions keep working.
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  const candidates: string[] = [];
  try {
    const h = await headers();
    const authz = h.get("authorization");
    if (authz && authz.toLowerCase().startsWith("bearer ")) {
      const bearer = authz.slice(7).trim();
      if (bearer) candidates.push(bearer);
    }
  } catch {
    // ignore
  }
  const cookieToken = (await cookies()).get(SESSION_COOKIE)?.value;
  if (cookieToken) candidates.push(cookieToken);

  for (const token of candidates) {
    const session = await db.session.findUnique({
      where: { tokenHash: tokenHash(token) },
      include: { user: true },
    });
    if (!session) continue;
    if (session.expiresAt < new Date()) {
      await db.session.delete({ where: { id: session.id } }).catch(() => {});
      continue;
    }
    // Throttled lastUsedAt update (at most once per hour per session)
    if (Date.now() - session.lastUsedAt.getTime() > 60 * 60 * 1000) {
      await db.session
        .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
        .catch(() => {});
    }
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      locale: session.user.locale === "en" ? "en" : "fa",
    };
  }
  return null;
}

export interface WorkspaceContext {
  user: AuthUser;
  workspaceId: string;
  role: Role;
}

export async function getWorkspaceContext(
  workspaceId: string | null | undefined
): Promise<WorkspaceContext | null> {
  const user = await getAuthUser();
  if (!user) return null;
  let membership;
  if (workspaceId) {
    membership = await db.membership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId } },
    });
  } else {
    membership = await db.membership.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: "asc" },
    });
  }
  if (!membership) return null;
  return { user, workspaceId: membership.workspaceId, role: membership.role as Role };
}

// ---------- Simple in-memory rate limiter (per-process; documented) ----------

const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export function clientIp(req: Request): string {
  // When the app runs behind a trusted reverse proxy (Caddy in this
  // deployment), the proxy APPENDS the real client address to any
  // client-supplied X-Forwarded-For. Taking the LAST entry therefore yields
  // the proxy-verified IP; a spoofed first entry cannot be used to rotate
  // rate-limit buckets. With no proxy the header is absent and we fall back
  // to a single local bucket.
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const parts = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) return parts[parts.length - 1];
  }
  return "local";
}
