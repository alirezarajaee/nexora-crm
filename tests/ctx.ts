/**
 * Per-request context store for tests.
 *
 * bun test runs test files CONCURRENTLY (interleaved at await points), so a
 * single global "current request" variable would race. AsyncLocalStorage
 * gives every callRoute() invocation its own isolated headers/cookies.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface ReqCtx {
  headers: Map<string, string>;
  cookies: Map<string, string>;
}

export const requestStore = new AsyncLocalStorage<ReqCtx>();

export function makeCtx(opts: { token?: string | null; ip?: string; cookie?: string }): ReqCtx {
  const headers = new Map<string, string>();
  const cookies = new Map<string, string>();
  if (opts.ip) headers.set("x-forwarded-for", opts.ip);
  if (opts.token) headers.set("authorization", `Bearer ${opts.token}`);
  if (opts.cookie) cookies.set("nexora_session", opts.cookie);
  return { headers, cookies };
}
