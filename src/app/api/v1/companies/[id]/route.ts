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
import { audit } from "@/lib/server/activity";

type Params = { params: Promise<{ id: string }> };

// ---- Detail ----
export const GET = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireWorkspace(req);
  const company = await db.company.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: { owner: { select: { id: true, name: true, email: true } } },
  });
  if (!company) return fail(404, "NOT_FOUND", "Company not found.");

  const [contacts, deals, tasks, activities] = await Promise.all([
    db.contact.findMany({
      where: { workspaceId: ctx.workspaceId, companyId: id, archived: false },
      orderBy: { createdAt: "asc" },
      take: 100,
    }),
    db.deal.findMany({
      where: { workspaceId: ctx.workspaceId, companyId: id, archived: false },
      include: { stage: true, owner: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.task.findMany({
      where: { workspaceId: ctx.workspaceId, companyId: id },
      include: { assignee: { select: { id: true, name: true } } },
      orderBy: [{ status: "asc" }, { dueAt: "asc" }],
      take: 50,
    }),
    db.activity.findMany({
      where: { workspaceId: ctx.workspaceId, companyId: id },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  ]);

  const [withTags] = await attachTags(ctx.workspaceId, "company", [company]);
  const [withCustom] = await attachCustomFields(ctx.workspaceId, "company", [withTags]);
  return ok({ ...withCustom, contacts, deals, tasks, activities });
});

// ---- Update ----
const updateSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120).optional(),
  website: z.string().max(300).nullable().optional().or(z.literal("")),
  industry: z.string().max(80).nullable().optional().or(z.literal("")),
  size: z.string().max(40).nullable().optional().or(z.literal("")),
  phone: z.string().max(40).nullable().optional().or(z.literal("")),
  address: z.string().max(300).nullable().optional().or(z.literal("")),
  country: z.string().max(80).nullable().optional().or(z.literal("")),
  ownerId: z.string().nullable().optional().or(z.literal("")),
  source: z.string().max(40).nullable().optional().or(z.literal("")),
  notes: z.string().max(5000).nullable().optional().or(z.literal("")),
  archived: z.boolean().optional(),
  tags: z.array(z.string()).max(20).optional(),
});

export const PATCH = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, updateSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);
  const existing = await db.company.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) return fail(404, "NOT_FOUND", "Company not found.");

  await assertUserInWorkspace(body.ownerId || null, ctx.workspaceId);

  const company = await db.company.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.website !== undefined ? { website: body.website || null } : {}),
      ...(body.industry !== undefined ? { industry: body.industry || null } : {}),
      ...(body.size !== undefined ? { size: body.size || null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
      ...(body.address !== undefined ? { address: body.address || null } : {}),
      ...(body.country !== undefined ? { country: body.country || null } : {}),
      ...(body.ownerId !== undefined ? { ownerId: body.ownerId || null } : {}),
      ...(body.source !== undefined ? { source: body.source || null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.archived !== undefined ? { archived: body.archived } : {}),
    },
  });

  if (body.tags !== undefined) await syncTags(ctx.workspaceId, "company", id, body.tags, []);
  await audit({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    action: body.archived === true ? "ARCHIVE" : body.archived === false ? "RESTORE" : "UPDATE",
    entityType: "company",
    entityId: id,
  });
  return ok(company);
});

// ---- Delete ----
export const DELETE = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireWorkspace(req);
  const existing = await db.company.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) return fail(404, "NOT_FOUND", "Company not found.");
  await db.company.delete({ where: { id } });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "DELETE", entityType: "company", entityId: id });
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
