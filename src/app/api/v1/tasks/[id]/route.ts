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
import { createActivity, audit, notify } from "@/lib/server/activity";

type Params = { params: Promise<{ id: string }> };

// ---- Detail ----
export const GET = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireWorkspace(req);
  const task = await db.task.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    include: {
      assignee: { select: { id: true, name: true } },
      contact: { select: { id: true, name: true } },
      company: { select: { id: true, name: true } },
      deal: { select: { id: true, title: true } },
      lead: { select: { id: true, name: true } },
    },
  });
  if (!task) return fail(404, "NOT_FOUND", "Task not found.");
  return ok(task);
});

// ---- Update / complete / reopen ----
const updateSchema = z.object({
  workspaceId: z.string().min(1),
  title: z.string().min(1).max(160).optional(),
  description: z.string().max(5000).nullable().optional().or(z.literal("")),
  status: z.enum(["OPEN", "DONE"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  assigneeId: z.string().nullable().optional().or(z.literal("")),
  contactId: z.string().nullable().optional().or(z.literal("")),
  companyId: z.string().nullable().optional().or(z.literal("")),
  dealId: z.string().nullable().optional().or(z.literal("")),
  leadId: z.string().nullable().optional().or(z.literal("")),
  recurrence: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY"]).nullable().optional(),
});

function nextRecurrenceDate(from: Date, recurrence: string): Date | null {
  const d = new Date(from);
  switch (recurrence) {
    case "DAILY":
      d.setDate(d.getDate() + 1);
      return d;
    case "WEEKLY":
      d.setDate(d.getDate() + 7);
      return d;
    case "MONTHLY":
      d.setMonth(d.getMonth() + 1);
      return d;
    default:
      return null;
  }
}

export const PATCH = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, updateSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  const existing = await db.task.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) return fail(404, "NOT_FOUND", "Task not found.");

  // Cross-workspace authorization: linked records and assignee must belong
  // to the caller's workspace (empty string / null means "unlink").
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

  const now = new Date();
  const becomingDone = body.status === "DONE" && existing.status !== "DONE";
  const reopening = body.status === "OPEN" && existing.status !== "OPEN";

  const task = await db.task.update({
    where: { id },
    data: {
      ...(body.title !== undefined ? { title: body.title.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description || null } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.dueAt !== undefined ? { dueAt: body.dueAt ? new Date(body.dueAt) : null } : {}),
      ...(body.assigneeId !== undefined ? { assigneeId: body.assigneeId || null } : {}),
      ...(body.contactId !== undefined ? { contactId: body.contactId || null } : {}),
      ...(body.companyId !== undefined ? { companyId: body.companyId || null } : {}),
      ...(body.dealId !== undefined ? { dealId: body.dealId || null } : {}),
      ...(body.leadId !== undefined ? { leadId: body.leadId || null } : {}),
      ...(body.recurrence !== undefined ? { recurrence: body.recurrence === "NONE" ? null : body.recurrence } : {}),
      ...(becomingDone ? { completedAt: now } : {}),
      ...(reopening ? { completedAt: null } : {}),
    },
  });

  if (becomingDone) {
    await createActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      type: "TASK_EVENT",
      title: "TASK_COMPLETED",
      content: task.title,
      contactId: task.contactId,
      companyId: task.companyId,
      dealId: task.dealId,
      leadId: task.leadId,
      metadata: { taskId: task.id },
    });

    // Recurring tasks: spawn the next occurrence on completion
    if (task.recurrence && task.recurrence !== "NONE") {
      const nextDue = task.dueAt ? nextRecurrenceDate(task.dueAt, task.recurrence) : nextRecurrenceDate(now, task.recurrence);
      if (nextDue) {
        await db.task.create({
          data: {
            workspaceId: ctx.workspaceId,
            title: task.title,
            description: task.description,
            priority: task.priority as "LOW" | "MEDIUM" | "HIGH",
            dueAt: nextDue,
            assigneeId: task.assigneeId,
            contactId: task.contactId,
            companyId: task.companyId,
            dealId: task.dealId,
            leadId: task.leadId,
            recurrence: task.recurrence,
          },
        });
      }
    }
  }
  if (reopening) {
    await createActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      type: "TASK_EVENT",
      title: "TASK_REOPENED",
      content: task.title,
      contactId: task.contactId,
      companyId: task.companyId,
      dealId: task.dealId,
      leadId: task.leadId,
      metadata: { taskId: task.id },
    });
  }
  if (body.assigneeId !== undefined && body.assigneeId && body.assigneeId !== existing.assigneeId && body.assigneeId !== ctx.user.id) {
    await notify({
      workspaceId: ctx.workspaceId,
      userId: body.assigneeId,
      type: "ASSIGNMENT",
      title: task.title,
      body: "TASK_ASSIGNED",
      link: `tasks?taskId=${task.id}`,
    });
  }

  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "UPDATE", entityType: "task", entityId: id });
  return ok(task);
});

// ---- Delete ----
export const DELETE = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const ctx = await requireWorkspace(req);
  const existing = await db.task.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!existing) return fail(404, "NOT_FOUND", "Task not found.");
  await db.task.delete({ where: { id } });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "DELETE", entityType: "task", entityId: id });
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
