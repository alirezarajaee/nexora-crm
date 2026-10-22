import { z } from "zod";
import { db } from "@/lib/db";
import {
  csvParam,
  dateParam,
  fail,
  handler,
  getListParams,
  ok,
  paginated,
  parseBody,
  requireWorkspace,
  requireWorkspaceFromBody,
  urlToFilters,
} from "@/lib/server/api";
import { createActivity, audit } from "@/lib/server/activity";

// ================= LIST =================
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const sp = urlToFilters(req);
  const { page, pageSize, skip } = getListParams(sp, 30);
  const types = csvParam(sp, "type");
  const userIds = csvParam(sp, "userId");
  const contactId = sp.get("contactId") || undefined;
  const companyId = sp.get("companyId") || undefined;
  const dealId = sp.get("dealId") || undefined;
  const leadId = sp.get("leadId") || undefined;
  const from = dateParam(sp, "from");
  const to = dateParam(sp, "to");

  const where = {
    workspaceId: ctx.workspaceId,
    ...(types.length ? { type: { in: types } } : {}),
    ...(userIds.length ? { userId: { in: userIds } } : {}),
    ...(contactId ? { contactId } : {}),
    ...(companyId ? { companyId } : {}),
    ...(dealId ? { dealId } : {}),
    ...(leadId ? { leadId } : {}),
    ...(from || to
      ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
      : {}),
  };

  const [items, total] = await Promise.all([
    db.activity.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        lead: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: pageSize,
    }),
    db.activity.count({ where }),
  ]);

  return ok(paginated(items, total, page, pageSize));
});

// ================= LOG ACTIVITY (call/meeting/email/note) =================
const createSchema = z.object({
  workspaceId: z.string().min(1),
  type: z.enum(["CALL", "MEETING", "EMAIL", "NOTE"]),
  title: z.string().min(1).max(160),
  content: z.string().max(5000).optional().or(z.literal("")),
  contactId: z.string().optional().or(z.literal("")),
  companyId: z.string().optional().or(z.literal("")),
  dealId: z.string().optional().or(z.literal("")),
  leadId: z.string().optional().or(z.literal("")),
  occurredAt: z.string().datetime().optional(),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, createSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  // Validate links belong to workspace
  for (const [field, model] of [
    ["contactId", db.contact],
    ["companyId", db.company],
    ["dealId", db.deal],
    ["leadId", db.lead],
  ] as const) {
    const value = body[field];
    if (value) {
      const found = await (model as any).findFirst({ where: { id: value, workspaceId: ctx.workspaceId } });
      if (!found) return fail(404, "NOT_FOUND", "Related record not found.");
    }
  }

  const activity = await createActivity({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    type: body.type,
    title: body.title.trim(),
    content: body.content || null,
    contactId: body.contactId || null,
    companyId: body.companyId || null,
    dealId: body.dealId || null,
    leadId: body.leadId || null,
    metadata: body.occurredAt ? { occurredAt: body.occurredAt } : null,
  });

  // Maintain last-contact signals for Radar
  const when = body.occurredAt ? new Date(body.occurredAt) : new Date();
  if (body.contactId) {
    await db.contact.update({
      where: { id: body.contactId },
      data: { lastContactedAt: when },
    }).catch(() => {});
  }
  if (body.leadId) {
    await db.lead.update({
      where: { id: body.leadId },
      data: { lastActivityAt: when, lastContactedAt: body.type === "CALL" ? when : undefined },
    }).catch(() => {});
  }
  if (body.dealId) {
    await db.deal.update({
      where: { id: body.dealId },
      data: { lastActivityAt: when },
    }).catch(() => {});
  }

  await audit({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    action: "CREATE",
    entityType: "activity",
    entityId: activity.id,
    detail: { type: body.type },
  });

  return ok(activity, 201);
});

export const dynamic = "force-dynamic";
