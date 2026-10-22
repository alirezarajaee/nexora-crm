import { db } from "@/lib/db";
import { handler, ok, requireWorkspace, urlToFilters } from "@/lib/server/api";
import type { SearchResults } from "@/types/api";

// ---- Global search across leads/contacts/companies/deals/tasks (workspace-scoped) ----
export const GET = handler(async (req) => {
  const ctx = await requireWorkspace(req);
  const q = urlToFilters(req).get("q")?.trim() ?? "";
  if (q.length < 2) {
    return ok({ leads: [], contacts: [], companies: [], deals: [], tasks: [], total: 0 });
  }

  const [leads, contacts, companies, deals, tasks] = await Promise.all([
    db.lead.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        archived: false,
        OR: [{ name: { contains: q } }, { email: { contains: q } }, { companyName: { contains: q } }, { phone: { contains: q } }],
      },
      select: { id: true, name: true, companyName: true, email: true },
      take: 6,
    }),
    db.contact.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        archived: false,
        OR: [{ name: { contains: q } }, { email: { contains: q } }, { phone: { contains: q } }],
      },
      select: { id: true, name: true, company: { select: { name: true } }, email: true },
      take: 6,
    }),
    db.company.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        archived: false,
        OR: [{ name: { contains: q } }, { industry: { contains: q } }, { website: { contains: q } }],
      },
      select: { id: true, name: true, industry: true },
      take: 6,
    }),
    db.deal.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        archived: false,
        OR: [{ title: { contains: q } }, { description: { contains: q } }],
      },
      select: { id: true, title: true, stage: { select: { name: true } }, value: true },
      take: 6,
    }),
    db.task.findMany({
      where: { workspaceId: ctx.workspaceId, OR: [{ title: { contains: q } }, { description: { contains: q } }] },
      select: { id: true, title: true, status: true, dueAt: true },
      take: 6,
    }),
  ]);

  const results: SearchResults = {
    leads: leads.map((l) => ({ id: l.id, title: l.name, subtitle: l.companyName ?? l.email ?? null })),
    contacts: contacts.map((c) => ({ id: c.id, title: c.name, subtitle: c.company?.name ?? c.email ?? null })),
    companies: companies.map((c) => ({ id: c.id, title: c.name, subtitle: c.industry })),
    deals: deals.map((d) => ({ id: d.id, title: d.title, subtitle: d.stage?.name ?? null })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, subtitle: t.status })),
    total: leads.length + contacts.length + companies.length + deals.length + tasks.length,
  };
  return ok(results);
});

export const dynamic = "force-dynamic";
