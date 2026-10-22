import { z } from "zod";
import { db } from "@/lib/db";
import {
  fail,
  handler,
  ok,
  parseBody,
  requireWorkspace,
  requireWorkspaceFromBody,
  urlToFilters,
} from "@/lib/server/api";
import { audit } from "@/lib/server/activity";
import { validateRuleActions } from "@/lib/server/automation";
import type { AutomationAction, AutomationCondition, AutomationRule } from "@/types/api";

const TRIGGERS = ["LEAD_CREATED", "DEAL_CREATED", "DEAL_STAGE_CHANGED", "TASK_OVERDUE", "DEAL_INACTIVE", "RECORD_ASSIGNED", "STATUS_ENTERED"] as const;
const ACTION_TYPES = ["CREATE_TASK", "ADD_TAG", "ASSIGN", "NOTIFY", "UPDATE_FIELD", "LOG_EVENT"] as const;
const OPERATORS = ["equals", "notEquals", "greaterThan", "lessThan", "contains"] as const;
const CONDITION_FIELDS = ["value", "stage", "source", "owner", "priority", "status"] as const;

function serializeRule(rule: {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  triggerType: string;
  conditions: string;
  actions: string;
  enabled: boolean;
  createdBy: string;
  lastRunAt: Date | null;
  runCount: number;
  createdAt: Date;
  updatedAt: Date;
}): AutomationRule {
  let conditions: AutomationCondition[] = [];
  let actions: AutomationAction[] = [];
  try {
    conditions = JSON.parse(rule.conditions || "[]");
    actions = JSON.parse(rule.actions || "[]");
  } catch {
    // leave empty
  }
  return {
    ...rule,
    triggerType: rule.triggerType as AutomationRule["triggerType"],
    conditions,
    actions,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
    lastRunAt: rule.lastRunAt ? rule.lastRunAt.toISOString() : null,
  };
}

// ---- List rules ----
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const sp = urlToFilters(req);
  const includeExecutions = sp.get("executions") === "rule" ? false : false;
  void includeExecutions;
  const rules = await db.automationRule.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  return ok(rules.map(serializeRule));
});

const actionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  params: z.record(z.string(), z.string()).default({}),
});
const conditionSchema = z.object({
  field: z.enum(CONDITION_FIELDS),
  operator: z.enum(OPERATORS),
  value: z.string().min(1).max(200),
});

const createSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional().or(z.literal("")),
  triggerType: z.enum(TRIGGERS),
  conditions: z.array(conditionSchema).max(5).default([]),
  actions: z.array(actionSchema).min(1).max(5),
  enabled: z.boolean().default(true),
});

// ---- Create rule ----
export const POST = handler(async (req) => {
  const body = await parseBody(req, createSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  // Validate action payloads (user references + enum values) before storing
  await validateRuleActions(ctx.workspaceId, body.actions as AutomationAction[]);

  const rule = await db.automationRule.create({
    data: {
      workspaceId: ctx.workspaceId,
      name: body.name.trim(),
      description: body.description || null,
      triggerType: body.triggerType,
      conditions: JSON.stringify(body.conditions),
      actions: JSON.stringify(body.actions),
      enabled: body.enabled,
      createdBy: ctx.user.id,
    },
  });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "CREATE", entityType: "automation_rule", entityId: rule.id });
  return ok(serializeRule(rule), 201);
});

// ---- Delete rule ----
export const DELETE = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return fail(400, "BAD_REQUEST", "id is required.");
  const rule = await db.automationRule.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!rule) return fail(404, "NOT_FOUND", "Rule not found.");
  await db.automationRule.delete({ where: { id } });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "DELETE", entityType: "automation_rule", entityId: id });
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
