import { z } from "zod";
import { db } from "@/lib/db";
import {
  handler,
  ok,
  parseBody,
  requireWorkspace,
  requireWorkspaceFromBody,
  requireRole,
  urlToFilters,
} from "@/lib/server/api";
import { saveCustomFieldValues } from "@/lib/server/custom-fields";
import { audit } from "@/lib/server/activity";
import type { CustomFieldDef } from "@/types/api";

// ---- List custom fields ----
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const entityType = urlToFilters(req).get("entityType") || undefined;
  const fields = await db.customField.findMany({
    where: { workspaceId: ctx.workspaceId, ...(entityType ? { entityType } : {}) },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  return ok(
    fields.map(
      (f): CustomFieldDef => ({
        id: f.id,
        workspaceId: f.workspaceId,
        entityType: f.entityType as CustomFieldDef["entityType"],
        key: f.key,
        label: f.label,
        type: f.type as CustomFieldDef["type"],
        required: f.required,
        options: f.options ? JSON.parse(f.options) : [],
        defaultValue: f.defaultValue,
        order: f.order,
        active: f.active,
      })
    )
  );
});

const createSchema = z.object({
  workspaceId: z.string().min(1),
  entityType: z.enum(["contact", "company", "deal", "lead"]),
  label: z.string().min(1).max(80),
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]*$/).max(40),
  type: z.enum(["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT", "MULTI_SELECT", "URL"]),
  required: z.boolean().default(false),
  options: z.array(z.string().max(80)).max(30).optional(),
  defaultValue: z.string().max(300).optional().or(z.literal("")),
});

// ---- Create field ----
export const POST = handler(async (req) => {
  const body = await parseBody(req, createSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);
  requireRole(ctx, "OWNER", "ADMIN");

  const existing = await db.customField.findUnique({
    where: {
      workspaceId_entityType_key: {
        workspaceId: ctx.workspaceId,
        entityType: body.entityType,
        key: body.key,
      },
    },
  });
  if (existing) return ok({ error: "DUPLICATE_KEY" }, 409);

  const count = await db.customField.count({ where: { workspaceId: ctx.workspaceId } });
  const field = await db.customField.create({
    data: {
      workspaceId: ctx.workspaceId,
      entityType: body.entityType,
      key: body.key,
      label: body.label.trim(),
      type: body.type,
      required: body.required,
      options: body.options && body.options.length ? JSON.stringify(body.options) : null,
      defaultValue: body.defaultValue || null,
      order: count,
    },
  });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "CREATE", entityType: "custom_field", entityId: field.id });
  return ok({ id: field.id }, 201);
});

const patchSchema = z.object({
  workspaceId: z.string().min(1),
  id: z.string().min(1),
  label: z.string().min(1).max(80).optional(),
  required: z.boolean().optional(),
  options: z.array(z.string().max(80)).max(30).optional(),
  active: z.boolean().optional(),
  order: z.number().int().min(0).max(999).optional(),
});

// ---- Update field ----
export const PATCH = handler(async (req) => {
  const body = await parseBody(req, patchSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);
  requireRole(ctx, "OWNER", "ADMIN");

  const field = await db.customField.findFirst({ where: { id: body.id, workspaceId: ctx.workspaceId } });
  if (!field) return ok({ error: "NOT_FOUND" }, 404);

  await db.customField.update({
    where: { id: field.id },
    data: {
      ...(body.label !== undefined ? { label: body.label.trim() } : {}),
      ...(body.required !== undefined ? { required: body.required } : {}),
      ...(body.options !== undefined ? { options: body.options.length ? JSON.stringify(body.options) : null } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
      ...(body.order !== undefined ? { order: body.order } : {}),
    },
  });
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "UPDATE", entityType: "custom_field", entityId: field.id });
  return ok({ success: true });
});

// ---- Delete field ----
export const DELETE = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  requireRole(ctx, "OWNER", "ADMIN");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return ok({ error: "BAD_REQUEST" }, 400);
  const field = await db.customField.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!field) return ok({ error: "NOT_FOUND" }, 404);
  await db.customField.delete({ where: { id } }); // values cascade
  await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "DELETE", entityType: "custom_field", entityId: id });
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
void saveCustomFieldValues;
