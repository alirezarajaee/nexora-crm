import { db } from "@/lib/db";
import type { AutomationAction, AutomationCondition, AutomationTrigger } from "@/types/api";
import { HttpError } from "./api";
import { createActivity, notify } from "./activity";

// ---- Automation engine ----
// Explainable, data-driven rule execution. No arbitrary user code is run:
// triggers/conditions/actions are fixed enums validated at the API boundary.

export interface AutomationEvent {
  workspaceId: string;
  trigger: AutomationTrigger;
  entityType: "lead" | "contact" | "company" | "deal" | "task";
  entity: {
    id: string;
    title: string;
    ownerId?: string | null;
    assigneeId?: string | null;
    [key: string]: unknown;
  };
  actorId: string;
}

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

// ---- Rule-definition validation (shared by the automation rules API) ----

const STATUS_VALUES = ["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED"];
const PRIORITY_VALUES = ["LOW", "MEDIUM", "HIGH"];

async function isWorkspaceMember(userId: string, workspaceId: string): Promise<boolean> {
  const m = await db.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true },
  });
  return Boolean(m);
}

/**
 * Validates user references and enum values inside rule actions BEFORE a
 * rule is stored. Prevents rules that would assign records to users outside
 * the workspace or write invalid enum values later.
 */
export async function validateRuleActions(
  workspaceId: string,
  actions: AutomationAction[]
): Promise<void> {
  for (const action of actions) {
    const params = (action.params ?? {}) as Record<string, string>;
    if (action.type === "CREATE_TASK" && params.assigneeId) {
      if (!(await isWorkspaceMember(params.assigneeId, workspaceId))) {
        throw new HttpError(400, "NOT_A_MEMBER", "Action assignee is not a member of this workspace.");
      }
    }
    if (action.type === "ASSIGN" && params.userId) {
      if (!(await isWorkspaceMember(params.userId, workspaceId))) {
        throw new HttpError(400, "NOT_A_MEMBER", "Action target user is not a member of this workspace.");
      }
    }
    if (action.type === "UPDATE_FIELD") {
      if (params.field === "status" && !STATUS_VALUES.includes(params.value)) {
        throw new HttpError(422, "VALIDATION_ERROR", "Invalid status value for UPDATE_FIELD action.");
      }
      if (params.field === "priority" && !PRIORITY_VALUES.includes(params.value)) {
        throw new HttpError(422, "VALIDATION_ERROR", "Invalid priority value for UPDATE_FIELD action.");
      }
    }
  }
}

function checkCondition(entity: Record<string, unknown>, cond: AutomationCondition): boolean {
  const raw = (entity as Record<string, unknown>)[cond.field];
  switch (cond.operator) {
    case "equals":
      return String(raw ?? "") === cond.value;
    case "notEquals":
      return String(raw ?? "") !== cond.value;
    case "contains":
      return String(raw ?? "").toLowerCase().includes(cond.value.toLowerCase());
    case "greaterThan": {
      const a = Number(raw);
      const b = Number(cond.value);
      return Number.isFinite(a) && Number.isFinite(b) && a > b;
    }
    case "lessThan": {
      const a = Number(raw);
      const b = Number(cond.value);
      return Number.isFinite(a) && Number.isFinite(b) && a < b;
    }
    default:
      return true;
  }
}

async function alreadyRanToday(ruleId: string, entityId: string): Promise<boolean> {
  const existing = await db.automationExecution.findFirst({
    where: {
      ruleId,
      entityId,
      createdAt: {
        gte: new Date(`${dayKey()}T00:00:00.000Z`),
      },
    },
  });
  return Boolean(existing);
}

