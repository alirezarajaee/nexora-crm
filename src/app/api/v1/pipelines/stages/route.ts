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

// ---- Create stage ----
const createSchema = z.object({
  workspaceId: z.string().min(1),
  pipelineId: z.string().min(1),
  name: z.string().min(1).max(60),
  probability: z.number().int().min(0).max(100).optional(),
  type: z.enum(["OPEN", "WON", "LOST"]).optional(),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, createSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);
  requireRole(ctx, "OWNER", "ADMIN");

  const pipeline = await db.pipeline.findFirst({
    where: { id: body.pipelineId, workspaceId: ctx.workspaceId },
    include: { stages: true },
  });
  if (!pipeline) return fail(404, "NOT_FOUND", "Pipeline not found.");

  const maxOrder = pipeline.stages.reduce((max, s) => Math.max(max, s.order), 0);
  const stage = await db.stage.create({
    data: {
      pipelineId: body.pipelineId,
      key: `stage-${Date.now()}`,
      name: body.name.trim(),
      order: maxOrder + 1,
      probability: body.probability ?? 50,
      type: body.type ?? "OPEN",
    },
  });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "CREATE", entityType: "stage", entityId: stage.id });
  return ok(stage, 201);
});

// ---- Update stage ----
const patchSchema = z.object({
  workspaceId: z.string().min(1),
  stageId: z.string().min(1),
  name: z.string().min(1).max(60).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  type: z.enum(["OPEN", "WON", "LOST"]).optional(),
});

export const PATCH = handler(async (req) => {
  const body = await parseBody(req, patchSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);
  requireRole(ctx, "OWNER", "ADMIN");

  const stage = await db.stage.findFirst({
    where: { id: body.stageId, pipeline: { workspaceId: ctx.workspaceId } },
  });
  if (!stage) return fail(404, "NOT_FOUND", "Stage not found.");

  const updated = await db.stage.update({
    where: { id: stage.id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.probability !== undefined ? { probability: body.probability } : {}),
      ...(body.type !== undefined ? { type: body.type } : {}),
    },
  });

  // Keep OPEN deal probabilities roughly aligned when the stage default changes
  if (body.probability !== undefined) {
    await db.deal.updateMany({
      where: { stageId: stage.id, stage: { type: "OPEN" } },
      data: { probability: body.probability },
    });
  }
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "UPDATE", entityType: "stage", entityId: stage.id });
  return ok(updated);
});

// ---- Delete stage (only if empty) ----
export const DELETE = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  requireRole(ctx, "OWNER", "ADMIN");
  const stageId = new URL(req.url).searchParams.get("stageId");
  if (!stageId) return fail(400, "BAD_REQUEST", "stageId is required.");
  const stage = await db.stage.findFirst({
    where: { id: stageId, pipeline: { workspaceId: ctx.workspaceId } },
    include: { _count: { select: { deals: true } } },
  });
  if (!stage) return fail(404, "NOT_FOUND", "Stage not found.");
  if (stage._count.deals > 0) return fail(409, "DUPLICATE", "Stage has deals.");
  await db.stage.delete({ where: { id: stageId } });
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
