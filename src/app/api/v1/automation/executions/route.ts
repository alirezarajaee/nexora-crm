import { db } from "@/lib/db";
import { handler, ok, requireWorkspace, urlToFilters } from "@/lib/server/api";
import type { AutomationExecution } from "@/types/api";

// ---- Execution history ----
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const sp = urlToFilters(req);
  const ruleId = sp.get("ruleId") || undefined;
  const limit = Math.min(200, Math.max(1, Number(sp.get("limit") ?? 50)));

  const executions = await db.automationExecution.findMany({
    where: { workspaceId: ctx.workspaceId, ...(ruleId ? { ruleId } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return ok(
    executions.map(
      (e): AutomationExecution => ({
        id: e.id,
        ruleId: e.ruleId,
        ruleName: e.ruleName,
        status: e.status as AutomationExecution["status"],
        detail: e.detail,
        entityType: e.entityType,
        entityId: e.entityId,
        createdAt: e.createdAt.toISOString(),
      })
    )
  );
});

export const dynamic = "force-dynamic";
