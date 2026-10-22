import { z } from "zod";
import { db } from "@/lib/db";
import { handler, ok, parseBody, requireAuth, requireWorkspaceFromBody, requireRole } from "@/lib/server/api";
import { audit } from "@/lib/server/activity";

// ---- Create workspace ----
const createSchema = z.object({
  name: z.string().min(1).max(80),
  locale: z.enum(["fa", "en"]).optional(),
});

export const POST = handler(async (req) => {
  const user = await requireAuth();
  const body = await parseBody(req, createSchema);
  const locale = body.locale === "en" ? "en" : "fa";

  const workspace = await db.workspace.create({
    data: {
      name: body.name.trim(),
      ownerId: user.id,
      memberships: { create: { userId: user.id, role: "OWNER" } },
      pipelines: {
        create: {
          name: locale === "en" ? "Sales Pipeline" : "قیف فروش",
          isDefault: true,
          stages: {
            create: [
              { key: "qualification", name: locale === "en" ? "Qualification" : "ارزیابی", order: 1, probability: 10, type: "OPEN" },
              { key: "discovery", name: locale === "en" ? "Discovery" : "کشف نیاز", order: 2, probability: 25, type: "OPEN" },
              { key: "proposal", name: locale === "en" ? "Proposal" : "پیشنهاد", order: 3, probability: 50, type: "OPEN" },
              { key: "negotiation", name: locale === "en" ? "Negotiation" : "مذاکره", order: 4, probability: 75, type: "OPEN" },
              { key: "won", name: locale === "en" ? "Won" : "برده‌شده", order: 5, probability: 100, type: "WON" },
              { key: "lost", name: locale === "en" ? "Lost" : "باخته‌شده", order: 6, probability: 0, type: "LOST" },
            ],
          },
        },
      },
    },
  });

  await audit({
    workspaceId: workspace.id,
    userId: user.id,
    action: "CREATE",
    entityType: "workspace",
    detail: { name: workspace.name },
  });

  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  return ok(
    {
      workspaceId: workspace.id,
      memberships: memberships.map((m) => ({
        workspaceId: m.workspaceId,
        role: m.role,
        workspace: {
          id: m.workspace.id,
          name: m.workspace.name,
          currency: m.workspace.currency,
          timezone: m.workspace.timezone,
          ownerId: m.workspace.ownerId,
        },
      })),
    },
    201
  );
});

// ---- Update workspace settings (ADMIN/OWNER only) ----
const patchSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(80).optional(),
  currency: z.string().min(3).max(6).optional(),
  timezone: z.string().min(2).max(64).optional(),
  radarLeadInactivityDays: z.number().int().min(1).max(365).optional(),
  radarDealInactivityDays: z.number().int().min(1).max(365).optional(),
  radarStageInactivityDays: z.number().int().min(1).max(365).optional(),
  radarHighValueThreshold: z.number().min(0).max(1e12).optional(),
});

export const PATCH = handler(async (req) => {
  const body = await parseBody(req, patchSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);
  requireRole(ctx, "OWNER", "ADMIN");

  const { workspaceId, ...data } = body;
  const workspace = await db.workspace.update({
    where: { id: workspaceId },
    data,
  });
  await audit({
    workspaceId,
    userId: ctx.user.id,
    action: "UPDATE",
    entityType: "workspace",
    detail: data as Record<string, unknown>,
  });
  return ok({
    id: workspace.id,
    name: workspace.name,
    currency: workspace.currency,
    timezone: workspace.timezone,
    radarLeadInactivityDays: workspace.radarLeadInactivityDays,
    radarDealInactivityDays: workspace.radarDealInactivityDays,
    radarStageInactivityDays: workspace.radarStageInactivityDays,
    radarHighValueThreshold: workspace.radarHighValueThreshold,
  });
});

export const dynamic = "force-dynamic";
