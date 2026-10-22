import { db } from "@/lib/db";
import type { RadarItem, RadarResponse, RadarSeverity } from "@/types/api";

// ---- Follow-up Radar: explainable business rules, no AI. ----
// Issues are computed live from workspace data (always fresh, idempotent).
// Explanations are rendered client-side via i18n templates + structured params,
// so the same issue is described correctly in Persian and English.

const SEVERITY_ORDER: Record<RadarSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}

function daysSince(date: Date): number {
  return Math.floor((Date.now() - date.getTime()) / 86400000);
}

export async function computeRadar(workspaceId: string): Promise<RadarResponse> {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) {
    return {
      items: [],
      counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
      thresholds: { leadInactivityDays: 7, dealInactivityDays: 7, stageInactivityDays: 14, highValueThreshold: 10000 },
      generatedAt: new Date().toISOString(),
    };
  }
  const items: RadarItem[] = [];
  const today = startOfToday();
  const todayEnd = endOfToday();

  // 1) Overdue tasks
  const overdueTasks = await db.task.findMany({
    where: { workspaceId, status: "OPEN", dueAt: { lt: today } },
    include: { assignee: { select: { id: true, name: true } }, contact: true, deal: true, company: true },
    take: 200,
  });
  for (const t of overdueTasks) {
    const daysOverdue = daysSince(t.dueAt as Date);
    const severity: RadarSeverity = daysOverdue > 7 ? "CRITICAL" : daysOverdue > 3 ? "HIGH" : "MEDIUM";
    items.push({
      id: `OVERDUE_TASK:${t.id}`,
      ruleKey: "OVERDUE_TASK",
      severity,
      entityType: "task",
      entityId: t.id,
      entity: {
        id: t.id,
        title: t.title,
        subtitle: t.deal?.title ?? t.contact?.name ?? t.company?.name ?? null,
        ownerId: t.assigneeId,
        ownerName: t.assignee?.name ?? null,
      },
      params: { days: daysOverdue },
      suggestedAction: "completeTask",
      actionLink: `tasks?taskId=${t.id}`,
      date: (t.dueAt as Date).toISOString(),
      daysElapsed: daysOverdue,
    });
  }

  // 2) Tasks due today
  const dueToday = await db.task.findMany({
    where: { workspaceId, status: "OPEN", dueAt: { gte: today, lte: todayEnd } },
    include: { assignee: { select: { id: true, name: true } }, deal: true, contact: true },
    take: 200,
  });
  for (const t of dueToday) {
    items.push({
      id: `TASK_DUE_TODAY:${t.id}`,
      ruleKey: "TASK_DUE_TODAY",
      severity: t.priority === "HIGH" ? "MEDIUM" : "LOW",
      entityType: "task",
      entityId: t.id,
      entity: {
        id: t.id,
        title: t.title,
        subtitle: t.deal?.title ?? t.contact?.name ?? null,
        ownerId: t.assigneeId,
        ownerName: t.assignee?.name ?? null,
      },
      params: {},
      suggestedAction: "completeTask",
      actionLink: `tasks?taskId=${t.id}`,
      date: (t.dueAt as Date).toISOString(),
      daysElapsed: 0,
    });
  }

  // 3) Inactive leads (still active statuses)
  const leadInactiveSince = new Date(Date.now() - ws.radarLeadInactivityDays * 86400000);
  const inactiveLeads = await db.lead.findMany({
    where: {
      workspaceId,
      archived: false,
      status: { in: ["NEW", "CONTACTED"] },
      lastActivityAt: { lt: leadInactiveSince },
    },
    include: { owner: { select: { id: true, name: true } } },
    take: 200,
  });
  for (const l of inactiveLeads) {
    const days = daysSince(l.lastActivityAt);
    items.push({
      id: `LEAD_INACTIVE:${l.id}`,
      ruleKey: "LEAD_INACTIVE",
      severity: l.priority === "HIGH" ? "HIGH" : "MEDIUM",
      entityType: "lead",
      entityId: l.id,
      entity: {
        id: l.id,
        title: l.name,
        subtitle: l.companyName,
        ownerId: l.ownerId,
        ownerName: l.owner?.name ?? null,
      },
      params: { days, threshold: ws.radarLeadInactivityDays },
      suggestedAction: "logFollowUp",
      actionLink: `leads?leadId=${l.id}`,
      date: l.lastActivityAt.toISOString(),
      daysElapsed: days,
    });
  }

  // 4) Inactive open deals
  const dealInactiveSince = new Date(Date.now() - ws.radarDealInactivityDays * 86400000);
  const inactiveDeals = await db.deal.findMany({
    where: { workspaceId, archived: false, lastActivityAt: { lt: dealInactiveSince }, stage: { type: "OPEN" } },
    include: { owner: { select: { id: true, name: true } }, stage: true },
    take: 200,
  });
  for (const d of inactiveDeals) {
    const days = daysSince(d.lastActivityAt);
    const severity: RadarSeverity =
      d.value >= ws.radarHighValueThreshold ? "CRITICAL" : d.priority === "HIGH" ? "HIGH" : "MEDIUM";
    items.push({
      id: `DEAL_INACTIVE:${d.id}`,
      ruleKey: "DEAL_INACTIVE",
      severity,
      entityType: "deal",
      entityId: d.id,
      entity: {
        id: d.id,
        title: d.title,
        subtitle: d.stage?.name ?? null,
        ownerId: d.ownerId,
        ownerName: d.owner?.name ?? null,
      },
      params: { days, threshold: ws.radarDealInactivityDays, value: d.value },
      suggestedAction: "logActivity",
      actionLink: `deals?dealId=${d.id}`,
      date: d.lastActivityAt.toISOString(),
      daysElapsed: days,
    });
  }

  // 5) Deals stagnant in a stage
  const stagnantSince = new Date(Date.now() - ws.radarStageInactivityDays * 86400000);
  const stagnantDeals = await db.deal.findMany({
    where: { workspaceId, archived: false, stageEnteredAt: { lt: stagnantSince }, stage: { type: "OPEN" } },
    include: { owner: { select: { id: true, name: true } }, stage: true },
    take: 200,
  });
  for (const d of stagnantDeals) {
    const days = daysSince(d.stageEnteredAt);
    items.push({
      id: `DEAL_STAGE_STAGNANT:${d.id}`,
      ruleKey: "DEAL_STAGE_STAGNANT",
      severity: d.value >= ws.radarHighValueThreshold ? "HIGH" : "MEDIUM",
      entityType: "deal",
      entityId: d.id,
      entity: {
        id: d.id,
        title: d.title,
        subtitle: d.stage?.name ?? null,
        ownerId: d.ownerId,
        ownerName: d.owner?.name ?? null,
      },
      params: { days, threshold: ws.radarStageInactivityDays, stage: d.stage?.name ?? "" },
      suggestedAction: "reviewDeal",
      actionLink: `deals?dealId=${d.id}`,
      date: d.stageEnteredAt.toISOString(),
      daysElapsed: days,
    });
  }

  // 6) Contacts with follow-up due
  const dueContacts = await db.contact.findMany({
    where: { workspaceId, archived: false, nextFollowUpAt: { lte: todayEnd } },
    include: { owner: { select: { id: true, name: true } }, company: { select: { name: true } } },
    take: 200,
  });
  for (const c of dueContacts) {
    const overdueDays = c.nextFollowUpAt ? daysSince(c.nextFollowUpAt) : 0;
    items.push({
      id: `CONTACT_FOLLOWUP_DUE:${c.id}`,
      ruleKey: "CONTACT_FOLLOWUP_DUE",
      severity: overdueDays > 7 ? "HIGH" : "MEDIUM",
      entityType: "contact",
      entityId: c.id,
      entity: {
        id: c.id,
        title: c.name,
        subtitle: c.company?.name ?? null,
        ownerId: c.ownerId,
        ownerName: c.owner?.name ?? null,
      },
      params: { days: Math.max(0, overdueDays) },
      suggestedAction: "logFollowUp",
      actionLink: `contacts?contactId=${c.id}`,
      date: c.nextFollowUpAt ? c.nextFollowUpAt.toISOString() : null,
      daysElapsed: Math.max(0, overdueDays),
    });
  }

  // 7) High-value deals nearing expected close with low recent activity
  const closingSoon = await db.deal.findMany({
    where: {
      workspaceId,
      archived: false,
      stage: { type: "OPEN" },
      value: { gte: ws.radarHighValueThreshold },
      expectedCloseDate: { gte: new Date(Date.now() - 5 * 86400000), lte: new Date(Date.now() + 14 * 86400000) },
    },
    include: { owner: { select: { id: true, name: true } }, stage: true },
    take: 200,
  });
  for (const d of closingSoon) {
    const daysIdle = daysSince(d.lastActivityAt);
    if (daysIdle < 3) continue; // active enough — no alert
    const daysToClose = d.expectedCloseDate
      ? Math.ceil(((d.expectedCloseDate as Date).getTime() - Date.now()) / 86400000)
      : null;
    items.push({
      id: `HIGH_VALUE_CLOSING:${d.id}`,
      ruleKey: "HIGH_VALUE_CLOSING",
      severity: "CRITICAL",
      entityType: "deal",
      entityId: d.id,
      entity: {
        id: d.id,
        title: d.title,
        subtitle: d.stage?.name ?? null,
        ownerId: d.ownerId,
        ownerName: d.owner?.name ?? null,
      },
      params: { value: d.value, daysIdle, daysToClose: daysToClose ?? 0 },
      suggestedAction: "logActivity",
      actionLink: `deals?dealId=${d.id}`,
      date: d.expectedCloseDate ? (d.expectedCloseDate as Date).toISOString() : null,
      daysElapsed: daysIdle,
    });
  }

  // 8) Missing information needed for the next step
  const qualifiedLeads = await db.lead.findMany({
    where: { workspaceId, archived: false, status: "QUALIFIED", OR: [{ estimatedValue: null }, { nextFollowUpAt: null }] },
    include: { owner: { select: { id: true, name: true } } },
    take: 100,
  });
  for (const l of qualifiedLeads) {
    items.push({
      id: `MISSING_INFO:${l.id}`,
      ruleKey: "MISSING_INFO",
      severity: "LOW",
      entityType: "lead",
      entityId: l.id,
      entity: {
        id: l.id,
        title: l.name,
        subtitle: l.companyName,
        ownerId: l.ownerId,
        ownerName: l.owner?.name ?? null,
      },
      params: { missing: !l.estimatedValue && !l.nextFollowUpAt ? "both" : !l.estimatedValue ? "estimatedValue" : "nextFollowUpAt" },
      suggestedAction: "completeInfo",
      actionLink: `leads?leadId=${l.id}`,
      date: null,
      daysElapsed: null,
    });
  }

  const missingDealInfo = await db.deal.findMany({
    where: {
      workspaceId,
      archived: false,
      stage: { type: "OPEN" },
      OR: [{ contactId: null }, { expectedCloseDate: null }],
    },
    include: { owner: { select: { id: true, name: true } }, stage: true },
    take: 100,
  });
  for (const d of missingDealInfo) {
    items.push({
      id: `MISSING_INFO:${d.id}`,
      ruleKey: "MISSING_INFO",
      severity: "LOW",
      entityType: "deal",
      entityId: d.id,
      entity: {
        id: d.id,
        title: d.title,
        subtitle: d.stage?.name ?? null,
        ownerId: d.ownerId,
        ownerName: d.owner?.name ?? null,
      },
      params: { missing: !d.contactId && !d.expectedCloseDate ? "both" : !d.contactId ? "contact" : "expectedCloseDate" },
      suggestedAction: "completeInfo",
      actionLink: `deals?dealId=${d.id}`,
      date: null,
      daysElapsed: null,
    });
  }

  items.sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySeverity !== 0) return bySeverity;
    const ta = a.date ? new Date(a.date).getTime() : 0;
    const tb = b.date ? new Date(b.date).getTime() : 0;
    return ta - tb;
  });

  const counts: Record<RadarSeverity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const item of items) counts[item.severity] += 1;

  return {
    items,
    counts,
    thresholds: {
      leadInactivityDays: ws.radarLeadInactivityDays,
      dealInactivityDays: ws.radarDealInactivityDays,
      stageInactivityDays: ws.radarStageInactivityDays,
      highValueThreshold: ws.radarHighValueThreshold,
    },
    generatedAt: new Date().toISOString(),
  };
}
