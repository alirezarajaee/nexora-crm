import { z } from "zod";
import { db } from "@/lib/db";
import {
  fail,
  handler,
  ok,
  parseBody,
  requireWorkspace,
  requireWorkspaceFromBody,
  requireRole,
} from "@/lib/server/api";
import { audit, notify } from "@/lib/server/activity";
import { hashPassword, rateLimit } from "@/lib/server/auth";

// ---- List members ----
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const memberships = await db.membership.findMany({
    where: { workspaceId: ctx.workspaceId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return ok(
    memberships.map((m) => ({
      membershipId: m.id,
      userId: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      createdAt: m.createdAt.toISOString(),
    }))
  );
});

// ---- Add member ----
/**
 * Account-provisioning flow (NO email delivery is configured).
 *
 * Security posture (see README → “Email-dependent account flows”):
 * - Administrator-only alternative: requires an authenticated session with
 *   the OWNER or ADMIN role of the target workspace.
 * - The temporary password is CHOSEN BY THE ADMIN in this request — the
 *   server never generates one, so no credential is ever created by or
 *   returned from this endpoint. The response contains only membership data.
 * - If the email already belongs to an existing user, the submitted password
 *   is IGNORED: their credentials are never modified by an invite.
 * - No email is sent and none is claimed to be sent; the invited user sees an
 *   in-app notification only. The UI labels the field “Temporary password”.
 * - Throttled per workspace (defense-in-depth against a compromised admin
 *   token bulk-provisioning accounts).
 * A real invitation-by-email flow must be built on a configured email
 * provider before this endpoint could move away from direct provisioning.
 */
const addSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(2).max(80),
  email: z.string().email().max(160),
  password: z.string().min(8).max(128),
  role: z.enum(["ADMIN", "MEMBER"]).default("MEMBER"),
});

export const POST = handler(async (req) => {
  const body = await parseBody(req, addSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);
  requireRole(ctx, "OWNER", "ADMIN");
  // Rate limit only AFTER authorization — low-privilege callers must not
  // consume the bucket; authorized callers are still bounded.
  if (!rateLimit(`invite:${ctx.workspaceId}`, 30, 5 * 60 * 1000)) {
    return fail(429, "RATE_LIMITED", "Too many member operations. Try again later.");
  }

  const email = body.email.toLowerCase().trim();
  const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });

  let user = await db.user.findUnique({ where: { email } });
  if (!user) {
    user = await db.user.create({
      data: { name: body.name.trim(), email, passwordHash: hashPassword(body.password) },
    });
  } else {
    const existingMembership = await db.membership.findUnique({
      where: { userId_workspaceId: { userId: user.id, workspaceId: ctx.workspaceId } },
    });
    if (existingMembership) {
      return fail(409, "ALREADY_MEMBER", "This user is already a member.");
    }
  }

  const membership = await db.membership.create({
    data: { userId: user.id, workspaceId: ctx.workspaceId, role: body.role },
  });

  await notify({
    workspaceId: ctx.workspaceId,
    userId: user.id,
    type: "SYSTEM",
    title: ws.name,
    body: "MEMBERSHIP_ADDED",
    link: "overview",
  });

  await audit({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    action: "CREATE",
    entityType: "membership",
    entityId: membership.id,
    detail: { email, role: body.role },
  });

  return ok(
    {
      membershipId: membership.id,
      userId: user.id,
      name: user.name,
      email: user.email,
      role: membership.role,
      createdAt: membership.createdAt.toISOString(),
    },
    201
  );
});

// ---- Change member role ----
const patchSchema = z.object({
  workspaceId: z.string().min(1),
  userId: z.string().min(1),
  role: z.enum(["ADMIN", "MEMBER"]),
});

export const PATCH = handler(async (req) => {
  const body = await parseBody(req, patchSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);
  requireRole(ctx, "OWNER", "ADMIN");

  const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
  if (body.userId === ws.ownerId) {
    return fail(400, "CANNOT_CHANGE_OWNER", "The workspace owner's role cannot be changed.");
  }
  // Hierarchy guard: only the OWNER may change another ADMIN's role.
  const targetMembership = await db.membership.findUnique({
    where: { userId_workspaceId: { userId: body.userId, workspaceId: ctx.workspaceId } },
  });
  if (!targetMembership) return fail(404, "NOT_FOUND", "Member not found.");
  if (ctx.role === "ADMIN" && targetMembership.role === "ADMIN") {
    return fail(403, "FORBIDDEN", "Only the workspace owner can change another admin's role.");
  }
  const membership = await db.membership.update({
    where: { userId_workspaceId: { userId: body.userId, workspaceId: ctx.workspaceId } },
    data: { role: body.role },
  });
  await audit({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    action: "UPDATE",
    entityType: "membership",
    entityId: membership.id,
    detail: { role: body.role },
  });
  return ok({ success: true, role: membership.role });
});

// ---- Remove member ----
export const DELETE = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  requireRole(ctx, "OWNER", "ADMIN");
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return fail(400, "BAD_REQUEST", "userId is required.");

  const ws = await db.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId } });
  if (userId === ws.ownerId) {
    return fail(400, "CANNOT_REMOVE_OWNER", "The workspace owner cannot be removed.");
  }
  // Hierarchy guard: only the OWNER may remove another ADMIN.
  const targetMembership = await db.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: ctx.workspaceId } },
  });
  if (!targetMembership) return fail(404, "NOT_FOUND", "Member not found.");
  if (ctx.role === "ADMIN" && targetMembership.role === "ADMIN") {
    return fail(403, "FORBIDDEN", "Only the workspace owner can remove another admin.");
  }

  await db.membership.deleteMany({ where: { userId, workspaceId: ctx.workspaceId } });
  await audit({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    action: "DELETE",
    entityType: "membership",
    entityId: userId,
  });
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
