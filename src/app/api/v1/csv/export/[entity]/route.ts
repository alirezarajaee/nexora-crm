import { db } from "@/lib/db";
import { csvResponse, toCsv } from "@/lib/server/csv";
import { boolParam, csvParam, handler, ok, requireWorkspace, urlToFilters } from "@/lib/server/api";
import { audit } from "@/lib/server/activity";

type Params = { params: Promise<{ entity: string }> };

function safeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

export const GET = handler(async (req: Request, { params }: Params) => {
  const { entity } = await params;
  const ctx = await requireWorkspace(req);
  const sp = urlToFilters(req);

  if (entity === "contacts") {
    const archived = boolParam(sp, "archived", false);
    const ownerIds = csvParam(sp, "ownerId");
    const q = sp.get("q")?.trim();
    const rows = await db.contact.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        archived,
        ...(ownerIds.length ? { ownerId: { in: ownerIds } } : {}),
        ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }] } : {}),
      },
      include: { company: { select: { name: true } }, owner: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    const csv = toCsv([
      ["Name", "Email", "Phone", "Job Title", "Company", "Owner", "Notes", "Created"],
      ...rows.map((r) => [
        safeCell(r.name), safeCell(r.email), safeCell(r.phone), safeCell(r.jobTitle),
        safeCell(r.company?.name), safeCell(r.owner?.name), safeCell(r.notes), safeCell(r.createdAt),
      ]),
    ]);
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "EXPORT", entityType: "contact", detail: { count: rows.length } });
    return csvResponse("nexora-contacts.csv", csv);
  }

  if (entity === "leads") {
    const archived = boolParam(sp, "archived", false);
    const statuses = csvParam(sp, "status");
    const ownerIds = csvParam(sp, "ownerId");
    const q = sp.get("q")?.trim();
    const rows = await db.lead.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        archived,
        ...(statuses.length ? { status: { in: statuses } } : {}),
        ...(ownerIds.length ? { ownerId: { in: ownerIds } } : {}),
        ...(q ? { OR: [{ name: { contains: q } }, { email: { contains: q } }, { companyName: { contains: q } }] } : {}),
      },
      include: { owner: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    const csv = toCsv([
      ["Name", "Email", "Phone", "Company", "Job Title", "Source", "Status", "Priority", "Estimated Value", "Owner", "Notes", "Created"],
      ...rows.map((r) => [
        safeCell(r.name), safeCell(r.email), safeCell(r.phone), safeCell(r.companyName), safeCell(r.jobTitle),
        safeCell(r.source), safeCell(r.status), safeCell(r.priority), safeCell(r.estimatedValue),
        safeCell(r.owner?.name), safeCell(r.notes), safeCell(r.createdAt),
      ]),
    ]);
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "EXPORT", entityType: "lead", detail: { count: rows.length } });
    return csvResponse("nexora-leads.csv", csv);
  }

  if (entity === "companies") {
    const archived = boolParam(sp, "archived", false);
    const q = sp.get("q")?.trim();
    const rows = await db.company.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        archived,
        ...(q ? { OR: [{ name: { contains: q } }, { industry: { contains: q } }] } : {}),
      },
      include: { owner: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
    const csv = toCsv([
      ["Name", "Website", "Industry", "Size", "Phone", "Country", "Owner", "Notes", "Created"],
      ...rows.map((r) => [
        safeCell(r.name), safeCell(r.website), safeCell(r.industry), safeCell(r.size), safeCell(r.phone),
        safeCell(r.country), safeCell(r.owner?.name), safeCell(r.notes), safeCell(r.createdAt),
      ]),
    ]);
    await audit({ workspaceId: ctx.workspaceId, userId: ctx.user.id, action: "EXPORT", entityType: "company", detail: { count: rows.length } });
    return csvResponse("nexora-companies.csv", csv);
  }

  return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Unknown entity." } }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
});

export const dynamic = "force-dynamic";
