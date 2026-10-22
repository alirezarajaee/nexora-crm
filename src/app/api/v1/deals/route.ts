import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  assertRefsInWorkspace,
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
import { attachTags } from "@/lib/server/tags";
import { createActivity, audit } from "@/lib/server/activity";
import { runAutomations } from "@/lib/server/automation";

// ================= LIST =================
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const sp = urlToFilters(req);
  const { page, pageSize, skip, sort, dir } = getListParams(sp, 50);
  const q = sp.get("q")?.trim();
  const pipelineId = sp.get("pipelineId") || undefined;
  const stageIds = csvParam(sp, "stageId");
  const ownerIds = csvParam(sp, "ownerId");
  const priorities = csvParam(sp, "priority");
  const contactId = sp.get("contactId") || undefined;
  const companyId = sp.get("companyId") || undefined;
  const archived = boolParam(sp, "archived", false);

  const where: Prisma.DealWhereInput = {
    workspaceId: ctx.workspaceId,
    archived,
    ...(pipelineId ? { pipelineId } : {}),
    ...(stageIds.length ? { stageId: { in: stageIds } } : {}),
    ...(ownerIds.length ? { ownerId: { in: ownerIds } } : {}),
    ...(priorities.length ? { priority: { in: priorities } } : {}),
    ...(contactId ? { contactId } : {}),
    ...(companyId ? { companyId } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q } },
            { description: { contains: q } },
            { contact: { name: { contains: q } } },
            { company: { name: { contains: q } } },
          ],
        }
      : {}),
  };

  const sortFields = ["title", "value", "createdAt", "expectedCloseDate", "lastActivityAt"] as const;
  const sortField = sort && (sortFields as readonly string[]).includes(sort) ? sort : "createdAt";

  const [items, total] = await Promise.all([
    db.deal.findMany({
      where,
      include: {
        stage: true,
        owner: { select: { id: true, name: true, email: true } },
        contact: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: [{ [sortField]: dir }],
      skip,
      take: pageSize,
    }),
    db.deal.count({ where }),
  ]);

  const withTags = await attachTags(ctx.workspaceId, "deal", items);
  return ok(paginated(withTags, total, page, pageSize));
});

// ================= CREATE =================
const createSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1).max(120),
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  contactId: z.string().optional().or(z.literal("")),
  companyId: z.string().optional().or(z.literal("")),
  value: z.number().min(0).max(1e12).default(0),
  currency: z.string().min(3).max(6).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  ownerId: z.string().optional().or(z.literal("")),
  expectedCloseDate: z.string().datetime().nullable().optional(),
  source: z.string().max(40).optional().or(z.literal("")),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  description: z.string().max(5000).optional().or(z.literal("")),
  tags: z.array(z.string()).max(20).optional(),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, createSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  // Resolve pipeline: explicit → default → first
  const pipeline = body.pipelineId
    ? await db.pipeline.findFirst({ where: { id: body.pipelineId, workspaceId: ctx.workspaceId } })
    : (await db.pipeline.findFirst({ where: { workspaceId: ctx.workspaceId, isDefault: true } })) ??
      (await db.pipeline.findFirst({ where: { workspaceId: ctx.workspaceId } }));
  if (!pipeline) return fail(400, "BAD_REQUEST", "No pipeline available.");

  // Resolve stage: explicit → first OPEN stage of pipeline
  const stages = await db.stage.findMany({ where: { pipelineId: pipeline.id }, orderBy: { order: "asc" } });
  const stage = body.stageId
    ? stages.find((s) => s.id === body.stageId)
    : stages.find((s) => s.type === "OPEN") ?? stages[0];
  if (!stage) return fail(400, "BAD_REQUEST", "No stage available.");

  if (body.contactId || body.companyId) {
    await assertRefsInWorkspace(
      [
        ["contact", body.contactId || null],
        ["company", body.companyId || null],
      ],
      ctx.workspaceId
    );
  }
  await assertUserInWorkspace(body.ownerId || null, ctx.workspaceId);

  const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });

  const deal = await db.deal.create({
    data: {
      workspaceId: ctx.workspaceId,
      pipelineId: pipeline.id,
      stageId: stage.id,
      title: body.title.trim(),
      contactId: body.contactId || null,
      companyId: body.companyId || null,
      value: body.value,
      currency: body.currency ?? ws.currency,
      probability: body.probability ?? stage.probability,
      ownerId: body.ownerId || ctx.user.id,
      expectedCloseDate: body.expectedCloseDate ? new Date(body.expectedCloseDate) : null,
      source: body.source || null,
      priority: body.priority ?? "MEDIUM",
      description: body.description || null,
    },
    include: { stage: true },
  });

  if (body.tags?.length) {
    const { syncTags } = await import("@/lib/server/tags");
    await syncTags(ctx.workspaceId, "deal", deal.id, body.tags, []);
  }

  await createActivity({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    type: "SYSTEM",
    title: "DEAL_CREATED",
    dealId: deal.id,
    metadata: { title: deal.title, stage: stage.name },
  });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "CREATE", entityType: "deal", entityId: deal.id });

  await runAutomations({
    workspaceId: ctx.workspaceId,
    trigger: "DEAL_CREATED",
    entityType: "deal",
    entity: { ...deal, title: deal.title },
    actorId: ctx.user.id,
  });

  return ok(deal, 201);
});

export const dynamic = "force-dynamic";
