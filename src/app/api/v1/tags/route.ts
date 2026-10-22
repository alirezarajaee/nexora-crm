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

// ---- List tags of workspace ----
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const tags = await db.tag.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { name: "asc" },
    include: { _count: { select: { relations: true } } },
  });
  return ok(
    tags.map((t) => ({ id: t.id, name: t.name, color: t.color, usageCount: t._count.relations }))
  );
});

// ---- Create tag ----
const createSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, createSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);
  const existing = await db.tag.findUnique({
    where: { workspaceId_name: { workspaceId: ctx.workspaceId, name: body.name.trim() } },
  });
  if (existing) return ok(existing);
  const tag = await db.tag.create({
    data: { workspaceId: ctx.workspaceId, name: body.name.trim(), color: body.color ?? "#8B5CF6" },
  });
  return ok(tag, 201);
});

// ---- Delete tag ----
export const DELETE = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail(400, "BAD_REQUEST", "id is required.");
  const tag = await db.tag.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!tag) return fail(404, "NOT_FOUND", "Tag not found.");
  await db.tag.delete({ where: { id } });
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
