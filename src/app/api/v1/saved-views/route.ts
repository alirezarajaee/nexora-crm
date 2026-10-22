import { z } from "zod";
import { db } from "@/lib/db";
import {
  fail,
  handler,
  ok,
  parseBody,
  requireWorkspace,
  requireWorkspaceFromBody,
  urlToFilters,
} from "@/lib/server/api";

// ---- List saved views (own) ----
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const entityType = urlToFilters(req).get("entityType") || undefined;
  const views = await db.savedView.findMany({
    where: {
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      ...(entityType ? { entityType } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
  return ok(
    views.map((v) => ({
      id: v.id,
      name: v.name,
      entityType: v.entityType,
      filters: JSON.parse(v.filters || "{}") as Record<string, unknown>,
      createdAt: v.createdAt.toISOString(),
    }))
  );
});

const createSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(60),
  entityType: z.string().min(1).max(40),
  filters: z.record(z.string(), z.unknown()).default({}),
});

// ---- Create ----
export const POST = handler(async (req) => {
  const body = await parseBody(req, createSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);
  const existing = await db.savedView.findFirst({
    where: {
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      entityType: body.entityType,
      name: body.name.trim(),
    },
  });
  if (existing) return fail(409, "DUPLICATE", "A view with this name exists.");
  const view = await db.savedView.create({
    data: {
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      name: body.name.trim(),
      entityType: body.entityType,
      filters: JSON.stringify(body.filters),
    },
  });
  return ok({ id: view.id }, 201);
});

// ---- Delete ----
export const DELETE = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail(400, "BAD_REQUEST", "id is required.");
  // deleteMany is scoped by id + workspace + owner; a foreign id deletes
  // nothing, which is reported honestly as 404 instead of a fake success.
  const deleted = await db.savedView.deleteMany({
    where: { id, workspaceId: ctx.workspaceId, userId: ctx.user.id },
  });
  if (deleted.count === 0) return fail(404, "NOT_FOUND", "Saved view not found.");
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
