/**
 * Workspace isolation regression tests — THE critical security boundary.
 *
 * User B (a member of workspace B only) must never read, modify, link to,
 * convert, export, or delete anything owned by workspace A, even when B
 * supplies A's ids, workspace ids, or user ids directly. These tests make
 * real authorization assertions (exact status codes), not just "some error".
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { callRoute, jsonBody, registerUser, type TestUser } from "./helpers";

import { GET as leadsGET, POST as leadsPOST } from "@/app/api/v1/leads/route";
import { GET as leadGET, PATCH as leadPATCH, DELETE as leadDELETE } from "@/app/api/v1/leads/[id]/route";
import { POST as leadConvert } from "@/app/api/v1/leads/[id]/convert/route";
import { POST as leadsBulk } from "@/app/api/v1/leads/bulk/route";
import { POST as contactsPOST } from "@/app/api/v1/contacts/route";
import { GET as contactGET, PATCH as contactPATCH } from "@/app/api/v1/contacts/[id]/route";
import { POST as companiesPOST } from "@/app/api/v1/companies/route";
import { GET as companyGET, DELETE as companyDELETE } from "@/app/api/v1/companies/[id]/route";
import { GET as dealsGET, POST as dealsPOST } from "@/app/api/v1/deals/route";
import { GET as dealGET, PATCH as dealPATCH, DELETE as dealDELETE } from "@/app/api/v1/deals/[id]/route";
import { POST as tasksPOST } from "@/app/api/v1/tasks/route";
import { GET as taskGET, PATCH as taskPATCH, DELETE as taskDELETE } from "@/app/api/v1/tasks/[id]/route";
import { GET as activitiesGET } from "@/app/api/v1/activities/route";
import { GET as notificationsGET } from "@/app/api/v1/notifications/route";
import { GET as savedViewsGET, POST as savedViewsPOST, DELETE as savedViewDELETE } from "@/app/api/v1/saved-views/route";
import { GET as rulesGET, POST as rulesPOST } from "@/app/api/v1/automation/rules/route";
import { PATCH as rulePATCH } from "@/app/api/v1/automation/rules/[id]/route";
import { GET as searchGET } from "@/app/api/v1/search/route";
import { GET as csvExport } from "@/app/api/v1/csv/export/[entity]/route";
import { GET as customFieldsGET, POST as customFieldsPOST } from "@/app/api/v1/custom-fields/route";
import { GET as membersGET } from "@/app/api/v1/workspaces/members/route";
import { GET as pipelinesGET } from "@/app/api/v1/pipelines/route";

const aAuth = (u: TestUser) => ({ token: u.token, ip: u.ip });

describe("workspace isolation", () => {
  let A: TestUser;
  let B: TestUser;
  let aCompany: string;
  let aContact: string;
  let aLead: string;
  let aDeal: string;
  let aTask: string;
  let aSavedView: string;
  let aRule: string;
  let aCustomField: string;

  beforeAll(async () => {
    A = await registerUser("iso-a");
    B = await registerUser("iso-b");

    aCompany = ((await jsonBody(
      await callRoute({ POST: companiesPOST }, "POST", "/api/v1/companies", {
        body: { workspaceId: A.workspaceId, name: "A Corp Secret" },
        ...aAuth(A),
      })
    )) as { id: string }).id;
    aContact = ((await jsonBody(
      await callRoute({ POST: contactsPOST }, "POST", "/api/v1/contacts", {
        body: { workspaceId: A.workspaceId, name: "Alice Secret", email: "alice.secret@test.local", companyId: aCompany },
        ...aAuth(A),
      })
    )) as { id: string }).id;
    aLead = ((await jsonBody(
      await callRoute({ POST: leadsPOST }, "POST", "/api/v1/leads", {
        body: { workspaceId: A.workspaceId, name: "A Lead Secret", email: "lead.secret@test.local" },
        ...aAuth(A),
      })
    )) as { id: string }).id;
    aDeal = ((await jsonBody(
      await callRoute({ POST: dealsPOST }, "POST", "/api/v1/deals", {
        body: { workspaceId: A.workspaceId, title: "A Deal Secret", contactId: aContact, companyId: aCompany },
        ...aAuth(A),
      })
    )) as { id: string }).id;
    aTask = ((await jsonBody(
      await callRoute({ POST: tasksPOST }, "POST", "/api/v1/tasks", {
        body: { workspaceId: A.workspaceId, title: "A Task Secret", dealId: aDeal, contactId: aContact },
        ...aAuth(A),
      })
    )) as { id: string }).id;
    aSavedView = ((await jsonBody(
      await callRoute({ POST: savedViewsPOST }, "POST", "/api/v1/saved-views", {
        body: { workspaceId: A.workspaceId, name: "A View", entityType: "lead", filters: { status: ["NEW"] } },
        ...aAuth(A),
      })
    )) as { id: string }).id;
    aRule = ((await jsonBody(
      await callRoute({ POST: rulesPOST }, "POST", "/api/v1/automation/rules", {
        body: {
          workspaceId: A.workspaceId,
          name: "A Rule",
          triggerType: "LEAD_CREATED",
          actions: [{ type: "LOG_EVENT", params: { message: "hello" } }],
        },
        ...aAuth(A),
      })
    )) as { id: string }).id;
    aCustomField = ((await jsonBody(
      await callRoute({ POST: customFieldsPOST }, "POST", "/api/v1/custom-fields", {
        body: { workspaceId: A.workspaceId, entityType: "contact", key: "iso_field", label: "ISO Field", type: "TEXT" },
        ...aAuth(A),
      })
    )) as { id: string }).id;
  });

  // ---------- direct record access ----------
  test("B cannot READ A's lead / contact / company / deal / task (404)", async () => {
    const cases = [
      [`/api/v1/leads/${aLead}?workspaceId=${B.workspaceId}`, { GET: leadGET }],
      [`/api/v1/contacts/${aContact}?workspaceId=${B.workspaceId}`, { GET: contactGET }],
      [`/api/v1/companies/${aCompany}?workspaceId=${B.workspaceId}`, { GET: companyGET }],
      [`/api/v1/deals/${aDeal}?workspaceId=${B.workspaceId}`, { GET: dealGET }],
      [`/api/v1/tasks/${aTask}?workspaceId=${B.workspaceId}`, { GET: taskGET }],
    ] as const;
    for (const [path, mod] of cases) {
      const res = await callRoute(mod, "GET", path, aAuth(B));
      expect(res.status).toBe(404);
    }
  });

  test("B cannot MODIFY A's records (404 on PATCH)", async () => {
    const r1 = await callRoute({ PATCH: leadPATCH }, "PATCH", `/api/v1/leads/${aLead}`, {
      body: { workspaceId: B.workspaceId, name: "hacked" }, ...aAuth(B),
    });
    expect(r1.status).toBe(404);
    const r2 = await callRoute({ PATCH: dealPATCH }, "PATCH", `/api/v1/deals/${aDeal}`, {
      body: { workspaceId: B.workspaceId, title: "hacked" }, ...aAuth(B),
    });
    expect(r2.status).toBe(404);
    const r3 = await callRoute({ PATCH: taskPATCH }, "PATCH", `/api/v1/tasks/${aTask}`, {
      body: { workspaceId: B.workspaceId, status: "DONE" }, ...aAuth(B),
    });
    expect(r3.status).toBe(404);
    // data really unchanged
    const lead = (await jsonBody(
      await callRoute({ GET: leadGET }, "GET", `/api/v1/leads/${aLead}?workspaceId=${A.workspaceId}`, aAuth(A))
    )) as { name: string };
    expect(lead.name).toBe("A Lead Secret");
  });

  test("B cannot DELETE A's records (404)", async () => {
    expect((await callRoute({ DELETE: leadDELETE }, "DELETE", `/api/v1/leads/${aLead}`, aAuth(B))).status).toBe(404);
    expect((await callRoute({ DELETE: companyDELETE }, "DELETE", `/api/v1/companies/${aCompany}`, aAuth(B))).status).toBe(404);
    expect((await callRoute({ DELETE: dealDELETE }, "DELETE", `/api/v1/deals/${aDeal}`, aAuth(B))).status).toBe(404);
    expect((await callRoute({ DELETE: taskDELETE }, "DELETE", `/api/v1/tasks/${aTask}`, aAuth(B))).status).toBe(404);
  });

  test("passing A's workspaceId with B's token → 401 UNAUTHORIZED", async () => {
    const res = await callRoute({ GET: leadsGET }, "GET", `/api/v1/leads?workspaceId=${A.workspaceId}`, aAuth(B));
    expect(res.status).toBe(401);
    const body = await jsonBody(res);
    expect((body.error as { code: string }).code).toBe("UNAUTHORIZED");
  });

  test("B's list endpoints never contain A's records", async () => {
    const leads = (await jsonBody(await callRoute({ GET: leadsGET }, "GET", `/api/v1/leads?workspaceId=${B.workspaceId}`, aAuth(B)))) as { items: { id: string }[] };
    expect(leads.items.map((i) => i.id)).not.toContain(aLead);
    const deals = (await jsonBody(await callRoute({ GET: dealsGET }, "GET", `/api/v1/deals?workspaceId=${B.workspaceId}`, aAuth(B)))) as { items: { id: string }[] };
    expect(deals.items.map((i) => i.id)).not.toContain(aDeal);
    const acts = (await jsonBody(await callRoute({ GET: activitiesGET }, "GET", `/api/v1/activities?workspaceId=${B.workspaceId}`, aAuth(B)))) as { items: { id: string }[] };
    expect(Array.isArray(acts.items)).toBe(true);
  });

  test("B cannot CONVERT A's lead (404)", async () => {
    const res = await callRoute({ POST: leadConvert }, "POST", `/api/v1/leads/${aLead}/convert`, {
      body: { workspaceId: B.workspaceId, createDeal: true }, ...aAuth(B),
    });
    expect(res.status).toBe(404);
    // Lead remains unconverted
    const lead = (await jsonBody(
      await callRoute({ GET: leadGET }, "GET", `/api/v1/leads/${aLead}?workspaceId=${A.workspaceId}`, aAuth(A))
    )) as { status: string };
    expect(lead.status).not.toBe("CONVERTED");
  });

  test("B cannot bulk-delete or bulk-assign A's leads", async () => {
    // Foreign ids mixed into bulk delete → refused, nothing deleted
    const res = await callRoute({ POST: leadsBulk }, "POST", "/api/v1/leads/bulk", {
      body: { workspaceId: B.workspaceId, ids: [aLead], action: "delete" }, ...aAuth(B),
    });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.success).toBe(false);
    // Lead still exists
    expect(
      (await callRoute({ GET: leadGET }, "GET", `/api/v1/leads/${aLead}?workspaceId=${A.workspaceId}`, aAuth(A))).status
    ).toBe(200);
    // Bulk assign targeting A's user id must be rejected
    const ownLead = (await jsonBody(
      await callRoute({ POST: leadsPOST }, "POST", "/api/v1/leads", {
        body: { workspaceId: B.workspaceId, name: "B bulk target" }, ...aAuth(B),
      })
    )) as { id: string };
    const assign = await callRoute({ POST: leadsBulk }, "POST", "/api/v1/leads/bulk", {
      body: { workspaceId: B.workspaceId, ids: [ownLead.id], action: "assign", ownerId: A.userId }, ...aAuth(B),
    });
    expect(assign.status).toBe(400);
    const assignBody = await jsonBody(assign);
    expect((assignBody.error as { code: string }).code).toBe("NOT_A_MEMBER");
  });

  // ---------- nested / relation references ----------
  test("B cannot link own records to A's records (404/400)", async () => {
    // own deal → A's contact
    const ownDeal = (await jsonBody(
      await callRoute({ POST: dealsPOST }, "POST", "/api/v1/deals", {
        body: { workspaceId: B.workspaceId, title: "B link probe" }, ...aAuth(B),
      })
    )) as { id: string };
    const r1 = await callRoute({ PATCH: dealPATCH }, "PATCH", `/api/v1/deals/${ownDeal.id}`, {
      body: { workspaceId: B.workspaceId, contactId: aContact }, ...aAuth(B),
    });
    expect(r1.status).toBe(404);
    // own task → A's deal
    const r2 = await callRoute({ POST: tasksPOST }, "POST", "/api/v1/tasks", {
      body: { workspaceId: B.workspaceId, title: "b task", dealId: aDeal }, ...aAuth(B),
    });
    expect(r2.status).toBe(404);
    // own contact → A's company
    const r3 = await callRoute({ POST: contactsPOST }, "POST", "/api/v1/contacts", {
      body: { workspaceId: B.workspaceId, name: "b contact", companyId: aCompany }, ...aAuth(B),
    });
    expect(r3.status).toBe(404);
    // own contact PATCH → A's company
    const ownContact = (await jsonBody(
      await callRoute({ POST: contactsPOST }, "POST", "/api/v1/contacts", {
        body: { workspaceId: B.workspaceId, name: "b contact 2" }, ...aAuth(B),
      })
    )) as { id: string };
    const r4 = await callRoute({ PATCH: contactPATCH }, "PATCH", `/api/v1/contacts/${ownContact.id}`, {
      body: { workspaceId: B.workspaceId, companyId: aCompany }, ...aAuth(B),
    });
    expect(r4.status).toBe(404);
    // own lead → A's user as owner
    const r5 = await callRoute({ POST: leadsPOST }, "POST", "/api/v1/leads", {
      body: { workspaceId: B.workspaceId, name: "b lead", ownerId: A.userId }, ...aAuth(B),
    });
    expect(r5.status).toBe(400);
    expect(((await jsonBody(r5)).error as { code: string }).code).toBe("NOT_A_MEMBER");
    // own deal in A's pipeline → rejected
    const aPipelines = (await jsonBody(
      await callRoute({ GET: pipelinesGET }, "GET", `/api/v1/pipelines?workspaceId=${A.workspaceId}`, aAuth(A))
    )) as unknown as unknown as { id: string }[];
    const aPipelineId = aPipelines[0].id;
    const r6 = await callRoute({ POST: dealsPOST }, "POST", "/api/v1/deals", {
      body: { workspaceId: B.workspaceId, title: "b deal", pipelineId: aPipelineId }, ...aAuth(B),
    });
    expect(r6.status).toBe(400);
  });

  // ---------- settings-type resources ----------
  test("saved views are workspace+user scoped", async () => {
    const views = (await jsonBody(
      await callRoute({ GET: savedViewsGET }, "GET", `/api/v1/saved-views?workspaceId=${B.workspaceId}&entityType=lead`, aAuth(B))
    )) as unknown as unknown as { id: string }[];
    expect(views.map((v) => v.id)).not.toContain(aSavedView);
    expect(
      (await callRoute({ DELETE: savedViewDELETE }, "DELETE", `/api/v1/saved-views?id=${aSavedView}&workspaceId=${B.workspaceId}`, aAuth(B))).status
    ).toBe(404);
  });

  test("automation rules are workspace scoped; foreign user targets rejected", async () => {
    const rules = (await jsonBody(
      await callRoute({ GET: rulesGET }, "GET", `/api/v1/automation/rules?workspaceId=${B.workspaceId}`, aAuth(B))
    )) as unknown as { id: string }[];
    expect(rules.map((r) => r.id)).not.toContain(aRule);
    const patch = await callRoute({ PATCH: rulePATCH }, "PATCH", `/api/v1/automation/rules/${aRule}`, {
      body: { workspaceId: B.workspaceId, enabled: false }, ...aAuth(B),
    });
    expect(patch.status).toBe(404);
    // ASSIGN rule targeting A's user id → 400 NOT_A_MEMBER
    const badRule = await callRoute({ POST: rulesPOST }, "POST", "/api/v1/automation/rules", {
      body: {
        workspaceId: B.workspaceId,
        name: "steal",
        triggerType: "LEAD_CREATED",
        actions: [{ type: "ASSIGN", params: { userId: A.userId } }],
      }, ...aAuth(B),
    });
    expect(badRule.status).toBe(400);
    expect(((await jsonBody(badRule)).error as { code: string }).code).toBe("NOT_A_MEMBER");
  });

  test("custom fields are workspace scoped", async () => {
    const fields = (await jsonBody(
      await callRoute({ GET: customFieldsGET }, "GET", `/api/v1/custom-fields?workspaceId=${B.workspaceId}`, aAuth(B))
    )) as unknown as { id: string }[];
    expect(fields.map((f) => f.id)).not.toContain(aCustomField);
  });

  test("members list only shows own workspace", async () => {
    const members = (await jsonBody(
      await callRoute({ GET: membersGET }, "GET", `/api/v1/workspaces/members?workspaceId=${B.workspaceId}`, aAuth(B))
    )) as unknown as { userId: string }[];
    expect(members.map((m) => m.userId)).not.toContain(A.userId);
  });

  test("notifications are user+workspace scoped", async () => {
    // A assigns a task to A → notification for A only
    await callRoute({ POST: tasksPOST }, "POST", "/api/v1/tasks", {
      body: { workspaceId: A.workspaceId, title: "A assigned task", assigneeId: A.userId }, ...aAuth(A),
    });
    const notifs = (await jsonBody(
      await callRoute({ GET: notificationsGET }, "GET", `/api/v1/notifications?workspaceId=${B.workspaceId}`, aAuth(B))
    )) as { items: { title: string }[] };
    expect(notifs.items.map((n) => n.title)).not.toContain("A assigned task");
  });

  test("search does not cross workspaces", async () => {
    const res = await callRoute({ GET: searchGET }, "GET", `/api/v1/search?workspaceId=${B.workspaceId}&q=Secret`, aAuth(B));
    const data = (await jsonBody(res)) as { groups?: { items: { id: string }[] }[] };
    const allIds = (data.groups ?? []).flatMap((g) => g.items.map((i) => i.id));
    expect(allIds).not.toContain(aLead);
    expect(allIds).not.toContain(aDeal);
  });

  test("CSV export never includes foreign workspace rows", async () => {
    const res = await callRoute({ GET: csvExport }, "GET", `/api/v1/csv/export/contacts?workspaceId=${B.workspaceId}`, {
      params: { entity: "contacts" }, ...aAuth(B),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("Alice Secret");
    expect(text).not.toContain("A Corp Secret");
  });
});
