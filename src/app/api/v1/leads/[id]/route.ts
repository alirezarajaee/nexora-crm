import { z } from "zod";
import { db } from "@/lib/db";
import {
  assertUserInWorkspace,
  fail,
  handler,
  ok,
  parseBody,
  requireWorkspace,
  requireWorkspaceFromBody,
} from "@/lib/server/api";
import { attachTags, syncTags } from "@/lib/server/tags";
import { attachCustomFields } from "@/lib/server/tags";
import { createActivity, audit } from "@/lib/server/activity";
import { runAutomations } from "@/lib/server/automation";

type Params = { params: Promise<{ id: string }> };

// ---- Detail ----
export const GET = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireWorkspace(req);
  const lead = await db.lead.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: { owner: { select: { id: true, name: true, email: true } } },
  });
  if (!lead) return fail(404, "NOT_FOUND", "Lead not found.");
  const [withTags] = await attachTags(ctx.workspaceId, "lead", [lead]);
  const [withCustom] = await attachCustomFields(ctx.workspaceId, "lead", [withTags]);
  return ok(withCustom);
});

// ---- Update ----
const updateSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().max(160).nullable().optional().or(z.literal("")),
  phone: z.string().max(40).nullable().optional().or(z.literal("")),
  companyName: z.string().max(120).nullable().optional().or(z.literal("")),
  jobTitle: z.string().max(80).nullable().optional().or(z.literal("")),
  source: z.enum(["WEBSITE", "REFERRAL", "SOCIAL", "CAMPAIGN", "DIRECT", "OTHER"]).nullable().optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  ownerId: z.string().nullable().optional().or(z.literal("")),
  estimatedValue: z.number().min(0).max(1e12).nullable().optional(),
  lastContactedAt: z.string().datetime().nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(5000).nullable().optional().or(z.literal("")),
  disqualificationReason: z.string().max(500).nullable().optional().or(z.literal("")),
  archived: z.boolean().optional(),
  tags: z.array(z.string()).max(20).optional(),
});

export const PATCH = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, updateSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  const existing = await db.lead.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) return fail(404, "NOT_FOUND", "Lead not found.");

  await assertUserInWorkspace(body.ownerId || null, ctx.workspaceId);

  const previousStatus = existing.status;
  const previousOwner = existing.ownerId;

  const lead = await db.lead.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.email !== undefined ? { email: body.email || null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
      ...(body.companyName !== undefined ? { companyName: body.companyName || null } : {}),
      ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle || null } : {}),
      ...(body.source !== undefined ? { source: body.source } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.ownerId !== undefined ? { ownerId: body.ownerId || null } : {}),
      ...(body.estimatedValue !== undefined ? { estimatedValue: body.estimatedValue } : {}),
      ...(body.lastContactedAt !== undefined
        ? { lastContactedAt: body.lastContactedAt ? new Date(body.lastContactedAt) : null }
        : {}),
      ...(body.nextFollowUpAt !== undefined
        ? { nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null }
        : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.disqualificationReason !== undefined
        ? { disqualificationReason: body.disqualificationReason || null }
        : {}),
      ...(body.archived !== undefined ? { archived: body.archived } : {}),
    },
  });

  if (body.tags !== undefined) {
    await syncTags(ctx.workspaceId, "lead", lead.id, body.tags, []);
  }
  if (body.ownerId !== undefined && body.ownerId && body.ownerId !== previousOwner) {
    await runAutomations({
      workspaceId: ctx.workspaceId,
      trigger: "RECORD_ASSIGNED",
      entityType: "lead",
      entity: { ...lead, title: lead.name },
      actorId: ctx.user.id,
    });
  }
  if (body.status !== undefined && body.status !== previousStatus) {
    await runAutomations({
      workspaceId: ctx.workspaceId,
      trigger: "STATUS_ENTERED",
      entityType: "lead",
      entity: { ...lead, title: lead.name },
      actorId: ctx.user.id,
    });
  }
  if (body.archived === true) {
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "ARCHIVE", entityType: "lead", entityId: id });
  } else if (body.archived === false) {
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "RESTORE", entityType: "lead", entityId: id });
  } else {
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "UPDATE", entityType: "lead", entityId: id });
  }

  return ok(lead);
});

// ---- Delete (hard delete allowed for leads; prefer archive) ----
export const DELETE = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireWorkspace(req);
  const existing = await db.lead.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) return fail(404, "NOT_FOUND", "Lead not found.");
  await db.lead.delete({ where: { id } });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "DELETE", entityType: "lead", entityId: id });
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
