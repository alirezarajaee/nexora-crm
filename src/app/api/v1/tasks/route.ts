import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  assertRefsInWorkspace,
  assertUserInWorkspace,
  boolParam,
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
import { createActivity, audit, notify } from "@/lib/server/activity";

// ================= LIST =================
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const sp = urlToFilters(req);
  const { page, pageSize, skip, sort, dir } = getListParams(sp, 50);
  const q = sp.get("q")?.trim();
  const statuses = csvParam(sp, "status");
  const priorities = csvParam(sp, "priority");
  const assignees = csvParam(sp, "assigneeId");
  const overdue = boolParam(sp, "overdue", false);
  const dueFrom = dateParam(sp, "dueFrom");
  const dueTo = dateParam(sp, "dueTo");
  const contactId = sp.get("contactId") || undefined;
  const companyId = sp.get("companyId") || undefined;
  const dealId = sp.get("dealId") || undefined;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const where: Prisma.TaskWhereInput = {
    workspaceId: ctx.workspaceId,
    ...(statuses.length ? { status: { in: statuses } } : {}),
    ...(priorities.length ? { priority: { in: priorities } } : {}),
    ...(assignees.length ? { assigneeId: { in: assignees } } : {}),
    ...(overdue ? { status: "OPEN", dueAt: { lt: todayStart } } : {}),
    ...(dueFrom || dueTo ? { dueAt: { ...(dueFrom ? { gte: dueFrom } : {}), ...(dueTo ? { lte: dueTo } : {}) } } : {}),
    ...(contactId ? { contactId } : {}),
    ...(companyId ? { companyId } : {}),
    ...(dealId ? { dealId } : {}),
    ...(q ? { OR: [{ title: { contains: q } }, { description: { contains: q } }] } : {}),
  };

  const sortFields = ["title", "createdAt", "dueAt", "priority"] as const;
  const sortField = sort && (sortFields as readonly string[]).includes(sort) ? sort : "dueAt";

  const [items, total] = await Promise.all([
    db.task.findMany({
      where,
      include: {
        assignee: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
        company: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        lead: { select: { id: true, name: true } },
      },
      orderBy: sortField === "priority" ? [{ priority: dir }, { dueAt: "asc" }] : [{ [sortField]: dir }],
      skip,
      take: pageSize,
    }),
    db.task.count({ where }),
  ]);
  return ok(paginated(items, total, page, pageSize));
});

// ================= CREATE =================
const createSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1).max(160),
  description: z.string().max(5000).optional().or(z.literal("")),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assigneeId: z.string().optional().or(z.literal("")),
  contactId: z.string().optional().or(z.literal("")),
  companyId: z.string().optional().or(z.literal("")),
  dealId: z.string().optional().or(z.literal("")),
  leadId: z.string().optional().or(z.literal("")),
  recurrence: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]).optional(),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, createSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  // Cross-workspace authorization: linked records and assignee must belong
  // to the caller's workspace.
  await assertRefsInWorkspace(
    [
      ["contact", body.contactId || null],
      ["company", body.companyId || null],
      ["deal", body.dealId || null],
      ["lead", body.leadId || null],
    ],
    ctx.workspaceId
  );
  await assertUserInWorkspace(body.assigneeId || null, ctx.workspaceId);

  const task = await db.task.create({
    data: {
      workspaceId: ctx.workspaceId,
      title: body.title.trim(),
      description: body.description || null,
      priority: body.priority ?? "MEDIUM",
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
      assigneeId: body.assigneeId || ctx.user.id,
      contactId: body.contactId || null,
      companyId: body.companyId || null,
      dealId: body.dealId || null,
      leadId: body.leadId || null,
      recurrence: body.recurrence && body.recurrence !== "NONE" ? body.recurrence : null,
    },
  });

  if (task.assigneeId && task.assigneeId !== ctx.user.id) {
    await notify({
      workspaceId: ctx.workspaceId,
      userId: task.assigneeId,
      type: "ASSIGNMENT",
      title: task.title,
      body: "TASK_ASSIGNED",
      link: `tasks?taskId=${task.id}`,
    });
  }
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "CREATE", entityType: "task", entityId: task.id });
  return ok(task, 201);
});

export const dynamic = "force-dynamic";
