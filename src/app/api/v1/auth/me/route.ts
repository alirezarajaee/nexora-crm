import { z } from "zod";
import { db } from "@/lib/db";
import { handler, ok, parseBody, requireAuth } from "@/lib/server/api";

export const GET = handler(async () => {
  const user = await requireAuth();
  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });
  return ok({
    user,
    memberships: memberships.map((m) => ({
      workspaceId: m.workspaceId,
      role: m.role,
      workspace: {
        id: m.workspace.id,
        name: m.workspace.name,
        currency: m.workspace.currency,
        timezone: m.workspace.timezone,
        ownerId: m.workspace.ownerId,
      },
    })),
  });
});

const patchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  locale: z.enum(["fa", "en"]).optional(),
});

export const PATCH = handler(async (req) => {
  const auth = await requireAuth();
  const body = await parseBody(req, patchSchema);
  const user = await db.user.update({
    where: { id: auth.id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.locale !== undefined ? { locale: body.locale } : {}),
    },
  });
  return ok({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      locale: user.locale as "fa" | "en",
      createdAt: user.createdAt.toISOString(),
    },
  });
});

export const dynamic = "force-dynamic";
