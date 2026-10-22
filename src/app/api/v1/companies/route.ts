import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  assertUserInWorkspace,
  boolParam,
  csvParam,
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
import { audit } from "@/lib/server/activity";

// ================= LIST =================
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const sp = urlToFilters(req);
  const { page, pageSize, skip, sort, dir } = getListParams(sp);
  const q = sp.get("q")?.trim();
  const ownerIds = csvParam(sp, "ownerId");
  const industries = csvParam(sp, "industry");
  const archived = boolParam(sp, "archived", false);
  const { tagNames } = listTagsParam(sp);

  let tagFilteredIds: string[] | null = null;
  if (tagNames.length > 0) {
    const rels = await db.tagRelation.findMany({
      where: { workspaceId: ctx.workspaceId, entityType: "company", tag: { name: { in: tagNames } } },
      select: { entityId: true },
    });
    tagFilteredIds = [...new Set(rels.map((r) => r.entityId))];
    if (tagFilteredIds.length === 0) return ok(paginated([], 0, page, pageSize));
  }

  const where: Prisma.CompanyWhereInput = {
    workspaceId: ctx.workspaceId,
    archived,
    ...(ownerIds.length ? { ownerId: { in: ownerIds } } : {}),
    ...(industries.length ? { industry: { in: industries } } : {}),
    ...(tagFilteredIds ? { id: { in: tagFilteredIds } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            { website: { contains: q } },
            { industry: { contains: q } },
            { country: { contains: q } },
          ],
        }
      : {}),
  };

  const sortFields = ["name", "createdAt", "updatedAt"] as const;
  const sortField = sort && (sortFields as readonly string[]).includes(sort) ? sort : "createdAt";

  const [items, total] = await Promise.all([
    db.company.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        _count: { select: { contacts: true, deals: true, tasks: true } },
      },
      orderBy: [{ [sortField]: dir }],
      skip,
      take: pageSize,
    }),
    db.company.count({ where }),
  ]);

  const withTags = await attachTags(ctx.workspaceId, "company", items);
  return ok(paginated(withTags, total, page, pageSize));
});

// ================= CREATE =================
const createSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(120),
  website: z.string().max(300).optional().or(z.literal("")),
  industry: z.string().max(80).optional().or(z.literal("")),
  size: z.string().max(40).optional().or(z.literal("")),
  phone: z.string().max(40).optional().or(z.literal("")),
  address: z.string().max(300).optional().or(z.literal("")),
  country: z.string().max(80).optional().or(z.literal("")),
  ownerId: z.string().optional().or(z.literal("")),
  source: z.string().max(40).optional().or(z.literal("")),
  notes: z.string().max(5000).optional().or(z.literal("")),
  tags: z.array(z.string()).max(20).optional(),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, createSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  const dup = await db.company.findFirst({
    where: { workspaceId: ctx.workspaceId, name: body.name.trim(), archived: false },
    select: { id: true },
  });
  if (dup) return ok({ ...dup, duplicateWarning: true }, 200);

  await assertUserInWorkspace(body.ownerId || null, ctx.workspaceId);

  const company = await db.company.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: body.name.trim(),
      website: body.website || null,
      industry: body.industry || null,
      size: body.size || null,
      phone: body.phone || null,
      address: body.address || null,
      country: body.country || null,
      ownerId: body.ownerId || ctx.user.id,
      source: body.source || null,
      notes: body.notes || null,
    },
  });

  if (body.tags?.length) {
    const { syncTags } = await import("@/lib/server/tags");
    await syncTags(ctx.workspaceId, "company", company.id, body.tags, []);
  }

  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "CREATE", entityType: "company", entityId: company.id });
  return ok(company, 201);
});

export const dynamic = "force-dynamic";