async function executeAction(
  rule: { id: string; name: string; workspaceId: string },
  action: AutomationAction,
  event: AutomationEvent
): Promise<string> {
  const { workspaceId, entity, actorId } = event;
  const ownerId = (entity.ownerId as string | null) ?? null;

  switch (action.type) {
    case "CREATE_TASK": {
      const title = action.params.title?.trim() || rule.name;
      const dueInDays = Number(action.params.dueInDays ?? 0) || 0;
      const dueAt = dueInDays > 0 ? new Date(Date.now() + dueInDays * 86400000) : null;
      let assigneeId =
        (action.params.assigneeId && action.params.assigneeId !== "") ? action.params.assigneeId
        : ownerId ?? actorId;
      // Defense in depth: never assign to a user outside this workspace
      if (assigneeId && !(await isWorkspaceMember(assigneeId, workspaceId))) {
        assigneeId = actorId;
      }
      await db.task.create({
        data: {
          workspaceId,
          title,
          description: action.params.description || null,
          priority: (action.params.priority as "LOW" | "MEDIUM" | "HIGH") || "MEDIUM",
          dueAt,
          assigneeId,
          contactId: event.entityType === "contact" ? entity.id : null,
          companyId: event.entityType === "company" ? entity.id : null,
          dealId: event.entityType === "deal" ? entity.id : null,
          leadId: event.entityType === "lead" ? entity.id : null,
        },
      });
      if (assigneeId && assigneeId !== actorId) {
        await notify({
          workspaceId,
          userId: assigneeId,
          type: "AUTOMATION",
          title: rule.name,
          body: title,
          link: `tasks`,
          dedupeKey: `auto-task:${rule.id}:${entity.id}:${dayKey()}`,
        });
      }
      return `CREATE_TASK:${title}`;
    }
    case "ADD_TAG": {
      const tagName = action.params.tagName?.trim();
      if (!tagName) throw new Error("ADD_TAG requires tagName");
      const tag = await db.tag.upsert({
        where: { workspaceId_name: { workspaceId, name: tagName } },
        create: { workspaceId, name: tagName, color: action.params.color || "#8B5CF6" },
        update: {},
      });
      await db.tagRelation.upsert({
        where: {
          tagId_entityType_entityId: {
            tagId: tag.id,
            entityType: event.entityType,
            entityId: entity.id,
          },
        },
        create: { workspaceId, tagId: tag.id, entityType: event.entityType, entityId: entity.id },
        update: {},
      });
      return `ADD_TAG:${tagName}`;
    }
    case "ASSIGN": {
      let target = action.params.userId || actorId;
      // Defense in depth: never assign to a user outside this workspace
      if (!(await isWorkspaceMember(target, workspaceId))) {
        throw new Error("ASSIGN target is not a member of this workspace");
      }
      if (event.entityType === "task") {
        await db.task.update({ where: { id: entity.id }, data: { assigneeId: target } });
      } else if (event.entityType === "lead") {
        await db.lead.update({ where: { id: entity.id }, data: { ownerId: target } });
      } else if (event.entityType === "deal") {
        await db.deal.update({ where: { id: entity.id }, data: { ownerId: target } });
      } else if (event.entityType === "contact") {
        await db.contact.update({ where: { id: entity.id }, data: { ownerId: target } });
      } else if (event.entityType === "company") {
        await db.company.update({ where: { id: entity.id }, data: { ownerId: target } });
      }
      if (target !== actorId) {
        await notify({
          workspaceId,
          userId: target,
          type: "ASSIGNMENT",
          title: rule.name,
          body: entity.title,
          link: `${event.entityType}s`,
          dedupeKey: `auto-assign:${rule.id}:${entity.id}`,
        });
      }
      return `ASSIGN:${target}`;
    }
    case "NOTIFY": {
      const targets = new Set<string>([ownerId ?? actorId, actorId].filter(Boolean) as string[]);
      for (const userId of targets) {
        await notify({
          workspaceId,
          userId,
          type: "AUTOMATION",
          title: rule.name,
          body: action.params.message || entity.title,
          link: `${event.entityType}s`,
          dedupeKey: `auto-notify:${rule.id}:${entity.id}:${dayKey()}`,
        });
      }
      return "NOTIFY";
    }
    case "UPDATE_FIELD": {
      const field = action.params.field;
      const value = action.params.value;
      const allowed: Record<string, Record<string, string>> = {
        lead: { status: "status", priority: "priority" },
        deal: { priority: "priority" },
        task: { priority: "priority" },
        contact: {},
        company: {},
      };
      const mapped = allowed[event.entityType]?.[field];
      if (!mapped) throw new Error(`UPDATE_FIELD.${field} not allowed for ${event.entityType}`);
      // Defense in depth: only valid enum values may be written
      if (field === "status" && !STATUS_VALUES.includes(value)) {
        throw new Error(`UPDATE_FIELD: invalid status value "${value}"`);
      }
      if (field === "priority" && !PRIORITY_VALUES.includes(value)) {
        throw new Error(`UPDATE_FIELD: invalid priority value "${value}"`);
      }
      const model = ({ lead: db.lead, deal: db.deal, task: db.task } as any)[event.entityType];
      if (model) {
        await model.update({ where: { id: entity.id }, data: { [mapped]: value } });
      }
      return `UPDATE_FIELD:${field}=${value}`;
    }
    case "LOG_EVENT": {
      await createActivity({
        workspaceId,
        userId: actorId,
        type: "SYSTEM",
        title: rule.name,
        content: action.params.message || null,
        contactId: event.entityType === "contact" ? entity.id : null,
        companyId: event.entityType === "company" ? entity.id : null,
        dealId: event.entityType === "deal" ? entity.id : null,
        leadId: event.entityType === "lead" ? entity.id : null,
        metadata: { automation: rule.id },
      });
      return "LOG_EVENT";
    }
    default:
      throw new Error(`Unknown action type: ${String((action as { type?: string }).type)}`);
  }
}

