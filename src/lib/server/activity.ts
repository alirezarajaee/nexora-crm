import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

// ---- Activity + audit + notification helpers (workspace-scoped) ----

export interface CreateActivityInput {
  workspaceId: string;
  userId: string;
  type: string;
  title: string;
  content?: string | null;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  leadId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function createActivity(input: CreateActivityInput) {
  return db.activity.create({
    data: {
      workspaceId: input.workspaceId,
      userId: input.userId,
      type: input.type,
      title: input.title,
      content: input.content ?? null,
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      dealId: input.dealId ?? null,
      leadId: input.leadId ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

export interface AuditInput {
  workspaceId: string;
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  detail?: Record<string, unknown> | null;
}

export async function audit(input: AuditInput) {
  await db.auditLog
    .create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId ?? null,
        detail: input.detail ? JSON.stringify(input.detail) : null,
      },
    })
    .catch(() => {});
}

export interface NotifyInput {
  workspaceId: string;
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  dedupeKey?: string | null;
}

export async function notify(input: NotifyInput) {
  if (!input.dedupeKey) {
    await db.notification.create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
      },
    });
    return;
  }
  // Idempotent notification creation (dedupe per workspace+user+key)
  await db.notification
    .create({
      data: {
        workspaceId: input.workspaceId,
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        link: input.link ?? null,
        dedupeKey: input.dedupeKey,
      },
    })
    .catch((err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
      throw err;
    });
}
