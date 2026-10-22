import { z } from "zod";
import { db } from "@/lib/db";
import { fail, handler, ok, parseBody, requireWorkspaceFromBody, requireRole } from "@/lib/server/api";
import { audit } from "@/lib/server/activity";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  isDefault: z.boolean().optional(),
});

export const PATCH = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, patchSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);
  requireRole(ctx, "OWNER", "ADMIN");

  const pipeline = await db.pipeline.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!pipeline) return fail(404, "NOT_FOUND", "Pipeline not found.");

  if (body.isDefault) {
    await db.pipeline.updateMany({
      where: { workspaceId: ctx.workspaceId, isDefault: true },
      data: { isDefault: false },
    });
  }
  const updated = await db.pipeline.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
    },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "UPDATE", entityType: "pipeline", entityId: id });
  return ok(updated);
});

export const dynamic = "force-dynamic";
