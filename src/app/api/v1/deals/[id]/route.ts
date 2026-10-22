import { z } from "zod";
import { db } from "@/lib/db";
import {
  assertRefsInWorkspace,
  assertUserInWorkspace,
  fail,
  handler,
  ok,
  parseBody,
  requireWorkspace,
  requireWorkspaceFromBody,
} from "@/lib/server/api";
import { attachTags, syncTags } from "@/lib/server/tags";
import { createActivity, audit, notify } from "@/lib/server/activity";
import { runAutomations } from "@/lib/server/automation";

type Params = { params: Promise<{ id: string }> };

// ---- Detail ----
export const GET = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireWorkspace(req);
  const deal = await db.deal.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: {
      stage: true,
      owner: { select: { id: true, name: true, email: true } },
      contact: { select: { id: true, name: true, email: true, phone: true } },
      company: { select: { id: true, name: true } },
    },
  });
  if (!deal) return fail(404, "NOT_FOUND", "Deal not found.");
  const [withTags] = await attachTags(ctx.workspaceId, "deal", [deal]);
  const activities = await db.activity.findMany({
    where: { workspaceId: ctx.workspaceId, dealId: id },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const tasks = await db.task.findMany({
    where: { workspaceId: ctx.workspaceId, dealId: id },
    include: { assignee: { select: { id: true, name: true } } },
    orderBy: [{ status: "asc" }, { dueAt: "asc" }],
    take: 50,
  });
  const stageHistory = await db.activity.findMany({
    where: { workspaceId: ctx.workspaceId, dealId: id, type: "STAGE_CHANGE" },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  return ok({ ...withTags, activities, tasks, stageHistory });
});

// ---- Update (incl. stage move, won/lost) ----
const updateSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1).max(120).optional(),
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  contactId: z.string().nullable().optional().or(z.literal("")),
  companyId: z.string().nullable().optional().or(z.literal("")),
  value: z.number().min(0).max(1e12).optional(),
  currency: z.string().min(3).max(6).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  ownerId: z.string().nullable().optional().or(z.literal("")),
  expectedCloseDate: z.string().datetime().nullable().optional(),
  actualCloseDate: z.string().datetime().nullable().optional(),
  source: z.string().max(40).nullable().optional().or(z.literal("")),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  description: z.string().max(5000).nullable().optional().or(z.literal("")),
  lostReason: z.string().max(500).nullable().optional().or(z.literal("")),
  archived: z.boolean().optional(),
  tags: z.array(z.string()).max(20).optional(),
});

export const PATCH = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, updateSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  const existing = await db.deal.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: { stage: true },
  });
  if (!existing) return fail(404, "NOT_FOUND", "Deal not found.");

  // Cross-workspace authorization: linked records and owner must belong to
  // the caller's workspace (empty string / null means "unlink").
  await assertRefsInWorkspace(
    [
      ["contact", body.contactId || null],
      ["company", body.companyId || null],
    ],
    ctx.workspaceId
  );
  await assertUserInWorkspace(body.ownerId || null, ctx.workspaceId);

  // Validate target stage when moving
  let newStage = existing.stage;
  let stageChanged = false;
  if (body.stageId && body.stageId !== existing.stageId) {
    const stage = await db.stage.findFirst({
      where: { id: body.stageId, pipeline: { workspaceId: ctx.workspaceId } },
    });
    if (!stage) return fail(404, "NOT_FOUND", "Stage not found.");
    if (body.pipelineId && stage.pipelineId !== body.pipelineId) {
      return fail(400, "BAD_REQUEST", "Stage does not belong to the pipeline.");
    }
    newStage = stage;
    stageChanged = true;
  }

  const now = new Date();
  const deal = await db.deal.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title.trim() } : {}),
      ...(stageChanged
        ? {
            stageId: newStage.id,
            stageEnteredAt: now,
            probability: body.probability ?? newStage.probability,
            // Closing semantics based on stage type
            ...(newStage.type === "WON" ? { actualCloseDate: now } : {}),
            ...(newStage.type === "LOST" ? { actualCloseDate: now } : {}),
            ...(newStage.type === "OPEN" ? { actualCloseDate: null } : {}),
          }
        : {}),
      ...(body.contactId !== undefined ? { contactId: body.contactId || null } : {}),
      ...(body.companyId !== undefined ? { companyId: body.companyId || null } : {}),
      ...(body.value !== undefined ? { value: body.value } : {}),
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
      ...(body.probability !== undefined && !stageChanged ? { probability: body.probability } : {}),
      ...(body.ownerId !== undefined ? { ownerId: body.ownerId || null } : {}),
      ...(body.expectedCloseDate !== undefined
        ? { expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null }
        : {}),
      ...(body.actualCloseDate !== undefined
        ? { actualCloseDate: body.actualCloseDate ? new Date(body.actualCloseDate) : null }
        : {}),
      ...(body.source !== undefined ? { source: body.source || null } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.description !== undefined ? { description: body.description || null } : {}),
      ...(body.lostReason !== undefined ? { lostReason: body.lostReason || null } : {}),
      ...(body.archived !== undefined ? { archived: body.archived } : {}),
      lastActivityAt: now,
    },
    include: { stage: true },
  });

  if (body.tags !== undefined) await syncTags(ctx.workspaceId, "deal", id, body.tags, []);

  if (stageChanged) {
    await createActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      type: "STAGE_CHANGE",
      title: "STAGE_CHANGED",
      dealId: id,
      contactId: deal.contactId,
      companyId: deal.companyId,
      metadata: { from: existing.stage.name, to: newStage.name, fromType: existing.stage.type, toType: newStage.type },
    });
    if (deal.ownerId && deal.ownerId !== ctx.user.id) {
      await notify({
        workspaceId: ctx.workspaceId,
        userId: deal.ownerId,
        type: "SYSTEM",
        title: deal.title,
        body: "DEAL_STAGE_CHANGED",
        link: `deals?dealId=${deal.id}`,
        dedupeKey: `deal-stage:${deal.id}:${newStage.id}:${now.getTime()}`,
      });
    }
    await runAutomations({
      workspaceId: ctx.workspaceId,
      trigger: "DEAL_STAGE_CHANGED",
      entityType: "deal",
      entity: { ...deal, title: deal.title, fromStage: existing.stage.name, toStage: newStage.name },
      actorId: ctx.user.id,
    });
  }

  if (body.ownerId !== undefined && body.ownerId && body.ownerId !== existing.ownerId) {
    await runAutomations({
      workspaceId: ctx.workspaceId,
      trigger: "RECORD_ASSIGNED",
      entityType: "deal",
      entity: { ...deal, title: deal.title },
      actorId: ctx.user.id,
    });
  }

  await audit({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    action: stageChanged ? "UPDATE" : "UPDATE",
    entityType: "deal",
    entityId: id,
    detail: stageChanged ? { stage: newStage.name } : undefined,
  });

  return ok(deal);
});

// ---- Delete ----
export const DELETE = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireWorkspace(req);
  const existing = await db.deal.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) return fail(404, "NOT_FOUND", "Deal not found.");
  await db.deal.delete({ where: { id } });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "DELETE", entityType: "deal", entityId: id });
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
