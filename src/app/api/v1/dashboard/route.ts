import { db } from "@/lib/db";
import { handler, ok, requireWorkspace } from "@/lib/server/api";
import { computeRadar } from "@/lib/server/radar";
import { scanTimeBasedAutomations } from "@/lib/server/automation";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysAgo(n: number): Date {
  return startOfDay(new Date(Date.now() - n * 86400000));
}

function seriesFromCounts(map: Map<string, number>, days: number): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = daysAgo(i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, value: map.get(key) ?? 0 });
  }
  return out;
}

export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const ws = ctx.workspaceId;

  // Fire-and-forget scan of time-based automations (idempotent, deduped internally)
  void scanTimeBasedAutomations(ws, ctx.user.id).catch(() => {});

  const todayStart = startOfDay(new Date());
  const todayEnd = new Date(todayStart.getTime() + 86400000 - 1);

  const [
    totalContacts,
    newLeads,
    activeDealsAgg,
    wonAgg,
    lostAgg,
    allLeadsCount,
    convertedLeadsCount,
    overdueTasks,
    followUpsToday,
    recentLeads,
    closedLast30,
    openDealsForStages,
    tasksForCompletion,
    recentActivities,
    radar,
  ] = await Promise.all([
    db.contact.count({ where: { workspaceId: ws, archived: false } }),
    db.lead.count({ where: { workspaceId: ws, status: "NEW", archived: false } }),
    db.deal.aggregate({
      where: { workspaceId: ws, archived: false, stage: { type: "OPEN" } },
      _count: true,
      _sum: { value: true },
    }),
    db.deal.aggregate({
      where: { workspaceId: ws, stage: { type: "WON" } },
      _count: true,
      _sum: { value: true },
    }),
    db.deal.aggregate({
      where: { workspaceId: ws, stage: { type: "LOST" } },
      _count: true,
    }),
    db.lead.count({ where: { workspaceId: ws, archived: false } }),
    db.lead.count({ where: { workspaceId: ws, archived: false, status: { in: ["QUALIFIED", "CONVERTED"] } } }),
    db.task.count({ where: { workspaceId: ws, status: "OPEN", dueAt: { lt: todayStart } } }),
    db.task.count({ where: { workspaceId: ws, status: "OPEN", dueAt: { gte: todayStart, lte: todayEnd } } }),
    db.lead.findMany({
      where: { workspaceId: ws, archived: false, createdAt: { gte: daysAgo(30) } },
      select: { createdAt: true },
    }),
    db.deal.findMany({
      where: { workspaceId: ws, stage: { type: "WON" }, actualCloseDate: { gte: daysAgo(30) } },
      select: { actualCloseDate: true, value: true },
    }),
    db.deal.findMany({
      where: { workspaceId: ws, archived: false },
      include: { stage: { select: { key: true, name: true, type: true, order: true } } },
    }),
    db.task.findMany({
      where: { workspaceId: ws },
      select: { status: true, dueAt: true },
      take: 1000,
    }),
    db.activity.findMany({
      where: { workspaceId: ws },
      include: {
        user: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        lead: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
    computeRadar(ws),
  ]);

  // Deals closed in last 30 days (won) for value-over-time — already fetched as closedLast30
  const kpis = {
    totalContacts,
    newLeads,
    activeDeals: activeDealsAgg._count,
    openPipelineValue: activeDealsAgg._sum.value ?? 0,
    wonRevenue: wonAgg._sum.value ?? 0,
    conversionRate: allLeadsCount > 0 ? Math.min(100, Math.round((convertedLeadsCount / allLeadsCount) * 1000) / 10) : 0,
    overdueTasks,
    followUpsToday,
  };

  const leadsMap = new Map<string, number>();
  for (const l of recentLeads) {
    const key = startOfDay(l.createdAt).toISOString().slice(0, 10);
    leadsMap.set(key, (leadsMap.get(key) ?? 0) + 1);
  }

  const revenueMap = new Map<string, number>();
  for (const d of closedLast30) {
    if (!d.actualCloseDate) continue;
    const key = startOfDay(d.actualCloseDate).toISOString().slice(0, 10);
    revenueMap.set(key, (revenueMap.get(key) ?? 0) + d.value);
  }

  // Deals by stage (open stages only, ordered)
  const stageOrder = new Map<string, number>();
  const stageNameByKey = new Map<string, { name: string; type: string }>();
  for (const d of openDealsForStages) {
    if (!d.stage) continue;
    stageOrder.set(d.stage.key, Math.min(stageOrder.get(d.stage.key) ?? 99, d.stage.order));
    stageNameByKey.set(d.stage.key, { name: d.stage.name, type: d.stage.type });
  }
  const byStage = new Map<string, { count: number; value: number }>();
  for (const d of openDealsForStages) {
    if (!d.stage || d.stage.type !== "OPEN") continue;
    const entry = byStage.get(d.stage.key) ?? { count: 0, value: 0 };
    entry.count += 1;
    entry.value += d.value;
    byStage.set(d.stage.key, entry);
  }
  const dealsByStage = [...stageOrder.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([key]) => {
      const entry = byStage.get(key) ?? { count: 0, value: 0 };
      const nameInfo = stageNameByKey.get(key);
      return { name: nameInfo?.name ?? key, key: `stage:${key}`, value: entry.count, extra: entry.value };
    });

  const wonVsLost = [
    { name: "won", key: "dashboard.charts.won", value: wonAgg._count },
    { name: "lost", key: "dashboard.charts.lost", value: lostAgg._count },
  ];

  // Lead sources
  const sourceCounts = await db.lead.groupBy({
    by: ["source"],
    where: { workspaceId: ws, archived: false },
    _count: true,
  });
  const leadSources = sourceCounts
    .filter((s) => s.source)
    .map((s) => ({ name: s.source as string, key: `enums.source.${s.source}`, value: s._count }));

  // Task completion
  const doneCount = tasksForCompletion.filter((t) => t.status === "DONE").length;
  const openCount = tasksForCompletion.filter((t) => t.status === "OPEN" && (!t.dueAt || t.dueAt.getTime() >= todayStart.getTime())).length;
  const overdueCount = tasksForCompletion.filter((t) => t.status === "OPEN" && t.dueAt && t.dueAt.getTime() < todayStart.getTime()).length;
  const taskCompletion = [
    { name: "done", key: "dashboard.charts.completed", value: doneCount },
    { name: "open", key: "dashboard.charts.openTasks", value: openCount },
    { name: "overdue", key: "dashboard.charts.overdue", value: overdueCount },
  ];

  // Priorities
  const [overdueTasksList, dueTodayList, stagnantDeals] = await Promise.all([
    db.task.findMany({
      where: { workspaceId: ws, status: "OPEN", dueAt: { lt: todayStart } },
      include: { assignee: { select: { id: true, name: true } }, deal: { select: { id: true, title: true } }, contact: { select: { id: true, name: true } } },
      orderBy: { dueAt: "asc" },
      take: 6,
    }),
    db.task.findMany({
      where: { workspaceId: ws, status: "OPEN", dueAt: { gte: todayStart, lte: todayEnd } },
      include: { assignee: { select: { id: true, name: true } }, deal: { select: { id: true, title: true } }, contact: { select: { id: true, name: true } } },
      orderBy: { dueAt: "asc" },
      take: 6,
    }),
    db.deal.findMany({
      where: {
        workspaceId: ws,
        archived: false,
        stage: { type: "OPEN" },
        stageEnteredAt: { lt: new Date(Date.now() - 14 * 86400000) },
      },
      include: { stage: true, owner: { select: { id: true, name: true } } },
      orderBy: { stageEnteredAt: "asc" },
      take: 5,
    }),
  ]);

  const radarCritical = radar.items.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH").slice(0, 5);

  return ok({
    kpis,
    leadsOverTime: seriesFromCounts(leadsMap, 30),
    dealsByStage,
    wonVsLost,
    revenueOverTime: seriesFromCounts(revenueMap, 30),
    leadSources,
    taskCompletion,
    priorities: {
      overdueTasks: overdueTasksList,
      dueToday: dueTodayList,
      stagnantDeals,
      recentActivity: recentActivities,
      radarCritical,
    },
    generatedAt: new Date().toISOString(),
  });
});

export const dynamic = "force-dynamic";
