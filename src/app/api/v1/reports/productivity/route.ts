import { db } from "@/lib/db";
import { csvParam, dateParam, handler, ok, requireWorkspace, urlToFilters } from "@/lib/server/api";
import type { ProductivityReport, NamedValue } from "@/types/api";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const sp = urlToFilters(req);
  const from = dateParam(sp, "from") ?? startOfDay(new Date(Date.now() - 30 * 86400000));
  const to = dateParam(sp, "to") ?? new Date();
  const ownerIds = csvParam(sp, "ownerId");

  const todayStart = startOfDay(new Date());
  const ownerFilter = ownerIds.length ? { in: ownerIds } : undefined;

  const [tasks, activities, radar] = await Promise.all([
    db.task.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(ownerFilter ? { assigneeId: ownerFilter } : {}),
        OR: [
          { completedAt: { gte: from, lte: to } },
          { status: "OPEN", dueAt: { lte: to } },
        ],
      },
      select: { status: true, completedAt: true, dueAt: true, assigneeId: true, title: true },
    }),
    db.activity.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        ...(ownerFilter ? { userId: ownerFilter } : {}),
        createdAt: { gte: from, lte: to },
      },
      select: { createdAt: true, type: true, userId: true },
    }),
    (await import("@/lib/server/radar")).computeRadar(ctx.workspaceId),
  ]);

  const completed = tasks.filter((t) => t.status === "DONE");
  const overdue = tasks.filter(
    (t) => t.status === "OPEN" && t.dueAt && t.dueAt.getTime() < todayStart.getTime()
  );

  const completedVsOverdue: NamedValue[] = [
    { name: "completed", key: "reports.productivity.completed", value: completed.length },
    { name: "overdue", key: "reports.productivity.overdue", value: overdue.length },
  ];

  const byDay = new Map<string, number>();
  for (const a of activities) {
    const key = startOfDay(a.createdAt).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  const activitiesOverTime: { date: string; value: number }[] = [];
  const cursor = startOfDay(from);
  const endDay = startOfDay(to);
  let guard = 0;
  while (cursor <= endDay && guard < 180) {
    const key = cursor.toISOString().slice(0, 10);
    activitiesOverTime.push({ date: key, value: byDay.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  const followUpsCompleted = completed.filter((t) => t.title.toLowerCase().includes("follow")).length;

  const workloadMap = new Map<string, number>();
  for (const t of tasks) {
    if (!t.assigneeId) continue;
    workloadMap.set(t.assigneeId, (workloadMap.get(t.assigneeId) ?? 0) + 1);
  }
  const workloadByOwner: NamedValue[] = [];
  for (const [userId, value] of workloadMap.entries()) {
    const user = await db.user.findUnique({ where: { id: userId }, select: { name: true } });
    workloadByOwner.push({ name: user?.name ?? userId, value });
  }
  workloadByOwner.sort((a, b) => b.value - a.value);

  const report: ProductivityReport = {
    completedVsOverdue,
    activitiesOverTime,
    followUpsCompleted,
    workloadByOwner,
    attentionDeals: radar.items.filter((i) => i.entityType === "deal").length,
  };
  return ok(report);
});

export const dynamic = "force-dynamic";
