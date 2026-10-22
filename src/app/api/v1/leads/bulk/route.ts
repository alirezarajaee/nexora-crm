import { z } from "zod";
import { db } from "@/lib/db";
import { assertUserInWorkspace, handler, ok, parseBody, requireWorkspaceFromBody } from "@/lib/server/api";
import { audit, createActivity } from "@/lib/server/activity";
import { syncTags } from "@/lib/server/tags";

const bulkSchema = z.object({
  workspaceId: z.string().min(1),
  ids: z.array(z.string()).min(1).max(200),
  action: z.enum(["archive", "restore", "assign", "addTag", "delete"]),
  ownerId: z.string().optional(),
  tagName: z.string().optional(),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, bulkSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  // Scope check: all ids must belong to the workspace
  const count = await db.lead.count({
    where: { id: { in: body.ids }, workspaceId: ctx.workspaceId },
  });
  if (count !== body.ids.length) {
    // One or more ids are outside this workspace — refuse without revealing which
    return ok({ success: false, error: "NOT_FOUND" });
  }

  switch (body.action) {
    case "archive":
      await db.lead.updateMany({ where: { id: { in: body.ids } }, data: { archived: true } });
      break;
    case "restore":
      await db.lead.updateMany({ where: { id: { in: body.ids } }, data: { archived: false } });
      break;
    case "assign":
      if (!body.ownerId) break;
      // Cross-workspace authorization: target owner must be a workspace member
      await assertUserInWorkspace(body.ownerId, ctx.workspaceId);
      await db.lead.updateMany({ where: { id: { in: body.ids } }, data: { ownerId: body.ownerId } });
      break;
    case "addTag":
      if (body.tagName) {
        for (const id of body.ids) {
          await syncTags(ctx.workspaceId, "lead", id, [body.tagName], []);
        }
      }
      break;
    case "delete":
      // Deliberate policy: every workspace member may delete the leads they
      // can see (documented in README); hard deletes are audit-logged.
      await db.lead.deleteMany({ where: { id: { in: body.ids } } });
      break;
  }

  await audit({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    action: body.action.toUpperCase(),
    entityType: "lead",
    detail: { ids: body.ids.length },
  });

  if (body.action === "assign" && body.ownerId && body.ownerId !== ctx.user.id) {
    await createActivity({
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      type: "SYSTEM",
      title: "BULK_ASSIGN",
      metadata: { count: body.ids.length },
    });
  }

  return ok({ success: true, affected: body.ids.length });
});

export const dynamic = "force-dynamic";
