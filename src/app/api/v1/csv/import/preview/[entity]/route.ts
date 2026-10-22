import { db } from "@/lib/db";
import { z } from "zod";
import { handler, ok, parseBody, requireWorkspaceFromBody } from "@/lib/server/api";
import { CSV_SCHEMAS } from "@/lib/server/csv";

type Params = { params: Promise<{ entity: string }> };

const importSchema = z.object({
  workspaceId: z.string().min(1),
  mapping: z.record(z.string(), z.string()), // csv column index -> fieldKey | ""
  rows: z.array(z.array(z.string())).max(1000), // parsed data rows (no header)
  skipDuplicates: z.boolean().default(true),
});

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[,،\s]/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** POST /api/v1/csv/import/preview/[entity] — validate rows, report errors & duplicates. */
export const POST = handler(async (req: Request, { params }: Params) => {
  const { entity } = await params;
  const schema = CSV_SCHEMAS[entity];
  if (!schema) {
    return ok({ error: "NOT_FOUND" }, 404);
  }
  const body = await parseBody(req, importSchema);
  const ctx = await requireWorkspaceFromBody(req, body.workspaceId);

  const fieldKeys = new Set(schema.columns.map((c) => c.key));
  const errors: { row: number; error: string; field?: string }[] = [];
  const valid: Record<string, string | null>[] = [];
  const duplicates: number[] = [];

  const existingEmails = new Set<string>();
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

  body.rows.forEach((row, index) => {
    const record: Record<string, string | null> = {};
    for (const [colIdx, fieldKey] of Object.entries(body.mapping)) {
      if (!fieldKey || !fieldKeys.has(fieldKey)) continue;
      const value = row[Number(colIdx)] ?? "";
      record[fieldKey] = value.trim() === "" ? null : value.trim();
    }

    const name = record.name;
    if (!name || name.trim() === "") {
      errors.push({ row: index, error: "MISSING:name", field: "name" });
      return;
    }
    if (record.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email)) {
      errors.push({ row: index, error: "INVALID:email", field: "email" });
      return;
    }
    if (entity === "leads") {
      if (record.source && !["WEBSITE", "REFERRAL", "SOCIAL", "CAMPAIGN", "DIRECT", "OTHER"].includes(record.source)) {
        record.source = "OTHER";
      }
      if (record.status && !["NEW", "CONTACTED", "QUALIFIED", "DISQUALIFIED", "CONVERTED"].includes(record.status)) {
        record.status = "NEW";
      }
      if (record.priority && !["LOW", "MEDIUM", "HIGH"].includes(record.priority)) {
        record.priority = "MEDIUM";
      }
      if (record.estimatedValue !== null && record.estimatedValue !== undefined) {
        const n = parseNumber(record.estimatedValue);
        if (n === null) {
          errors.push({ row: index, error: "INVALID:estimatedValue", field: "estimatedValue" });
          return;
        }
        record.estimatedValue = String(n);
      }
    }
    if (record.email && existingEmails.has(record.email.toLowerCase())) {
      duplicates.push(index);
    }
    valid.push(record);
  });

  return ok({
    valid,
    errors: errors.slice(0, 100),
    duplicates,
    totalRows: body.rows.length,
    validCount: valid.length,
    errorCount: errors.length,
    duplicateCount: duplicates.length,
  });
});

export const dynamic = "force-dynamic";
