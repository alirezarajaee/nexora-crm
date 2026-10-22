/**
 * Core business workflow tests — real handlers, real SQLite, real transactions.
 * Every workflow runs in a freshly registered workspace so assertions are
 * deterministic and never touch the development database.
 */
import { describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { callRoute, jsonBody, registerUser, type TestUser } from "./helpers";

import { POST as leadsPOST } from "@/app/api/v1/leads/route";
import { GET as leadGET, PATCH as leadPATCH } from "@/app/api/v1/leads/[id]/route";
import { POST as leadConvert } from "@/app/api/v1/leads/[id]/convert/route";
import { POST as dealsPOST } from "@/app/api/v1/deals/route";
import { GET as dealGET, PATCH as dealPATCH } from "@/app/api/v1/deals/[id]/route";
import { POST as tasksPOST } from "@/app/api/v1/tasks/route";
import { GET as taskGET, PATCH as taskPATCH } from "@/app/api/v1/tasks/[id]/route";
import { POST as activitiesPOST } from "@/app/api/v1/activities/route";
import { GET as dashboardGET } from "@/app/api/v1/dashboard/route";
import { GET as radarGET, POST as radarPOST } from "@/app/api/v1/radar/route";
import { GET as rulesGET, POST as rulesPOST } from "@/app/api/v1/automation/rules/route";
import { GET as executionsGET } from "@/app/api/v1/automation/executions/route";
import { GET as csvTemplate } from "@/app/api/v1/csv/template/[entity]/route";
import { POST as csvPreview } from "@/app/api/v1/csv/import/preview/[entity]/route";
import { POST as csvConfirm } from "@/app/api/v1/csv/import/confirm/[entity]/route";
import { GET as csvExport } from "@/app/api/v1/csv/export/[entity]/route";
import { POST as contactsPOST } from "@/app/api/v1/contacts/route";
import { GET as contactGET } from "@/app/api/v1/contacts/[id]/route";
import { POST as customFieldsPOST } from "@/app/api/v1/custom-fields/route";
import { GET as pipelinesGET } from "@/app/api/v1/pipelines/route";

const au = (u: TestUser) => ({ token: u.token, ip: u.ip });

async function freshWorkspace(prefix: string): Promise<TestUser> {
  return registerUser(prefix);
}

async function firstOpenStageId(u: TestUser): Promise<string> {
  const pipelines = (await jsonBody(
    await callRoute({ GET: pipelinesGET }, "GET", `/api/v1/pipelines?workspaceId=${u.workspaceId}`, au(u))
  )) as unknown as { stages: { id: string; type: string; order: number }[] }[];
  const stages = pipelines[0].stages
    .filter((s) => s.type === "OPEN")
    .sort((x, y) => x.order - y.order);
  return stages[0].id;
}

async function firstWonStageId(u: TestUser): Promise<string> {
  const pipelines = (await jsonBody(
    await callRoute({ GET: pipelinesGET }, "GET", `/api/v1/pipelines?workspaceId=${u.workspaceId}`, au(u))
  )) as unknown as { stages: { id: string; type: string }[] }[];
  return pipelines[0].stages.find((s) => s.type === "WON")!.id;
}

describe("workflow: lead lifecycle + conversion", () => {
  test("create → update → archive → restore → convert → 409 on re-convert", async () => {
    const u = await freshWorkspace("flow-lead");

    const created = (await jsonBody(
      await callRoute({ POST: leadsPOST }, "POST", "/api/v1/leads", {
        body: {
          workspaceId: u.workspaceId,
          name: "Ali Converter",
          email: `ali.${u.userId}@test.local`,
          estimatedValue: 1234.5,
        },
        ...au(u),
      })
    )) as { id: string; status: string };
    expect(created.status).toBe("NEW");

    // Update
    const patched = (await jsonBody(
      await callRoute({ PATCH: leadPATCH }, "PATCH", `/api/v1/leads/${created.id}`, {
        body: { workspaceId: u.workspaceId, status: "QUALIFIED" }, ...au(u),
      })
    )) as { status: string };
    expect(patched.status).toBe("QUALIFIED");

    // Archive + restore
    const archived = (await jsonBody(
      await callRoute({ PATCH: leadPATCH }, "PATCH", `/api/v1/leads/${created.id}`, {
        body: { workspaceId: u.workspaceId, archived: true }, ...au(u),
      })
    )) as { archived: boolean };
    expect(archived.archived).toBe(true);
    const restored = (await jsonBody(
      await callRoute({ PATCH: leadPATCH }, "PATCH", `/api/v1/leads/${created.id}`, {
        body: { workspaceId: u.workspaceId, archived: false }, ...au(u),
      })
    )) as { archived: boolean };
    expect(restored.archived).toBe(false);

    // Conversion (transactional, with deal)
    const conv = await callRoute({ POST: leadConvert }, "POST", `/api/v1/leads/${created.id}/convert`, {
      body: { workspaceId: u.workspaceId, createDeal: true, dealTitle: "Converted Deal", dealValue: 1234.5 },
      ...au(u),
    });
    expect(conv.status).toBe(200);
    const { contactId, dealId } = (await jsonBody(conv)) as { contactId: string; dealId: string };
    expect(contactId).toBeTruthy();
    expect(dealId).toBeTruthy();

    // Lead marked CONVERTED, links recorded
    const lead = (await jsonBody(
      await callRoute({ GET: leadGET }, "GET", `/api/v1/leads/${created.id}?workspaceId=${u.workspaceId}`, au(u))
    )) as { status: string; convertedContactId: string | null };
    expect(lead.status).toBe("CONVERTED");
    expect(lead.convertedContactId).toBe(contactId);

    // Contact carried over the fields
    const contact = (await jsonBody(
      await callRoute({ GET: contactGET }, "GET", `/api/v1/contacts/${contactId}?workspaceId=${u.workspaceId}`, au(u))
    )) as { email: string | null; name: string };
    expect(contact.name).toBe("Ali Converter");
    expect(contact.email).toBe(`ali.${u.userId}@test.local`);

    // Deal created in an OPEN stage with the requested value
    const deal = (await jsonBody(
      await callRoute({ GET: dealGET }, "GET", `/api/v1/deals/${dealId}?workspaceId=${u.workspaceId}`, au(u))
    )) as { value: number; stage: { type: string }; contactId: string | null };
    expect(deal.value).toBe(1234.5);
    expect(deal.stage.type).toBe("OPEN");
    expect(deal.contactId).toBe(contactId);

    // Conversion history recorded in activity timeline
    const leadActivities = await db.activity.findMany({
      where: { workspaceId: u.workspaceId, leadId: created.id, type: "CONVERSION" },
    });
    expect(leadActivities.length).toBe(1);

    // Re-conversion blocked with 409
    const again = await callRoute({ POST: leadConvert }, "POST", `/api/v1/leads/${created.id}/convert`, {
      body: { workspaceId: u.workspaceId, createDeal: false }, ...au(u),
    });
    expect(again.status).toBe(409);
  });
});

describe("workflow: deal stage changes persist", () => {
  test("open → won sets close date; won → open clears it; history logged", async () => {
    const u = await freshWorkspace("flow-deal");
    const deal = (await jsonBody(
      await callRoute({ POST: dealsPOST }, "POST", "/api/v1/deals", {
        body: { workspaceId: u.workspaceId, title: "Stage Deal", value: 999 }, ...au(u),
      })
    )) as { id: string };

    const wonStage = await firstWonStageId(u);
    const won = (await jsonBody(
      await callRoute({ PATCH: dealPATCH }, "PATCH", `/api/v1/deals/${deal.id}`, {
        body: { workspaceId: u.workspaceId, stageId: wonStage }, ...au(u),
      })
    )) as { actualCloseDate: string | null; stage: { type: string } };
    expect(won.stage.type).toBe("WON");
    expect(won.actualCloseDate).toBeTruthy();

    // Persisted after refetch
    const refetched = (await jsonBody(
      await callRoute({ GET: dealGET }, "GET", `/api/v1/deals/${deal.id}?workspaceId=${u.workspaceId}`, au(u))
    )) as { actualCloseDate: string | null; stageHistory: { type: string; metadata: string | null }[] };
    expect(refetched.actualCloseDate).toBeTruthy();
    const stageChange = refetched.stageHistory.find((h) => h.type === "STAGE_CHANGE");
    expect(stageChange).toBeTruthy();
    const meta = JSON.parse(stageChange!.metadata ?? "{}") as { toType?: string };
    expect(meta.toType).toBe("WON");

    // Back to OPEN → close date cleared
    const openStage = await firstOpenStageId(u);
    const reopened = (await jsonBody(
      await callRoute({ PATCH: dealPATCH }, "PATCH", `/api/v1/deals/${deal.id}`, {
        body: { workspaceId: u.workspaceId, stageId: openStage }, ...au(u),
      })
    )) as { actualCloseDate: string | null };
    expect(reopened.actualCloseDate).toBeNull();
  });
});

describe("workflow: task lifecycle + recurrence", () => {
  test("create → complete (spawns recurrence) → reopen", async () => {
    const u = await freshWorkspace("flow-task");

    const yesterday = new Date(Date.now() - 86400000);
    const created = (await jsonBody(
      await callRoute({ POST: tasksPOST }, "POST", "/api/v1/tasks", {
        body: {
          workspaceId: u.workspaceId,
          title: "Recurring follow-up",
          dueAt: yesterday.toISOString(),
          recurrence: "WEEKLY",
        },
        ...au(u),
      })
    )) as { id: string; status: string };
    expect(created.status).toBe("OPEN");

    // Complete → completedAt set + next occurrence spawned
    const done = (await jsonBody(
      await callRoute({ PATCH: taskPATCH }, "PATCH", `/api/v1/tasks/${created.id}`, {
        body: { workspaceId: u.workspaceId, status: "DONE" }, ...au(u),
      })
    )) as { status: string; completedAt: string | null };
    expect(done.status).toBe("DONE");
    expect(done.completedAt).toBeTruthy();

    const spawned = await db.task.findMany({
      where: { workspaceId: u.workspaceId, title: "Recurring follow-up", status: "OPEN" },
    });
    expect(spawned.length).toBe(1);
    // next due date ≈ original + 7 days
    const diffDays = (spawned[0].dueAt!.getTime() - yesterday.getTime()) / 86400000;
    expect(Math.round(diffDays)).toBe(7);

    // TASK_COMPLETED activity recorded
    const acts = await db.activity.findMany({
      where: { workspaceId: u.workspaceId, type: "TASK_EVENT" },
    });
    expect(acts.some((a) => a.title === "TASK_COMPLETED")).toBe(true);

    // Reopen → completedAt cleared
    const reopened = (await jsonBody(
      await callRoute({ PATCH: taskPATCH }, "PATCH", `/api/v1/tasks/${created.id}`, {
        body: { workspaceId: u.workspaceId, status: "OPEN" }, ...au(u),
      })
    )) as { status: string; completedAt: string | null };
    expect(reopened.status).toBe("OPEN");
    expect(reopened.completedAt).toBeNull();

    // Task detail refetch works
    const detail = await callRoute({ GET: taskGET }, "GET", `/api/v1/tasks/${created.id}?workspaceId=${u.workspaceId}`, au(u));
    expect(detail.status).toBe(200);
  });
});

describe("workflow: activity timeline correctness", () => {
  test("logged activity links to entities and updates lead lastActivityAt", async () => {
    const u = await freshWorkspace("flow-act");
    const lead = (await jsonBody(
      await callRoute({ POST: leadsPOST }, "POST", "/api/v1/leads", {
        body: { workspaceId: u.workspaceId, name: "Timeline Lead" }, ...au(u),
      })
    )) as { id: string };
    const before = await db.lead.findUnique({ where: { id: lead.id } });

    const res = await callRoute({ POST: activitiesPOST }, "POST", "/api/v1/activities", {
      body: { workspaceId: u.workspaceId, type: "CALL", title: "Intro call", leadId: lead.id },
      ...au(u),
    });
    expect(res.status).toBe(201);
    const activity = (await jsonBody(res)) as { type: string; leadId: string | null };
    expect(activity.type).toBe("CALL");
    expect(activity.leadId).toBe(lead.id);

    const after = await db.lead.findUnique({ where: { id: lead.id } });
    expect(after!.lastActivityAt.getTime()).toBeGreaterThanOrEqual(before!.lastActivityAt.getTime());
  });

  test("invalid entity reference is rejected (400/404), not silently accepted", async () => {
    const u = await freshWorkspace("flow-act2");
    const res = await callRoute({ POST: activitiesPOST }, "POST", "/api/v1/activities", {
      body: { workspaceId: u.workspaceId, type: "CALL", title: "bad link", dealId: "nonexistent-deal-id" },
      ...au(u),
    });
    expect(res.status).toBe(404);
  });
});

describe("workflow: dashboard metrics against known data", () => {
  test("KPIs match the seeded values exactly", async () => {
    const u = await freshWorkspace("flow-kpi");

    // Known data: 2 contacts, 1 new lead, open deals 3000 + 4000, one won 500
    await callRoute({ POST: contactsPOST }, "POST", "/api/v1/contacts", {
      body: { workspaceId: u.workspaceId, name: "KPI C1" }, ...au(u),
    });
    await callRoute({ POST: contactsPOST }, "POST", "/api/v1/contacts", {
      body: { workspaceId: u.workspaceId, name: "KPI C2" }, ...au(u),
    });
    await callRoute({ POST: leadsPOST }, "POST", "/api/v1/leads", {
      body: { workspaceId: u.workspaceId, name: "KPI L1" }, ...au(u),
    });
    await callRoute({ POST: dealsPOST }, "POST", "/api/v1/deals", {
      body: { workspaceId: u.workspaceId, title: "KPI D1", value: 3000 }, ...au(u),
    });
    await callRoute({ POST: dealsPOST }, "POST", "/api/v1/deals", {
      body: { workspaceId: u.workspaceId, title: "KPI D2", value: 4000 }, ...au(u),
    });
    const wonStage = await firstWonStageId(u);
    const wonDeal = (await jsonBody(
      await callRoute({ POST: dealsPOST }, "POST", "/api/v1/deals", {
        body: { workspaceId: u.workspaceId, title: "KPI D3", value: 500, stageId: wonStage }, ...au(u),
      })
    )) as { id: string };

    const dash = (await jsonBody(
      await callRoute({ GET: dashboardGET }, "GET", `/api/v1/dashboard?workspaceId=${u.workspaceId}`, au(u))
    )) as {
      kpis: {
        totalContacts: number;
        newLeads: number;
        activeDeals: number;
        openPipelineValue: number;
        wonRevenue: number;
      };
    };
    expect(dash.kpis.totalContacts).toBe(2);
    expect(dash.kpis.newLeads).toBe(1);
    expect(dash.kpis.activeDeals).toBe(2);
    expect(dash.kpis.openPipelineValue).toBe(7000);
    expect(dash.kpis.wonRevenue).toBe(500);

    // Sanity: won deal exists and is in the WON stage
    const d = (await jsonBody(
      await callRoute({ GET: dealGET }, "GET", `/api/v1/deals/${wonDeal.id}?workspaceId=${u.workspaceId}`, au(u))
    )) as { stage: { type: string } };
    expect(d.stage.type).toBe("WON");
  });
});

describe("workflow: radar rules evaluate real data, resolve cleanly", () => {
  test("inactive lead flagged once, resolved after contact, no duplicates", async () => {
    const u = await freshWorkspace("flow-radar");
    const lead = (await jsonBody(
      await callRoute({ POST: leadsPOST }, "POST", "/api/v1/leads", {
        body: { workspaceId: u.workspaceId, name: "Stale Lead" }, ...au(u),
      })
    )) as { id: string };

    // Backdate beyond the inactivity threshold (default 7 days)
    await db.lead.update({
      where: { id: lead.id },
      data: { lastActivityAt: new Date(Date.now() - 30 * 86400000) },
    });

    const radar1 = (await jsonBody(
      await callRoute({ GET: radarGET }, "GET", `/api/v1/radar?workspaceId=${u.workspaceId}`, au(u))
    )) as { items: { ruleKey: string; entityId: string }[] };
    expect(radar1.items.filter((i) => i.ruleKey === "LEAD_INACTIVE" && i.entityId === lead.id).length).toBe(1);

    // Repeated evaluation must not duplicate issues
    const radar2 = (await jsonBody(
      await callRoute({ GET: radarGET }, "GET", `/api/v1/radar?workspaceId=${u.workspaceId}`, au(u))
    )) as { items: { ruleKey: string; entityId: string }[] };
    expect(radar2.items.filter((i) => i.ruleKey === "LEAD_INACTIVE" && i.entityId === lead.id).length).toBe(1);

    // Resolution: log an activity → lastActivityAt refreshed → issue gone
    await callRoute({ POST: activitiesPOST }, "POST", "/api/v1/activities", {
      body: { workspaceId: u.workspaceId, type: "CALL", title: "Reached out", leadId: lead.id },
      ...au(u),
    });
    const radar3 = (await jsonBody(
      await callRoute({ GET: radarGET }, "GET", `/api/v1/radar?workspaceId=${u.workspaceId}`, au(u))
    )) as { items: { ruleKey: string; entityId: string }[] };
    expect(radar3.items.filter((i) => i.ruleKey === "LEAD_INACTIVE" && i.entityId === lead.id).length).toBe(0);
  });

  test("overdue task surfaces in radar; completing it clears the alert", async () => {
    const u = await freshWorkspace("flow-radar2");
    const task = (await jsonBody(
      await callRoute({ POST: tasksPOST }, "POST", "/api/v1/tasks", {
        body: { workspaceId: u.workspaceId, title: "Overdue thing", dueAt: new Date(Date.now() - 5 * 86400000).toISOString() },
        ...au(u),
      })
    )) as { id: string };
    const radar = (await jsonBody(
      await callRoute({ GET: radarGET }, "GET", `/api/v1/radar?workspaceId=${u.workspaceId}`, au(u))
    )) as { items: { ruleKey: string; entityId: string }[] };
    expect(radar.items.some((i) => i.ruleKey === "OVERDUE_TASK" && i.entityId === task.id)).toBe(true);
    await callRoute({ PATCH: taskPATCH }, "PATCH", `/api/v1/tasks/${task.id}`, {
      body: { workspaceId: u.workspaceId, status: "DONE" }, ...au(u),
    });
    const radarAfter = (await jsonBody(
      await callRoute({ GET: radarGET }, "GET", `/api/v1/radar?workspaceId=${u.workspaceId}`, au(u))
    )) as { items: { ruleKey: string; entityId: string }[] };
    expect(radarAfter.items.some((i) => i.ruleKey === "OVERDUE_TASK" && i.entityId === task.id)).toBe(false);
  });
});

describe("workflow: automation execution + idempotency", () => {
  test("LEAD_CREATED rule fires once per lead; history + runCount recorded", async () => {
    const u = await freshWorkspace("flow-auto");
    await callRoute({ POST: rulesPOST }, "POST", "/api/v1/automation/rules", {
      body: {
        workspaceId: u.workspaceId,
        name: "Auto follow-up",
        triggerType: "LEAD_CREATED",
        actions: [{ type: "CREATE_TASK", params: { title: "Auto task", dueInDays: "2" } }],
      },
      ...au(u),
    });

    const lead = (await jsonBody(
      await callRoute({ POST: leadsPOST }, "POST", "/api/v1/leads", {
        body: { workspaceId: u.workspaceId, name: "Automation Lead" }, ...au(u),
      })
    )) as { id: string };

    const spawned = await db.task.findMany({
      where: { workspaceId: u.workspaceId, title: "Auto task", leadId: lead.id },
    });
    expect(spawned.length).toBe(1);

    const executions = (await jsonBody(
      await callRoute({ GET: executionsGET }, "GET", `/api/v1/automation/executions?workspaceId=${u.workspaceId}&limit=50`, au(u))
    )) as unknown as { status: string; entityId: string | null }[];
    const successes = executions.filter((e) => e.status === "SUCCESS" && e.entityId === lead.id);
    expect(successes.length).toBe(1);

    const rules = (await jsonBody(
      await callRoute({ GET: rulesGET }, "GET", `/api/v1/automation/rules?workspaceId=${u.workspaceId}`, au(u))
    )) as unknown as { runCount: number }[];
    expect(rules[0].runCount).toBe(1);
  });

  test("time-based rule is deduplicated per day (scan twice → one execution)", async () => {
    const u = await freshWorkspace("flow-auto2");
    await callRoute({ POST: rulesPOST }, "POST", "/api/v1/automation/rules", {
      body: {
        workspaceId: u.workspaceId,
        name: "Nudge overdue",
        triggerType: "TASK_OVERDUE",
        actions: [{ type: "CREATE_TASK", params: { title: "Nudge task" } }],
      },
      ...au(u),
    });
    await callRoute({ POST: tasksPOST }, "POST", "/api/v1/tasks", {
      body: { workspaceId: u.workspaceId, title: "Very overdue", dueAt: new Date(Date.now() - 3 * 86400000).toISOString() },
      ...au(u),
    });

    // Manual scan #1
    expect((await callRoute({ POST: radarPOST }, "POST", "/api/v1/radar", au(u))).status).toBe(200);
    const nudges1 = await db.task.findMany({ where: { workspaceId: u.workspaceId, title: "Nudge task" } });
    expect(nudges1.length).toBe(1);

    // Manual scan #2 — deduped
    await callRoute({ POST: radarPOST }, "POST", "/api/v1/radar", au(u));
    const nudges2 = await db.task.findMany({ where: { workspaceId: u.workspaceId, title: "Nudge task" } });
    expect(nudges2.length).toBe(1);
  });
});

describe("workflow: CSV template, preview, confirm, formula protection", () => {
  test("template download contains expected headers", async () => {
    const u = await freshWorkspace("flow-csv");
    const res = await callRoute({ GET: csvTemplate }, "GET", `/api/v1/csv/template/leads?workspaceId=${u.workspaceId}`, {
      params: { entity: "leads" }, ...au(u),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Name");
    expect(text).toContain("Email");
    expect(text).toContain("Estimated Value");
  });

  test("preview flags invalid rows; confirm imports only valid ones", async () => {
    const u = await freshWorkspace("flow-csv2");
    const rows = [
      ["Good Row", `good.${u.userId}@test.local`, "+98 912 000 0000", "5000"],
      ["", "missing-name@test.local", "", ""], // missing name
      ["Bad Email", "not-an-email", "", ""], // invalid email
      ["Bad Number", `badnum.${u.userId}@test.local`, "", "abc"], // invalid number
    ];
    const mapping = { 0: "name", 1: "email", 2: "phone", 3: "estimatedValue" };

    const preview = (await jsonBody(
      await callRoute({ POST: csvPreview }, "POST", "/api/v1/csv/import/preview/leads", {
        body: { workspaceId: u.workspaceId, mapping, rows, skipDuplicates: true },
        params: { entity: "leads" }, ...au(u),
      })
    )) as { validCount: number; errorCount: number; errors: { row: number; error: string }[] };
    expect(preview.validCount).toBe(1);
    expect(preview.errorCount).toBe(3);
    expect(preview.errors.some((e) => e.error === "MISSING:name")).toBe(true);
    expect(preview.errors.some((e) => e.error === "INVALID:email")).toBe(true);
    expect(preview.errors.some((e) => e.error === "INVALID:estimatedValue")).toBe(true);

    const confirm = (await jsonBody(
      await callRoute({ POST: csvConfirm }, "POST", "/api/v1/csv/import/confirm/leads", {
        body: { workspaceId: u.workspaceId, mapping, rows, skipDuplicates: true },
        params: { entity: "leads" }, ...au(u),
      })
    )) as { imported: number; skipped: number; failed: number };
    expect(confirm.imported).toBe(1);
    expect(confirm.failed + confirm.skipped).toBe(3);

    // Failure recovery: re-import with skipDuplicates → good rows skipped, nothing duplicated
    const again = (await jsonBody(
      await callRoute({ POST: csvConfirm }, "POST", "/api/v1/csv/import/confirm/leads", {
        body: { workspaceId: u.workspaceId, mapping, rows, skipDuplicates: true },
        params: { entity: "leads" }, ...au(u),
      })
    )) as { imported: number; skipped: number };
    expect(again.imported).toBe(0);
    expect(again.skipped).toBeGreaterThanOrEqual(1);
  });

  test("export applies formula-injection protection to dangerous cells", async () => {
    const u = await freshWorkspace("flow-csv3");
    await callRoute({ POST: leadsPOST }, "POST", "/api/v1/leads", {
      body: { workspaceId: u.workspaceId, name: "=HYPERLINK(evil)", phone: "+989120000000" }, ...au(u),
    });
    const res = await callRoute({ GET: csvExport }, "GET", `/api/v1/csv/export/leads?workspaceId=${u.workspaceId}`, {
      params: { entity: "leads" }, ...au(u),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("'=HYPERLINK(evil)"); // neutralized
    expect(text).toContain("'+989120000000"); // phone preserved but neutralized
  });

  test("invalid enum values are coerced consistently (preview + confirm)", async () => {
    const u = await freshWorkspace("flow-csv4");
    const rows = [["Coerce Me", "", "", "", "", "NOT_A_SOURCE"]];
    const mapping = { 0: "name", 5: "source" };
    const preview = (await jsonBody(
      await callRoute({ POST: csvPreview }, "POST", "/api/v1/csv/import/preview/leads", {
        body: { workspaceId: u.workspaceId, mapping, rows, skipDuplicates: true },
        params: { entity: "leads" }, ...au(u),
      })
    )) as { validCount: number };
    expect(preview.validCount).toBe(1);
    const confirm = (await jsonBody(
      await callRoute({ POST: csvConfirm }, "POST", "/api/v1/csv/import/confirm/leads", {
        body: { workspaceId: u.workspaceId, mapping, rows, skipDuplicates: true },
        params: { entity: "leads" }, ...au(u),
      })
    )) as { imported: number };
    expect(confirm.imported).toBe(1);
    const stored = await db.lead.findFirst({ where: { workspaceId: u.workspaceId, name: "Coerce Me" } });
    expect(stored?.source).toBe("OTHER");
  });
});

describe("workflow: custom-field validation", () => {
  test("invalid SELECT option silently dropped; valid value stored and returned", async () => {
    const u = await freshWorkspace("flow-cf");
    const field = (await jsonBody(
      await callRoute({ POST: customFieldsPOST }, "POST", "/api/v1/custom-fields", {
        body: {
          workspaceId: u.workspaceId,
          entityType: "contact",
          key: "tier",
          label: "Tier",
          type: "SELECT",
          options: ["gold", "silver"],
        },
        ...au(u),
      })
    )) as { id: string };
    expect(field.id).toBeTruthy();

    // Documented lenient behavior: invalid option values are dropped, the
    // entity itself is still created (no silent corruption of the record).
    const bad = (await jsonBody(
      await callRoute({ POST: contactsPOST }, "POST", "/api/v1/contacts", {
        body: { workspaceId: u.workspaceId, name: "CF Bad", customFields: { tier: "platinum" } },
        ...au(u),
      })
    )) as { id: string };
    expect(bad.id).toBeTruthy();
    const badDetail = (await jsonBody(
      await callRoute({ GET: contactGET }, "GET", `/api/v1/contacts/${bad.id}?workspaceId=${u.workspaceId}`, au(u))
    )) as { customFields: { key: string; value: string | null }[] };
    expect(badDetail.customFields.find((f) => f.key === "tier")?.value).toBeNull();

    const good = (await jsonBody(
      await callRoute({ POST: contactsPOST }, "POST", "/api/v1/contacts", {
        body: { workspaceId: u.workspaceId, name: "CF Good", customFields: { tier: "gold" } },
        ...au(u),
      })
    )) as { id: string };
    const detail = (await jsonBody(
      await callRoute({ GET: contactGET }, "GET", `/api/v1/contacts/${good.id}?workspaceId=${u.workspaceId}`, au(u))
    )) as { customFields: { key: string; value: string | null }[] };
    expect(detail.customFields.find((f) => f.key === "tier")?.value).toBe("gold");
  });
});