export async function runAutomations(event: AutomationEvent): Promise<void> {
  const rules = await db.automationRule.findMany({
    where: { workspaceId: event.workspaceId, triggerType: event.trigger, enabled: true },
  });
  for (const rule of rules) {
    try {
      let conditions: AutomationCondition[] = [];
      let actions: AutomationAction[] = [];
      try {
        conditions = JSON.parse(rule.conditions || "[]");
        actions = JSON.parse(rule.actions || "[]");
      } catch {
        throw new Error("Rule definition is not valid JSON");
      }
      const matched = conditions.every((c) => checkCondition(event.entity as Record<string, unknown>, c));
      if (!matched) {
        await db.automationExecution.create({
          data: {
            workspaceId: event.workspaceId,
            ruleId: rule.id,
            ruleName: rule.name,
            status: "SKIPPED",
            detail: "Conditions not met",
            entityType: event.entityType,
            entityId: event.entity.id,
          },
        });
        continue;
      }
      // Time-based triggers (TASK_OVERDUE, DEAL_INACTIVE) run at most once per
      // rule+entity per day to prevent noisy duplicate executions.
      if (event.trigger === "TASK_OVERDUE" || event.trigger === "DEAL_INACTIVE") {
        if (await alreadyRanToday(rule.id, event.entity.id)) continue;
      }
      const results: string[] = [];
      for (const action of actions) {
        results.push(await executeAction({ id: rule.id, name: rule.name, workspaceId: event.workspaceId }, action, event));
      }
      await db.automationExecution.create({
        data: {
          workspaceId: event.workspaceId,
          ruleId: rule.id,
          ruleName: rule.name,
          status: "SUCCESS",
          detail: results.join(" | ") || null,
          entityType: event.entityType,
          entityId: event.entity.id,
        },
      });
      await db.automationRule.update({
        where: { id: rule.id },
        data: { lastRunAt: new Date(), runCount: { increment: 1 } },
      });
    } catch (err) {
      await db.automationExecution
        .create({
          data: {
            workspaceId: event.workspaceId,
            ruleId: rule.id,
            ruleName: rule.name,
            status: "FAILED",
            detail: err instanceof Error ? err.message : "Unknown error",
            entityType: event.entityType,
            entityId: event.entity.id,
          },
        })
        .catch(() => {});
    }
  }
}

// ---- Time-based scans (invoked from dashboard/report loads and a manual scan endpoint) ----

export async function scanTimeBasedAutomations(workspaceId: string, actorId: string): Promise<void> {
  const now = new Date();
  const startOfToday = new Date(`${dayKey(now)}T00:00:00.000Z`);

  // Overdue open tasks
  const overdueTasks = await db.task.findMany({
    where: { workspaceId, status: "OPEN", dueAt: { lt: startOfToday } },
    take: 100,
  });
  for (const task of overdueTasks) {
    await runAutomations({
      workspaceId,
      trigger: "TASK_OVERDUE",
      entityType: "task",
      entity: { ...task, title: task.title },
      actorId,
    });
  }

  // Inactive open deals
  const ws = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!ws) return;
  const inactiveSince = new Date(now.getTime() - ws.radarDealInactivityDays * 86400000);
  const inactiveDeals = await db.deal.findMany({
    where: {
      workspaceId,
      archived: false,
      lastActivityAt: { lt: inactiveSince },
      stage: { type: "OPEN" },
    },
    take: 100,
  });
  for (const deal of inactiveDeals) {
    await runAutomations({
      workspaceId,
      trigger: "DEAL_INACTIVE",
      entityType: "deal",
      entity: { ...deal, title: deal.title },
      actorId,
    });
  }
}
