import { db } from "@/lib/db";
import { fail, handler, ok, requireWorkspaceFromBody } from "@/lib/server/api";
import { hashPassword } from "@/lib/server/auth";

const DEMO_EMAIL = "demo@nexora.app";
export const DEMO_PASSWORD = "nexora-demo";

function daysFromNow(n: number, hour = 10): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** POST /api/v1/dev/seed — explicit demo-data creation.
 * Creates the demo account + a demo workspace IF the demo email is not taken.
 * Never touches existing workspaces or records.
 * DISABLED in production (NODE_ENV=production): an unauthenticated endpoint
 * that provisions accounts must never be reachable in a real deployment. */
export const POST = handler(async (req) => {
  if (process.env.NODE_ENV === "production") {
    return fail(404, "NOT_FOUND", "Demo seeding is disabled in production.");
  }

  let body: { workspaceId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // anonymous seeding is allowed (used from auth screens)
  }

  const existing = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    // If a signed-in user called seed, attach nothing; just report existence.
    return ok({
      created: false,
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      message: "DEMO_EXISTS",
    });
  }

  const user = await db.user.create({
    data: {
      email: DEMO_EMAIL,
      name: "Demo User",
      passwordHash: hashPassword(DEMO_PASSWORD),
      locale: "fa",
    },
  });

  const workspace = await db.workspace.create({
    data: {
      name: "NEXORA Demo",
      ownerId: user.id,
      currency: "USD",
      memberships: { create: { userId: user.id, role: "OWNER" } },
      pipelines: {
        create: {
          name: "Sales Pipeline",
          isDefault: true,
          stages: {
            create: [
              { key: "qualification", name: "ارزیابی", order: 1, probability: 10, type: "OPEN" },
              { key: "discovery", name: "کشف نیاز", order: 2, probability: 25, type: "OPEN" },
              { key: "proposal", name: "پیشنهاد", order: 3, probability: 50, type: "OPEN" },
              { key: "negotiation", name: "مذاکره", order: 4, probability: 75, type: "OPEN" },
              { key: "won", name: "برده‌شده", order: 5, probability: 100, type: "WON" },
              { key: "lost", name: "باخته‌شده", order: 6, probability: 0, type: "LOST" },
            ],
          },
        },
      },
    },
  });

  const stages = await db.stage.findMany({ where: { pipelineId: (await db.pipeline.findFirstOrThrow({ where: { workspaceId: workspace.id } })).id } });
  const stageByKey = new Map(stages.map((s) => [s.key, s]));

  // --- Companies ---
  const companyData = [
    { name: "Rahpardaz Tech", industry: "Software", size: "10-50", country: "Iran", website: "https://rahpardaz.example.com" },
    { name: "Aseman Logistics", industry: "Logistics", size: "50-200", country: "Iran", website: "https://aseman.example.com" },
    { name: "Dena Studio", industry: "Design", size: "1-10", country: "Iran", website: "https://dena.example.com" },
    { name: "Kavir Energy", industry: "Energy", size: "200+", country: "Iran", website: "https://kavir.example.com" },
    { name: "Boom Retail", industry: "Retail", size: "50-200", country: "Iran", website: "https://boom.example.com" },
  ];
  const companies: { id: string; name: string }[] = [];
  for (const c of companyData) {
    const created = await db.company.create({
      data: { workspaceId: workspace.id, ...c, ownerId: user.id, source: "WEBSITE" },
    });
    companies.push({ id: created.id, name: created.name });
  }

  // --- Contacts ---
  const contactData = [
    { name: "Sara Ahmadi", email: "sara.ahmadi@rahpardaz.example.com", jobTitle: "CTO", companyIdx: 0, nextFollowUp: -2 },
    { name: "Ali Moradi", email: "ali.moradi@aseman.example.com", jobTitle: "Operations Manager", companyIdx: 1, nextFollowUp: 1 },
    { name: "Neda Hosseini", email: "neda@dena.example.com", jobTitle: "Founder", companyIdx: 2, nextFollowUp: 0 },
    { name: "Reza Karimi", email: "reza.karimi@kavir.example.com", jobTitle: "IT Director", companyIdx: 3, nextFollowUp: 3 },
    { name: "Mina Sadeghi", email: "mina.sadeghi@boom.example.com", jobTitle: "Head of Product", companyIdx: 4, nextFollowUp: null },
    { name: "Hamed Nabavi", email: "hamed@freelance.example.com", jobTitle: "Consultant", companyIdx: null, nextFollowUp: -6 },
  ];
  const contacts: { id: string; name: string }[] = [];
  for (const c of contactData) {
    const created = await db.contact.create({
      data: {
        workspaceId: workspace.id,
        name: c.name,
        email: c.email,
        phone: "+98 912 000 0000",
        jobTitle: c.jobTitle,
        companyId: c.companyIdx !== null ? companies[c.companyIdx].id : null,
        ownerId: user.id,
        nextFollowUpAt: c.nextFollowUp !== null ? daysFromNow(c.nextFollowUp, 12) : null,
        lastContactedAt: daysFromNow(-3, 15),
      },
    });
    contacts.push({ id: created.id, name: created.name });
  }

  // --- Leads (varied statuses/sources, some radar-triggering) ---
  const leadData = [
    { name: "Farhad Rahimi", email: "farhad@startup1.example.com", companyName: "Startup One", source: "WEBSITE", status: "NEW", priority: "HIGH", value: 8000, lastActivityDays: -9, followUp: 2 },
    { name: "Leila Ahmadi", email: "leila@agency2.example.com", companyName: "Agency Two", source: "REFERRAL", status: "CONTACTED", priority: "MEDIUM", value: 3500, lastActivityDays: -2, followUp: 1 },
    { name: "Kian Zare", email: "kian@corp3.example.com", companyName: "Corp Three", source: "CAMPAIGN", status: "QUALIFIED", priority: "HIGH", value: 15000, lastActivityDays: -1, followUp: 4 },
    { name: "Parisa Nouri", email: "parisa@shop4.example.com", companyName: "Shop Four", source: "SOCIAL", status: "NEW", priority: "LOW", value: 1200, lastActivityDays: -4, followUp: null },
    { name: "Omid Tabatabaei", email: "omid@tech5.example.com", companyName: "Tech Five", source: "DIRECT", status: "CONTACTED", priority: "MEDIUM", value: 6000, lastActivityDays: -12, followUp: null },
    { name: "Shirin Gholami", email: "shirin@media6.example.com", companyName: "Media Six", source: "WEBSITE", status: "DISQUALIFIED", priority: "LOW", value: null, lastActivityDays: -20, followUp: null, disqualificationReason: "Budget too small" },
    { name: "Arman Rasti", email: "arman@soft7.example.com", companyName: "Soft Seven", source: "REFERRAL", status: "QUALIFIED", priority: "HIGH", value: null, lastActivityDays: -3, followUp: null },
  ];
  const leads: { id: string; name: string; status: string }[] = [];
  for (const l of leadData) {
    const created = await db.lead.create({
      data: {
        workspaceId: workspace.id,
        name: l.name,
        email: l.email,
        phone: "+98 913 000 0000",
        companyName: l.companyName,
        jobTitle: "Manager",
        source: l.source as "WEBSITE",
        status: l.status as "NEW",
        priority: l.priority as "HIGH",
        estimatedValue: l.value,
        ownerId: user.id,
        lastActivityAt: daysFromNow(l.lastActivityDays, 14),
        nextFollowUpAt: l.followUp !== null ? daysFromNow(l.followUp, 9) : null,
        disqualificationReason: l.disqualificationReason ?? null,
        createdAt: daysFromNow(l.lastActivityDays - 2),
      },
    });
    leads.push({ id: created.id, name: created.name, status: created.status });
    await db.activity.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        type: "SYSTEM",
        title: "LEAD_CREATED",
        leadId: created.id,
        createdAt: daysFromNow(l.lastActivityDays - 2),
        metadata: JSON.stringify({ name: created.name }),
      },
    });
    if (l.status !== "NEW") {
      await db.activity.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          type: "CALL",
          title: "Intro call",
          content: "Discussed requirements and next steps.",
          leadId: created.id,
          createdAt: daysFromNow(l.lastActivityDays, 11),
        },
      });
    }
  }

  // --- Deals across stages (incl. radar triggers, won/lost history) ---
  const dealData: { title: string; stageKey: string; value: number; contactIdx: number | null; companyIdx: number | null; expected: number; stageEnteredDays: number; lastActivityDays: number; priority: string; closed?: boolean; lostReason?: string }[] = [
    { title: "Rahpardaz — Platform Redesign", stageKey: "proposal", value: 12000, contactIdx: 0, companyIdx: 0, expected: 10, stageEnteredDays: -20, lastActivityDays: -8, priority: "HIGH" },
    { title: "Aseman — Fleet Dashboard", stageKey: "discovery", value: 24000, contactIdx: 1, companyIdx: 1, expected: 25, stageEnteredDays: -5, lastActivityDays: -2, priority: "MEDIUM" },
    { title: "Dena — Brand & Website", stageKey: "negotiation", value: 8500, contactIdx: 2, companyIdx: 2, expected: 5, stageEnteredDays: -18, lastActivityDays: -9, priority: "HIGH" },
    { title: "Kavir — IoT Monitoring", stageKey: "qualification", value: 45000, contactIdx: 3, companyIdx: 3, expected: 40, stageEnteredDays: -3, lastActivityDays: -1, priority: "MEDIUM" },
    { title: "Boom — Loyalty App Phase 1", stageKey: "proposal", value: 18000, contactIdx: 4, companyIdx: 4, expected: 14, stageEnteredDays: -10, lastActivityDays: -6, priority: "MEDIUM" },
    { title: "Hamed — Advisory Retainer", stageKey: "won", value: 6000, contactIdx: 5, companyIdx: null, expected: -5, stageEnteredDays: -12, lastActivityDays: -12, priority: "LOW", closed: true },
    { title: "Startup One — MVP Build", stageKey: "won", value: 9500, contactIdx: null, companyIdx: 0, expected: -12, stageEnteredDays: -25, lastActivityDays: -14, priority: "HIGH", closed: true },
    { title: "Shop Four — E-commerce Audit", stageKey: "lost", value: 3000, contactIdx: null, companyIdx: 4, expected: -8, stageEnteredDays: -16, lastActivityDays: -16, priority: "LOW", closed: true, lostReason: "Chose a cheaper vendor" },
  ];
  for (const d of dealData) {
    const stage = stageByKey.get(d.stageKey);
    if (!stage) continue;
    const created = await db.deal.create({
      data: {
        workspaceId: workspace.id,
        pipelineId: stage.pipelineId,
        stageId: stage.id,
        title: d.title,
        contactId: d.contactIdx !== null ? contacts[d.contactIdx].id : null,
        companyId: d.companyIdx !== null ? companies[d.companyIdx].id : null,
        value: d.value,
        currency: "USD",
        probability: stage.probability,
        ownerId: user.id,
        expectedCloseDate: daysFromNow(d.expected),
        actualCloseDate: d.closed ? daysFromNow(d.expected, 17) : null,
        source: "WEBSITE",
        priority: d.priority as "HIGH",
        stageEnteredAt: daysFromNow(d.stageEnteredDays),
        lastActivityAt: daysFromNow(d.lastActivityDays, 16),
        createdAt: daysFromNow(d.stageEnteredDays - 5),
        lostReason: d.lostReason ?? null,
      },
    });
    await db.activity.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        type: "SYSTEM",
        title: "DEAL_CREATED",
        dealId: created.id,
        createdAt: daysFromNow(d.stageEnteredDays - 5),
        metadata: JSON.stringify({ title: created.title }),
      },
    });
    if (d.stageKey !== "qualification") {
      await db.activity.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          type: "STAGE_CHANGE",
          title: "STAGE_CHANGED",
          dealId: created.id,
          createdAt: daysFromNow(d.stageEnteredDays, 13),
          metadata: JSON.stringify({ to: stage.name }),
        },
      });
    }
    await db.activity.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        type: "MEETING",
        title: "Scope meeting",
        content: "Reviewed scope and timeline with the client.",
        dealId: created.id,
        contactId: d.contactIdx !== null ? contacts[d.contactIdx].id : null,
        createdAt: daysFromNow(d.lastActivityDays, 15),
      },
    });
  }

  // --- Tasks (overdue / today / upcoming / done) ---
  const taskData: { title: string; dueDays: number; priority: string; status: string; dealIdx?: number; contactIdx?: number; leadIdx?: number; recurrence?: string }[] = [
    { title: "Send proposal to Dena Studio", dueDays: -3, priority: "HIGH", dealIdx: 2, status: "OPEN" },
    { title: "Call Sara about platform redesign", dueDays: -1, priority: "HIGH", dealIdx: 0, contactIdx: 0, status: "OPEN" },
    { title: "Prepare discovery questions for Aseman", dueDays: 0, priority: "MEDIUM", dealIdx: 1, status: "OPEN" },
    { title: "Follow up with Farhad Rahimi", dueDays: 0, priority: "MEDIUM", leadIdx: 0, status: "OPEN" },
    { title: "Draft IoT requirements doc", dueDays: 3, priority: "MEDIUM", dealIdx: 3, status: "OPEN" },
    { title: "Quarterly report preparation", dueDays: 6, priority: "LOW", status: "OPEN" },
    { title: "Kickoff meeting notes for Boom", dueDays: -2, priority: "MEDIUM", dealIdx: 4, status: "DONE" },
    { title: "Send contract to Hamed", dueDays: -10, priority: "HIGH", dealIdx: 5, status: "DONE" },
    { title: "Weekly pipeline review", dueDays: 1, priority: "LOW", recurrence: "WEEKLY", status: "OPEN" },
  ];
  for (const t of taskData) {
    await db.task.create({
      data: {
        workspaceId: workspace.id,
        title: t.title,
        priority: t.priority as "HIGH",
        status: t.status as "OPEN",
        dueAt: daysFromNow(t.dueDays, 12),
        assigneeId: user.id,
        dealId: t.dealIdx !== undefined && t.dealIdx !== null ? (await db.deal.findFirstOrThrow({ where: { workspaceId: workspace.id, title: dealData[t.dealIdx].title } })).id : null,
        contactId: t.contactIdx !== undefined && t.contactIdx !== null ? contacts[t.contactIdx].id : null,
        leadId: t.leadIdx !== undefined && t.leadIdx !== null ? leads[t.leadIdx].id : null,
        recurrence: t.recurrence ?? null,
        completedAt: t.status === "DONE" ? daysFromNow(t.dueDays, 18) : null,
      },
    });
  }

  // --- Tags ---
  const tags = [
    { name: "priority-client", color: "#8B5CF6" },
    { name: "retainer", color: "#22D3EE" },
    { name: "follow-up-needed", color: "#F59E0B" },
  ];
  const tagIds: string[] = [];
  for (const tg of tags) {
    const tag = await db.tag.create({ data: { workspaceId: workspace.id, ...tg } });
    tagIds.push(tag.id);
  }
  await db.tagRelation.create({ data: { workspaceId: workspace.id, tagId: tagIds[0], entityType: "deal", entityId: (await db.deal.findFirstOrThrow({ where: { title: "Kavir — IoT Monitoring" } })).id } });
  await db.tagRelation.create({ data: { workspaceId: workspace.id, tagId: tagIds[2], entityType: "contact", entityId: contacts[5].id } });

  return ok({
    created: true,
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
    workspaceId: workspace.id,
  });
});

export const GET = handler(async () => {
  return fail(405, "METHOD_NOT_ALLOWED", "Use POST.");
});

export const dynamic = "force-dynamic";
