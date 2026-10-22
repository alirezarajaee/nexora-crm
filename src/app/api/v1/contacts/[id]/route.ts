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
import { attachTags, attachCustomFields, syncTags } from "@/lib/server/tags";
import { createActivity, audit } from "@/lib/server/activity";

type Params = { params: Promise<{ id: string }> };

// ---- Detail with related data ----
export const GET = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireWorkspace(req);
  const contact = await db.contact.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      company: { select: { id: true, name: true } },
    },
  });
  if (!contact) return fail(404, "NOT_FOUND", "Contact not found.");

  const [deals, tasks, activities, company] = await Promise.all([
    db.deal.findMany({
      where: { workspaceId: ctx.workspaceId, contactId: id, archived: false },
      include: { stage: true, owner: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.task.findMany({
      where: { workspaceId: ctx.workspaceId, contactId: id },
      include: { assignee: { select: { id: true, name: true } } },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      take: 50,
    }),
    db.activity.findMany({
      where: { workspaceId: ctx.workspaceId, contactId: id },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    contact.companyId
      ? db.company.findFirst({ where: { id: contact.companyId, workspaceId: ctx.workspaceId } })
      : null,
  ]);

  const [withTags] = await attachTags(ctx.workspaceId, "contact", [contact]);
  const [withCustom] = await attachCustomFields(ctx.workspaceId, "contact", [withTags]);

  return ok({
    ...withCustom,
    company,
    deals,
    tasks,
    activities,
  });
});

// ---- Update ----
const updateSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  email: z.string().email().max(160).nullable().optional().or(z.literal("")),
  phone: z.string().max(40).nullable().optional().or(z.literal("")),
  jobTitle: z.string().max(80).nullable().optional().or(z.literal("")),
  companyId: z.string().nullable().optional().or(z.literal("")),
  ownerId: z.string().nullable().optional().or(z.literal("")),
  notes: z.string().max(5000).nullable().optional().or(z.literal("")),
  lastContactedAt: z.string().datetime().nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  archived: z.boolean().optional(),
  tags: z.array(z.string()).max(20).optional(),
  customFields: z.record(z.string(), z.string().nullable()).optional(),
});

export const PATCH = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, updateSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  const existing = await db.contact.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) return fail(404, "NOT_FOUND", "Contact not found.");

  if (body.companyId) {
    const company = await db.company.findFirst({ where: { id: body.companyId, workspaceId: ctx.workspaceId } });
    if (!company) return fail(404, "NOT_FOUND", "Company not found.");
  }
  await assertUserInWorkspace(body.ownerId || null, ctx.workspaceId);

  const contact = await db.contact.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.email !== undefined ? { email: body.email || null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
      ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle || null } : {}),
      ...(body.companyId !== undefined ? { companyId: body.companyId || null } : {}),
      ...(body.ownerId !== undefined ? { ownerId: body.ownerId || null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.lastContactedAt !== undefined
        ? { lastContactedAt: body.lastContactedAt ? new Date(body.lastContactedAt) : null }
        : {}),
      ...(body.nextFollowUpAt !== undefined
        ? { nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null }
        : {}),
      ...(body.archived !== undefined ? { archived: body.archived } : {}),
    },
  });

  if (body.tags !== undefined) await syncTags(ctx.workspaceId, "contact", id, body.tags, []);
  if (body.customFields) {
    const { saveCustomFieldValues } = await import("@/lib/server/custom-fields");
    await saveCustomFieldValues(ctx.workspaceId, "contact", id, body.customFields);
  }

  await audit({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    action: body.archived === true ? "ARCHIVE" : body.archived === false ? "RESTORE" : "UPDATE",
    entityType: "contact",
    entityId: id,
  });

  return ok(contact);
});

// ---- Delete ----
export const DELETE = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireWorkspace(req);
  const existing = await db.contact.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) return fail(404, "NOT_FOUND", "Contact not found.");
  await db.contact.delete({ where: { id } });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "DELETE", entityType: "contact", entityId: id });
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
