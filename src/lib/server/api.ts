import { NextResponse } from "next/server";
import { ZodError, ZodSchema } from "zod";
import { getAuthUser, getWorkspaceContext } from "./auth";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---- Consistent JSON responses ----

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}

export function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown
) {
  return NextResponse.json(
    { error: { code, message, ...(details !== undefined ? { details } : {}) } },
    { status }
  );
}

export class HttpError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ---- Handler wrapper: converts thrown errors to consistent responses ----

export function handler<Ctx = any>(fn: (req: Request, ctx: Ctx) => Promise<Response>) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        return fail(err.status, err.code, err.message, err.details);
      }
      if (err instanceof ZodError) {
        return fail(422, "VALIDATION_ERROR", "Invalid input.", err.issues);
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === "P2025") return fail(404, "NOT_FOUND", "Record not found.");
        if (err.code === "P2002") return fail(409, "DUPLICATE", "A duplicate record already exists.");
      }
      console.error("[api] unexpected error:", err);
      return fail(500, "SERVER_ERROR", "An unexpected error occurred.");
    }
  };
}

// ---- Auth guards ----

export async function requireAuth() {
  const user = await getAuthUser();
  if (!user) throw new HttpError(401, "UNAUTHORIZED", "Authentication required.");
  return user;
}

export async function requireWorkspace(req: Request) {
  const url = new URL(req.url);
  const workspaceId =
    url.searchParams.get("workspaceId") ||
    headerWorkspaceId(req) ||
    null;
  const ctx = await getWorkspaceContext(workspaceId);
  if (!ctx) throw new HttpError(401, "UNAUTHORIZED", "Authentication required or workspace access denied.");
  return ctx;
}

export async function requireWorkspaceFromBody(req: Request, bodyWorkspaceId?: string) {
  const ctx = await getWorkspaceContext(bodyWorkspaceId ?? headerWorkspaceId(req));
  if (!ctx) throw new HttpError(401, "UNAUTHORIZED", "Authentication required or workspace access denied.");
  return ctx;
}

export function requireRole(ctx: { role: string }, ...roles: string[]) {
  if (!roles.includes(ctx.role)) {
    throw new HttpError(403, "FORBIDDEN", "You do not have permission to perform this action.");
  }
}

function headerWorkspaceId(req: Request): string | null {
  return req.headers.get("x-workspace-id");
}

// ---- Query helpers ----

export function urlToFilters(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}

export function getListParams(
  sp: URLSearchParams,
  defaultPageSize = 20,
  maxPageSize = 100
): { page: number; pageSize: number; skip: number; sort: string | null; dir: "asc" | "desc" } {
  const page = Math.max(1, parseIntSafe(sp.get("page"), 1));
  const rawSize = parseIntSafe(sp.get("pageSize"), defaultPageSize);
  const pageSize = Math.min(maxPageSize, Math.max(1, rawSize));
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    sort: sp.get("sort"),
    dir: sp.get("dir") === "asc" ? "asc" : "desc",
  };
}

export function parseIntSafe(v: string | null, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function csvParam(sp: URLSearchParams, key: string): string[] {
  const raw = sp.get(key);
  if (!raw) return [];
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function boolParam(sp: URLSearchParams, key: string, fallback?: boolean): boolean | undefined {
  const raw = sp.get(key);
  if (raw === null || raw === "") return fallback;
  return raw === "true" || raw === "1";
}

export function dateParam(sp: URLSearchParams, key: string): Date | undefined {
  const raw = sp.get(key);
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ---- Body helpers ----

export async function parseBody<S extends ZodSchema>(req: Request, schema: S): Promise<S["_output"]> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "BAD_REQUEST", "Request body must be valid JSON.");
  }
  return schema.parse(json) as S["_output"];
}

// ---- Pagination response ----

export function paginated<T>(items: T[], total: number, page: number, pageSize: number) {
  return { items, total, page, pageSize };
}

// ---- Workspace-scoped lookup with 404 protection (avoids enumeration) ----

export async function findScoped<T extends { workspaceId: string }>(
  model: { findUnique: (args: unknown) => Promise<T | null> },
  id: string,
  workspaceId: string
): Promise<T> {
  const record = await (model.findUnique as unknown as (args: {
    where: { id: string };
  }) => Promise<T | null>)({ where: { id } });
  if (!record || record.workspaceId !== workspaceId) {
    // Do not reveal whether the record exists in another workspace
    throw new HttpError(404, "NOT_FOUND", "Record not found.");
  }
  return record;
}

// ---- Reference validation (cross-workspace authorization) ----

const REF_MODELS = {
  contact: db.contact,
  company: db.company,
  deal: db.deal,
  lead: db.lead,
  task: db.task,
};

export type ScopedRefModel = keyof typeof REF_MODELS;

type ScopedFindFirst = {
  findFirst: (args: {
    where: { id: string; workspaceId: string };
    select: { id: true };
  }) => Promise<{ id: string } | null>;
};

/**
 * Asserts that a client-supplied related-record id (contactId, companyId,
 * dealId, leadId, task.taskId…) actually exists inside the caller's
 * workspace. Empty/null ids are ignored (meaning "no link").
 * Throws 404 (NOT_FOUND) without revealing cross-workspace existence.
 */
export async function assertRefInWorkspace(
  model: ScopedRefModel,
  id: string | null | undefined,
  workspaceId: string
): Promise<void> {
  if (!id) return;
  const delegate = REF_MODELS[model] as unknown as ScopedFindFirst;
  const found = await delegate.findFirst({
    where: { id, workspaceId },
    select: { id: true },
  });
  if (!found) throw new HttpError(404, "NOT_FOUND", "Related record not found.");
}

/**
 * Asserts that a client-supplied user id (ownerId, assigneeId, automation
 * targets…) is a member of the caller's workspace. Empty/null ids ignored.
 * Throws 400 (NOT_A_MEMBER) so clients can distinguish it from missing records.
 */
export async function assertUserInWorkspace(
  userId: string | null | undefined,
  workspaceId: string
): Promise<void> {
  if (!userId) return;
  const membership = await db.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true },
  });
  if (!membership) {
    throw new HttpError(400, "NOT_A_MEMBER", "The referenced user is not a member of this workspace.");
  }
}

/** Validates several scoped refs in one call (sequential, short-circuits). */
export async function assertRefsInWorkspace(
  refs: [ScopedRefModel, string | null | undefined][],
  workspaceId: string
): Promise<void> {
  for (const [model, id] of refs) {
    await assertRefInWorkspace(model, id, workspaceId);
  }
}

export { db };
