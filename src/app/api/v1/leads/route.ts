import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  assertUserInWorkspace,
  boolParam,
  csvParam,
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
import { attachTags, listTagsParam } from "@/lib/server/tags";
import { createActivity, audit } from "@/lib/server/activity";
import { runAutomations } from "@/lib/server/automation";

// ================= LIST =================
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const sp = urlToFilters(req);
  const { page, pageSize, skip, sort, dir } = getListParams(sp);
  const q = sp.get("q")?.trim();
  const statuses = csvParam(sp, "status");
  const sources = csvParam(sp, "source");
  const priorities = csvParam(sp, "priority");
  const ownerIds = csvParam(sp, "ownerId");
  const archived = boolParam(sp, "archived", false);
  const dueFollowUps = boolParam(sp, "dueFollowUps", false);
  const { tagNames } = listTagsParam(sp);

  const where: Prisma.LeadWhereInput = {
    workspaceId: ctx.workspaceId,
    archived,
    ...(statuses.length ? { status: { in: statuses } } : {}),
    ...(sources.length ? { source: { in: sources } } : {}),
    ...(priorities.length ? { priority: { in: priorities } } : {}),
    ...(ownerIds.length ? { ownerId: { in: ownerIds } } : {}),
    ...(dueFollowUps ? { nextFollowUpAt: { lte: new Date() } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
            { companyName: { contains: q } },
            { phone: { contains: q } },
            { notes: { contains: q } },
          ],
        }
      : {}),
  };

  const sortFields = ["name", "createdAt", "nextFollowUpAt", "estimatedValue", "lastActivityAt", "updatedAt", "priority"] as const;
  const sortField = sort && (sortFields as readonly string[]).includes(sort) ? sort : "createdAt";

  // Tag filter via relation query (SQLite-safe two-step)
  let tagFilteredIds: string[] | null = null;
  if (tagNames.length > 0) {
    const rels = await db.tagRelation.findMany({
      where: { workspaceId: ctx.workspaceId, entityType: "lead", tag: { name: { in: tagNames } } },
      select: { entityId: true },
    });
    tagFilteredIds = [...new Set(rels.map((r) => r.entityId))];
    if (tagFilteredIds.length === 0) {
      return ok(paginated([], 0, page, pageSize));
    }
  }

  const [items, total] = await Promise.all([
    db.lead.findMany({
      where: { ...where, ...(tagFilteredIds ? { id: { in: tagFilteredIds } } : {}) },
      include: { owner: { select: { id: true, name: true, email: true } } },
      orderBy: sortField === "priority" ? [{ priority: dir }, { createdAt: "desc" }] : [{ [sortField]: dir }],
      skip,
      take: pageSize,
    }),
    db.lead.count({ where: { ...where, ...(tagFilteredIds ? { id: { in: tagFilteredIds } } : {}) } }),
  ]);

  const withTags = await attachTags(ctx.workspaceId, "lead", items);
  return ok(paginated(withTags, total, page, pageSize));
});

// ================= CREATE =================
const createSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120),
  email: z.string().email().max(160).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  companyName: z.string().max(120).optional().or(z.literal("")),
  jobTitle: z.string().max(80).optional().or(z.literal("")),
  source: z.enum(["WEBSITE", "REFERRAL", "SOCIAL", "CAMPAIGN", "DIRECT", "OTHER"]).optional(),
  status: z.enum(["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  ownerId: z.string().optional().or(z.literal("")),
  estimatedValue: z.number().min(0).max(1e12).nullable().optional(),
  lastContactedAt: z.string().datetime().nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  notes: z.string().max(5000).optional().or(z.literal("")),
  tags: z.array(z.string()).max(20).optional(),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, createSchema);
  const { workspaceId } = body;
  const ctx = await requireWorkspaceFromBody(req, workspaceId);

  await assertUserInWorkspace(body.ownerId || null, workspaceId);

  if (body.email) {
    const dup = await db.lead.findFirst({
      where: { workspaceId, email: body.email, archived: false },
      select: { id: true },
    });
    if (dup) {
      return fail(409, "DUPLICATE", "A lead with this email already exists.");
    }
  }

  const lead = await db.lead.create({
    data: {
      workspaceId,
      name: body.name.trim(),
      email: body.email || null,
      phone: body.phone || null,
      companyName: body.companyName || null,
      jobTitle: body.jobTitle || null,
      source: body.source,
      status: body.status ?? "NEW",
      priority: body.priority ?? "MEDIUM",
      ownerId: body.ownerId || ctx.user.id,
      estimatedValue: body.estimatedValue ?? null,
      lastContactedAt: body.lastContactedAt ? new Date(body.lastContactedAt) : null,
      nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null,
      notes: body.notes || null,
    },
  });

  if (body.tags?.length) {
    const { syncTags } = await import("@/lib/server/tags");
    await syncTags(workspaceId, "lead", lead.id, body.tags, []);
  }

  await createActivity({
    workspaceId,
    userId: ctx.user.id,
    type: "SYSTEM",
    title: "LEAD_CREATED",
    leadId: lead.id,
    metadata: { name: lead.name },
  });
  await audit({ workspaceId, userId: ctx.user.id, action: "CREATE", entityType: "lead", entityId: lead.id });

  await runAutomations({
    workspaceId,
    trigger: "LEAD_CREATED",
    entityType: "lead",
    entity: { ...lead, title: lead.name },
    actorId: ctx.user.id,
  });

  return ok(lead, 201);
});

export const dynamic = "force-dynamic";
