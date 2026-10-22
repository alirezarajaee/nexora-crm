import { db } from "@/lib/db";
import { z } from "zod";
import { handler, ok, parseBody, requireWorkspaceFromBody } from "@/lib/server/api";
import { CSV_SCHEMAS } from "@/lib/server/csv";
import { audit, createActivity } from "@/lib/server/activity";
import { runAutomations } from "@/lib/server/automation";

type Params = { params: Promise<{ entity: string }> };

const confirmSchema = z.object({
  workspaceId: z.string().min(1),
  mapping: z.record(z.string(), z.string()),
  rows: z.array(z.array(z.string())).max(1000),
  skipDuplicates: z.boolean().default(true),
});

/** POST /api/v1/csv/import/confirm/[entity] — execute the import. */
export const POST = handler(async (req: Request, { params }: Params) => {
  const { entity } = await params;
  const schema = CSV_SCHEMAS[entity];
  if (!schema) {
    return ok({ error: "NOT_FOUND" }, 404);
  }
  const body = await parseBody(req, confirmSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);
  const fieldKeys = new Set(schema.columns.map((c) => c.key));

  let imported = 0;
  let skipped = 0;
  let failed = 0;

  const existingEmails = new Set<string>();
  if (body.skipDuplicates) {
    if (entity === "contacts") {
      const rows = await db.contact.findMany({ where: { workspaceId: ctx.workspaceId }, select: { email: true } });
      for (const r of rows) if (r.email) existingEmails.add(r.email.toLowerCase());
    } else if (entity === "leads") {
      const rows = await db.lead.findMany({ where: { workspaceId: ctx.workspaceId }, select: { email: true } });
      for (const r of rows) if (r.email) existingEmails.add(r.email.toLowerCase());
    } else if (entity === "companies") {
      const rows = await db.company.findMany({ where: { workspaceId: ctx.workspaceId }, select: { name: true } });
      for (const r of rows) existingEmails.add(r.name.toLowerCase());
    }
  }

  for (const row of body.rows) {
    try {
      const record: Record<string, string | null> = {};
      for (const [colIdx, fieldKey] of Object.entries(body.mapping)) {
        if (!fieldKey || !fieldKeys.has(fieldKey)) continue;
        const value = row[Number(colIdx)] ?? "";
        record[fieldKey] = value.trim() === "" ? null : value.trim();
      }
      if (!record.name || record.name.trim() === "") {
        skipped += 1;
        continue;
      }
      // Mirror preview validation: invalid emails must not be imported
      if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
        failed += 1;
        continue;
      }
      // Enum coercion — mirrors the preview route exactly, so rows shown as
      // valid in preview behave identically at confirm time (no garbage stored).
      const SOURCES = ["WEBSITE", "REFERRAL", "SOCIAL", "CAMPAIGN", "DIRECT", "OTHER"];
      const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED"];
      const PRIORITIES = ["LOW", "MEDIUM", "HIGH"];
      if (record.source && !SOURCES.includes(record.source)) record.source = "OTHER";
      if (record.status && !STATUSES.includes(record.status)) record.status = "NEW";
      if (record.priority && !PRIORITIES.includes(record.priority)) record.priority = "MEDIUM";
      let estimatedValue: number | null = null;
      if (record.estimatedValue) {
        const n = Number(record.estimatedValue);
        if (!Number.isFinite(n) || n < 0) { failed += 1; continue; }
        estimatedValue = n;
      }
      const emailKey = (record.email ?? record.name ?? "").toLowerCase();
      if (body.skipDuplicates && record.email && existingEmails.has(emailKey)) {
        skipped += 1;
        continue;
      }

      if (entity === "contacts") {
        await db.contact.create({
          data: {
            workspaceId: ctx.workspaceId,
            name: record.name.slice(0, 120),
            email: record.email || null,
            phone: record.phone || null,
            jobTitle: record.jobTitle || null,
            notes: record.notes || null,
            ownerId: ctx.user.id,
          },
        });
      } else if (entity === "leads") {
        const lead = await db.lead.create({
          data: {
            workspaceId: ctx.workspaceId,
            name: record.name.slice(0, 120),
            email: record.email || null,
            phone: record.phone || null,
            companyName: record.companyName || null,
            jobTitle: record.jobTitle || null,
            source: record.source || null,
            status: record.status || "NEW",
            priority: record.priority || "MEDIUM",
            estimatedValue,
            notes: record.notes || null,
            ownerId: ctx.user.id,
          },
        });
        await runAutomations({
          workspaceId: ctx.workspaceId,
          trigger: "LEAD_CREATED",
          entityType: "lead",
          entity: { ...lead, title: lead.name },
          actorId: ctx.user.id,
        });
      } else if (entity === "companies") {
        await db.company.create({
          data: {
            workspaceId: ctx.workspaceId,
            name: record.name.slice(0, 120),
            website: record.website || null,
            industry: record.industry || null,
            size: record.size || null,
            phone: record.phone || null,
            country: record.country || null,
            notes: record.notes || null,
            ownerId: ctx.user.id,
          },
        });
      }
      if (record.email) existingEmails.add(emailKey);
      imported += 1;
    } catch {
      failed += 1;
    }
  }

  await audit({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    action: "IMPORT",
    entityType: entity,
    detail: { imported, skipped, failed },
  });
  await createActivity({
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    type: "SYSTEM",
    title: "CSV_IMPORT",
    metadata: { entity, imported, skipped, failed },
  });

  return ok({ imported, skipped, failed });
});

export const dynamic = "force-dynamic";
