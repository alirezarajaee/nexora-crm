import { db } from "@/lib/db";
import { csvParam, dateParam, handler, ok, requireWorkspace, urlToFilters } from "@/lib/server/api";
import type { SalesReport, NamedValue } from "@/types/api";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const sp = urlToFilters(req);
  const from = dateParam(sp, "from") ?? startOfDay(new Date(Date.now() - 90 * 86400000));
  const to = dateParam(sp, "to") ?? new Date();
  const ownerIds = csvParam(sp, "ownerId");
  const pipelineId = sp.get("pipelineId") || undefined;
  const stageIds = csvParam(sp, "stageId");

  const where = {
    workspaceId: ctx.workspaceId,
    ...(ownerIds.length ? { ownerId: { in: ownerIds } } : {}),
    ...(pipelineId ? { pipelineId } : {}),
    ...(stageIds.length ? { stageId: { in: stageIds } } : {}),
  };

  const [deals, stages] = await Promise.all([
    db.deal.findMany({
      where,
      include: { stage: { select: { key: true, name: true, type: true, order: true } } },
    }),
    db.stage.findMany({
      where: { pipeline: { workspaceId: ctx.workspaceId } },
      orderBy: { order: "asc" },
    }),
  ]);

  const inRange = deals.filter((d) => d.createdAt >= from && d.createdAt <= to);

  // Deals by stage (open stages)
  const stageOrderKey = new Map<string, number>();
  const stageNames = new Map<string, string>();
  for (const s of stages) {
    stageOrderKey.set(s.key, s.order);
    stageNames.set(s.key, s.name);
  }
  const byStageMap = new Map<string, { count: number; value: number }>();
  for (const d of inRange) {
    if (!d.stage || d.stage.type !== "OPEN") continue;
    const entry = byStageMap.get(d.stage.key) ?? { count: 0, value: 0 };
    entry.count += 1;
    entry.value += d.value;
    byStageMap.set(d.stage.key, entry);
  }
  const dealsByStage: NamedValue[] = [...stageOrderKey.entries()]
    .sort((a, b) => a[1] - b[1])
    .filter(([key]) => byStageMap.has(key))
    .map(([key]) => {
      const e = byStageMap.get(key)!;
      return { name: stageNames.get(key) ?? key, key: `stage:${key}`, value: e.count, extra: e.value };
    });

  const won = inRange.filter((d) => d.stage?.type === "WON");
  const lost = inRange.filter((d) => d.stage?.type === "LOST");
  const open = inRange.filter((d) => d.stage?.type === "OPEN");
  const decided = won.length + lost.length;
  const winRate = decided > 0 ? Math.round((won.length / decided) * 1000) / 10 : null;
  const wonValue = won.reduce((a, d) => a + d.value, 0);
  const lostValue = lost.reduce((a, d) => a + d.value, 0);

  // Value over time (won deals by actualCloseDate)
  const byDay = new Map<string, number>();
  for (const d of won) {
    if (!d.actualCloseDate) continue;
    const key = startOfDay(d.actualCloseDate).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + d.value);
  }
  const valueOverTime: { date: string; value: number }[] = [];
  const cursor = startOfDay(from);
  const endDay = startOfDay(to);
  let guard = 0;
  while (cursor <= endDay && guard < 180) {
    const key = cursor.toISOString().slice(0, 10);
    valueOverTime.push({ date: key, value: byDay.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  const weightedPipelineValue = Math.round(open.reduce((a, d) => a + (d.value * d.probability) / 100, 0));
  const avgDealSize = inRange.length > 0 ? Math.round(inRange.reduce((a, d) => a + d.value, 0) / inRange.length) : null;

  let avgCycleDays: number | null = null;
  const cycles = won
    .filter((d) => d.actualCloseDate)
    .map((d) => (d.actualCloseDate as Date).getTime() - d.createdAt.getTime());
  if (cycles.length > 0) {
    avgCycleDays = Math.round(cycles.reduce((a, b) => a + b, 0) / cycles.length / 86400000);
  }

  const lossMap = new Map<string, number>();
  for (const d of lost) {
    const reason = (d.lostReason ?? "").trim();
    if (!reason) continue;
    lossMap.set(reason, (lossMap.get(reason) ?? 0) + 1);
  }
  const lossReasons: NamedValue[] = [...lossMap.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 8);

  const report: SalesReport = {
    dealsByStage,
    winRate,
    wonCount: won.length,
    lostCount: lost.length,
    wonValue,
    lostValue,
    valueOverTime,
    weightedPipelineValue,
    avgDealSize,
    avgCycleDays,
    lossReasons,
    total: inRange.length,
  };
  return ok(report);
});

export const dynamic = "force-dynamic";
