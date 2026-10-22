/**
 * Shared helpers for NEXORA CRM API tests.
 * Route handlers are invoked directly against the real test database.
 * Every call carries its own auth context (AsyncLocalStorage) because test
 * files run concurrently.
 */
import { makeCtx, requestStore } from "./ctx";
import type { Handler } from "./route-types";

export interface RouteModule {
  GET?: Handler;
  POST?: Handler;
  PATCH?: Handler;
  DELETE?: Handler;
  PUT?: Handler;
}

export interface CallOpts {
  body?: unknown;
  params?: Record<string, string>;
  /** Bearer token (preferred auth mode) */
  token?: string;
  /** Client IP used for rate-limit bucketing (each test user gets its own) */
  ip?: string;
  /** Cookie-based session (cookie auth mode) */
  cookie?: string;
  /** Output: cookies set by the handler (e.g. session cookie from login) */
  cookieJar?: Map<string, string>;
}

export async function callRoute(
  mod: RouteModule,
  method: "GET" | "POST" | "PATCH" | "DELETE" | "PUT",
  path: string,
  opts: CallOpts = {}
): Promise<Response> {
  const url = new URL(path, "http://test.local");
  // Auto-populate dynamic [id] route params from the path unless provided.
  const params = opts.params ?? autoIdParams(path);
  // The reverse proxy sets X-Forwarded-For on the raw request — mirror that
  // so route code reading req.headers (e.g. clientIp for rate limits) sees it.
  const reqHeaders: Record<string, string> = { "content-type": "application/json" };
  if (opts.ip) reqHeaders["x-forwarded-for"] = opts.ip;
  const req = new Request(url, {
    method,
    headers: reqHeaders,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const fn = (mod as Record<string, Handler | undefined>)[method];
  if (!fn) throw new Error(`${method} not exported by route module`);
  const ctx = { params: Promise.resolve(params) };
  const ctxMaps = makeCtx({ token: opts.token, ip: opts.ip, cookie: opts.cookie });
  const res = await requestStore.run(ctxMaps, () => fn(req, ctx));
  if (opts.cookieJar) {
    for (const [k, v] of ctxMaps.cookies) opts.cookieJar.set(k, v);
  }
  return res;
}

/**
 * Auto-detects dynamic route params (e.g. /leads/<id>, /leads/<id>/convert)
 * from the path so tests can call [id] route handlers directly.
 */
function autoIdParams(path: string): Record<string, string> {
  const m = path.match(
    /\/(?:leads|contacts|companies|deals|tasks|automation\/rules)\/([^/?]+)/
  );
  if (!m) return {};
  return { id: m[1] };
}

export interface TestUser {
  email: string;
  token: string;
  userId: string;
  workspaceId: string;
  ip: string;
}

let userCounter = 1;
let ipCounter = 1;

/** Registers a fresh user + own workspace; returns auth context. */
export async function registerUser(prefix = "user"): Promise<TestUser> {
  const { POST } = await import("@/app/api/v1/auth/register/route");
  const email = `${prefix}-${Date.now()}-${userCounter++}@test.local`;
  const ip = `10.77.${Math.floor(ipCounter / 250) % 250}.${(ipCounter++ % 250) + 1}`;
  const res = await callRoute({ POST }, "POST", "/api/v1/auth/register", {
    body: { name: `${prefix} Tester`, email, password: "password123" },
    ip,
  });
  if (res.status !== 201) {
    throw new Error(`registerUser failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as {
    token: string;
    user: { id: string };
    memberships: { workspaceId: string }[];
  };
  return {
    email,
    token: data.token,
    userId: data.user.id,
    workspaceId: data.memberships[0].workspaceId,
    ip,
  };
}

export async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}
