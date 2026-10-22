import { db } from "@/lib/db";
import { csvParam, dateParam, handler, ok, requireWorkspace, urlToFilters } from "@/lib/server/api";
import type { LeadsReport, NamedValue } from "@/types/api";

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
  const sources = csvParam(sp, "source");

  const where = {
    workspaceId: ctx.workspaceId,
    createdAt: { gte: from, lte: to },
    ...(ownerIds.length ? { ownerId: { in: ownerIds } } : {}),
    ...(sources.length ? { source: { in: sources } } : {}),
  };

  const [leads, totalAll] = await Promise.all([
    db.lead.findMany({
      where,
      select: { id: true, createdAt: true, source: true, status: true, convertedAt: true, convertedContactId: true, lastContactedAt: true },
    }),
    db.lead.count({ where: { workspaceId: ctx.workspaceId, archived: false } }),
  ]);

  const byDay = new Map<string, number>();
  for (const l of leads) {
    const key = startOfDay(l.createdAt).toISOString().slice(0, 10);
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
  }
  const leadsOverTime: { date: string; value: number }[] = [];
  const cursor = startOfDay(from);
  const endDay = startOfDay(to);
  // Cap series at 180 points
  let guard = 0;
  while (cursor <= endDay && guard < 180) {
    const key = cursor.toISOString().slice(0, 10);
    leadsOverTime.push({ date: key, value: byDay.get(key) ?? 0 });
    cursor.setDate(cursor.getDate() + 1);
    guard += 1;
  }

  const sourceMap = new Map<string, number>();
  for (const l of leads) {
    if (!l.source) continue;
    sourceMap.set(l.source, (sourceMap.get(l.source) ?? 0) + 1);
  }
  const bySource: NamedValue[] = [...sourceMap.entries()].map(([name, value]) => ({
    name,
    key: `enums.source.${name}`,
    value,
  }));

  const statusMap = new Map<string, number>();
  for (const l of leads) {
    statusMap.set(l.status, (statusMap.get(l.status) ?? 0) + 1);
  }
  const byStatus: NamedValue[] = [...statusMap.entries()].map(([name, value]) => ({
    name,
    key: `enums.leadStatus.${name}`,
    value,
  }));

  const converted = leads.filter((l) => l.convertedContactId);
  const conversionRate = leads.length > 0 ? Math.round((converted.length / leads.length) * 1000) / 10 : 0;

  let avgTimeToConvertDays: number | null = null;
  if (converted.length > 0) {
    const durations = converted
      .filter((l) => l.convertedAt)
      .map((l) => (l.convertedAt as Date).getTime() - l.createdAt.getTime());
    if (durations.length > 0) {
      avgTimeToConvertDays = Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 86400000);
    }
  }

  const report: LeadsReport = {
    leadsOverTime,
    bySource,
    byStatus,
    conversionRate,
    avgTimeToConvertDays,
    total: totalAll,
  };
  return ok(report);
});

export const dynamic = "force-dynamic";
