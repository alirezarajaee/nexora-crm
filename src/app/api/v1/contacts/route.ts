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

// ================= LIST =================
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const sp = urlToFilters(req);
  const { page, pageSize, skip, sort, dir } = getListParams(sp);
  const q = sp.get("q")?.trim();
  const companyIds = csvParam(sp, "companyId");
  const ownerIds = csvParam(sp, "ownerId");
  const archived = boolParam(sp, "archived", false);
  const followUpDue = boolParam(sp, "followUpDue", false);
  const { tagNames } = listTagsParam(sp);

  let tagFilteredIds: string[] | null = null;
  if (tagNames.length > 0) {
    const rels = await db.tagRelation.findMany({
      where: { workspaceId: ctx.workspaceId, entityType: "contact", tag: { name: { in: tagNames } } },
      select: { entityId: true },
    });
    tagFilteredIds = [...new Set(rels.map((r) => r.entityId))];
    if (tagFilteredIds.length === 0) return ok(paginated([], 0, page, pageSize));
  }

  const where: Prisma.ContactWhereInput = {
    workspaceId: ctx.workspaceId,
    archived,
    ...(companyIds.length ? { companyId: { in: companyIds } } : {}),
    ...(ownerIds.length ? { ownerId: { in: ownerIds } } : {}),
    ...(followUpDue ? { nextFollowUpAt: { lte: new Date() } } : {}),
    ...(tagFilteredIds ? { id: { in: tagFilteredIds } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { email: { contains: q } },
            { phone: { contains: q } },
            { jobTitle: { contains: q } },
            { company: { name: { contains: q } } },
          ],
        }
      : {}),
  };

  const sortFields = ["name", "createdAt", "nextFollowUpAt", "updatedAt"] as const;
  const sortField = sort && (sortFields as readonly string[]).includes(sort) ? sort : "createdAt";

  const [items, total] = await Promise.all([
    db.contact.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: [{ [sortField]: dir }],
      skip,
      take: pageSize,
    }),
    db.contact.count({ where }),
  ]);

  const withTags = await attachTags(ctx.workspaceId, "contact", items);
  return ok(paginated(withTags, total, page, pageSize));
});

// ================= CREATE =================
const createSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120),
  email: z.string().email().max(160).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  jobTitle: z.string().max(80).optional().or(z.literal("")),
  companyId: z.string().optional().or(z.literal("")),
  ownerId: z.string().optional().or(z.literal("")),
  notes: z.string().max(5000).optional().or(z.literal("")),
  lastContactedAt: z.string().datetime().nullable().optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
  tags: z.array(z.string()).max(20).optional(),
  customFields: z.record(z.string(), z.string().nullable()).optional(),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, createSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  if (body.companyId) {
    const company = await db.company.findFirst({ where: { id: body.companyId, workspaceId: ctx.workspaceId } });
    if (!company) return fail(404, "NOT_FOUND", "Company not found.");
  }
  await assertUserInWorkspace(body.ownerId || null, ctx.workspaceId);

  if (body.email) {
    const dup = await db.contact.findFirst({
      where: { workspaceId: ctx.workspaceId, email: body.email, archived: false },
      select: { id: true },
    });
    if (dup) return fail(409, "DUPLICATE", "A contact with this email already exists.");
  }

  const contact = await db.contact.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: body.name.trim(),
      email: body.email || null,
      phone: body.phone || null,
      jobTitle: body.jobTitle || null,
      companyId: body.companyId || null,
      ownerId: body.ownerId || ctx.user.id,
      notes: body.notes || null,
      lastContactedAt: body.lastContactedAt ? new Date(body.lastContactedAt) : null,
      nextFollowUpAt: body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null,
    },
  });

  if (body.tags?.length) {
    const { syncTags } = await import("@/lib/server/tags");
    await syncTags(ctx.workspaceId, "contact", contact.id, body.tags, []);
  }
  if (body.customFields) {
    const { saveCustomFieldValues } = await import("@/lib/server/custom-fields");
    await saveCustomFieldValues(ctx.workspaceId, "contact", contact.id, body.customFields);
  }

  await createActivity({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    type: "SYSTEM",
    title: "CONTACT_CREATED",
    contactId: contact.id,
    metadata: { name: contact.name },
  });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "CREATE", entityType: "contact", entityId: contact.id });

  return ok(contact, 201);
});

export const dynamic = "force-dynamic";
