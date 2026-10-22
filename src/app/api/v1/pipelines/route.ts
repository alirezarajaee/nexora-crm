import { z } from "zod";
import { db } from "@/lib/db";
import {
  fail,
  handler,
  ok,
  parseBody,
  requireWorkspace,
  requireWorkspaceFromBody,
  requireRole,
} from "@/lib/server/api";
import { audit } from "@/lib/server/activity";

// ---- List all pipelines with stages ----
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const pipelines = await db.pipeline.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: { stages: { orderBy: { order: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  return ok(pipelines);
});

// ---- Create pipeline ----
const createSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(80),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, createSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);
  requireRole(ctx, "OWNER", "ADMIN");

  const pipeline = await db.pipeline.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: body.name.trim(),
      isDefault: false,
      stages: {
        create: [
          { key: "stage-1", name: "1", order: 1, probability: 20, type: "OPEN" },
          { key: "stage-2", name: "2", order: 2, probability: 60, type: "OPEN" },
          { key: "stage-3", name: "3", order: 3, probability: 100, type: "WON" },
        ],
      },
    },
    include: { stages: true },
  });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "CREATE", entityType: "pipeline", entityId: pipeline.id });
  return ok(pipeline, 201);
});

// ---- Delete pipeline (only if empty) ----
export const DELETE = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  requireRole(ctx, "OWNER", "ADMIN");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail(400, "BAD_REQUEST", "id is required.");
  const pipeline = await db.pipeline.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!pipeline) return fail(404, "NOT_FOUND", "Pipeline not found.");
  if (pipeline.isDefault) return fail(400, "BAD_REQUEST", "The default pipeline cannot be deleted.");
  const dealCount = await db.deal.count({ where: { pipelineId: id } });
  if (dealCount > 0) return fail(409, "DUPLICATE", "Pipeline has deals.");
  await db.pipeline.delete({ where: { id } });
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
