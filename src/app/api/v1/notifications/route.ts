import { db } from "@/lib/db";
import { handler, ok, requireWorkspace, urlToFilters } from "@/lib/server/api";
import type { NotificationItem } from "@/types/api";

export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const unreadOnly = urlToFilters(req).get("unread") === "true";
  const notifications = await db.notification.findMany({
    where: { workspaceId: ctx.workspaceId, userId: ctx.user.id, ...(unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  const unreadCount = await db.notification.count({
    where: { workspaceId: ctx.workspaceId, userId: ctx.user.id, readAt: null },
  });
  return ok({
    items: notifications.map(
      (n): NotificationItem => ({
        id: n.id,
        type: n.type as NotificationItem["type"],
        title: n.title,
        body: n.body,
        link: n.link,
        readAt: n.readAt ? n.readAt.toISOString() : null,
        createdAt: n.createdAt.toISOString(),
      })
    ),
    unreadCount,
  });
});

// Mark read: { id } or { all: true }
export const POST = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  let body: { id?: string; all?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    // treat as mark-all
  }
  if (body.all) {
    await db.notification.updateMany({
      where: { workspaceId: ctx.workspaceId, userId: ctx.user.id, readAt: null },
      data: { readAt: new Date() },
    });
    return ok({ success: true });
  }
  if (body.id) {
    await db.notification.updateMany({
      where: { id: body.id, workspaceId: ctx.workspaceId, userId: ctx.user.id },
      data: { readAt: new Date() },
    });
  }
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
