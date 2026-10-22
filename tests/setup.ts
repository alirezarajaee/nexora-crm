/**
 * NEXORA CRM — test bootstrap (bun test preload).
 *
 * What it does, in order:
 *  1. Points DATABASE_URL at a FRESH temporary SQLite file — tests never
 *     touch the development database (db/custom.db) or its demo data.
 *  2. Mocks `next/headers` with a per-request context (AsyncLocalStorage)
 *     so concurrent test files each get isolated headers/cookies.
 *  3. Pushes the real Prisma schema into the temp database.
 *
 * Route handlers are then exercised for real: real handler code, real
 * Prisma queries, real SQLite transactions, real auth/session logic.
 */
import { mock } from "bun:test";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestStore } from "./ctx";

// ---- 1) Fresh isolated database ----
const testDir = mkdtempSync(join(tmpdir(), "nexora-test-"));
const testDbPath = join(testDir, "test.db");
process.env.DATABASE_URL = `file:${testDbPath}`;
(process.env as Record<string, string | undefined>).NODE_ENV = "test";

// ---- 2) Per-request mock for next/headers ----
mock.module("next/headers", () => ({
  headers: async () => {
    const ctx = requestStore.getStore();
    if (!ctx) throw new Error("No request context — call route handlers via tests/helpers.callRoute");
    return { get: (name: string) => ctx.headers.get(name.toLowerCase()) ?? null };
  },
  cookies: async () => {
    const ctx = requestStore.getStore();
    if (!ctx) throw new Error("No request context — call route handlers via tests/helpers.callRoute");
    return {
      get: (name: string) =>
        ctx.cookies.has(name) ? { name, value: ctx.cookies.get(name) as string } : undefined,
      set: (cookie: { name: string; value: string } | string, value?: string) => {
        if (typeof cookie === "string") ctx.cookies.set(cookie, value ?? "");
        else ctx.cookies.set(cookie.name, cookie.value);
      },
      delete: (name: string) => {
        ctx.cookies.delete(name);
      },
    };
  },
}));

// ---- 3) Schema push into the temp database ----
const projectRoot = join(import.meta.dir, "..");
try {
  execSync("bunx prisma db push --skip-generate", {
    cwd: projectRoot,
    env: process.env,
    stdio: "pipe",
  });
} catch (err) {
  console.error("Failed to prepare the test database:", err);
  process.exit(1);
}

// Cleanup after the whole run
process.on("exit", () => {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best effort
  }
});
