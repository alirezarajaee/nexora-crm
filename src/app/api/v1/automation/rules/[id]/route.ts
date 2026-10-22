import { z } from "zod";
import { db } from "@/lib/db";
import {
  fail,
  handler,
  ok,
  parseBody,
  requireWorkspaceFromBody,
} from "@/lib/server/api";
import { audit } from "@/lib/server/activity";
import { validateRuleActions } from "@/lib/server/automation";
import type { AutomationAction, AutomationCondition, AutomationRule } from "@/types/api";

type Params = { params: Promise<{ id: string }> };

const TRIGGERS = ["LEAD_CREATED", "DEAL_CREATED", "DEAL_STAGE_CHANGED", "TASK_OVERDUE", "DEAL_INACTIVE", "RECORD_ASSIGNED", "STATUS_ENTERED"] as const;
const ACTION_TYPES = ["CREATE_TASK", "ADD_TAG", "ASSIGN", "NOTIFY", "UPDATE_FIELD", "LOG_EVENT"] as const;
const OPERATORS = ["equals", "notEquals", "greaterThan", "lessThan", "contains"] as const;
const CONDITION_FIELDS = ["value", "stage", "source", "owner", "priority", "status"] as const;

const actionSchema = z.object({
  type: z.enum(ACTION_TYPES),
  params: z.record(z.string(), z.string()).default({}),
});
const conditionSchema = z.object({
  field: z.enum(CONDITION_FIELDS),
  operator: z.enum(OPERATORS),
  value: z.string().min(1).max(200),
});

const patchSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional().or(z.literal("")),
  triggerType: z.enum(TRIGGERS).optional(),
  conditions: z.array(conditionSchema).max(5).optional(),
  actions: z.array(actionSchema).min(1).max(5).optional(),
  enabled: z.boolean().optional(),
});

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

// ---- Update rule (incl. enable/disable) ----
export const PATCH = handler(async (req: Request, { params }: Params) => {
  const { id } = await params;
  const body = await parseBody(req, patchSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  const rule = await db.automationRule.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!rule) return fail(404, "NOT_FOUND", "Rule not found.");

  // Validate action payloads (user references + enum values) before storing
  if (body.actions !== undefined) {
    await validateRuleActions(ctx.workspaceId, body.actions as AutomationAction[]);
  }

  const updated = await db.automationRule.update({
    where: { id },
    data: {
      ...(body.name !== undefined ? { name: body.name.trim() } : {}),
      ...(body.description !== undefined ? { description: body.description || null } : {}),
      ...(body.triggerType !== undefined ? { triggerType: body.triggerType } : {}),
      ...(body.conditions !== undefined ? { conditions: JSON.stringify(body.conditions) } : {}),
      ...(body.actions !== undefined ? { actions: JSON.stringify(body.actions) } : {}),
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    },
  });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "UPDATE", entityType: "automation_rule", entityId: id });
  return ok(serializeRule(updated));
});

export const dynamic = "force-dynamic";
