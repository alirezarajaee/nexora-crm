import { db } from "@/lib/db";
import { handler, ok, requireWorkspace, urlToFilters } from "@/lib/server/api";
import { computeRadar } from "@/lib/server/radar";
import { scanTimeBasedAutomations } from "@/lib/server/automation";

export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const sp = urlToFilters(req);
  const severity = sp.get("severity") ?? "";
  const ruleKey = sp.get("ruleKey") ?? "";
  const ownerId = sp.get("ownerId") ?? "";

  const radar = await computeRadar(ctx.workspaceId);
  let items = radar.items;
  if (severity) items = items.filter((i) => i.severity === severity);
  if (ruleKey) items = items.filter((i) => i.ruleKey === ruleKey);
  if (ownerId) items = items.filter((i) => i.entity.ownerId === ownerId);

  return ok({ ...radar, items });
});

// POST: run a manual automation scan (time-based triggers)
export const POST = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  await scanTimeBasedAutomations(ctx.workspaceId, ctx.user.id);
  await db.auditLog.create({
    data: {
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      action: "SCAN",
      entityType: "automation",
    },
  }).catch(() => {});
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
