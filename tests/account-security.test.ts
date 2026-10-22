/**
 * Account-security regression tests — the "release gate" suite.
 *
 * Locks in the documented behavior of every account-credential flow while no
 * email provider is configured:
 *  - Member invitations are an ADMIN-only provisioning alternative: the
 *    password is chosen by the admin, never generated server-side, never
 *    returned in any API response, and never applied to existing accounts.
 *  - No public password-reset endpoint exists; password change is strictly
 *    self-service behind an authenticated session.
 *  - Demo seeding (/api/v1/dev/seed) is unreachable in production
 *    (NODE_ENV=production → 404) and creates nothing when blocked.
 *  - Credential material (hashes, tokens, submitted passwords) never appears
 *    in register/login/invite responses or audit-log details.
 */
import { describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { callRoute, jsonBody, registerUser } from "./helpers";

import { POST as membersPOST } from "@/app/api/v1/workspaces/members/route";
import { POST as loginPOST } from "@/app/api/v1/auth/login/route";
import { POST as registerPOST } from "@/app/api/v1/auth/register/route";
import { POST as passwordPOST } from "@/app/api/v1/auth/password/route";
import { POST as seedPOST, GET as seedGET } from "@/app/api/v1/dev/seed/route";

const MEMBERS = "/api/v1/workspaces/members";
const AUTH = "/api/v1/auth";

function inviteBody(
  workspaceId: string,
  overrides: Partial<{ name: string; email: string; password: string; role: string }> = {}
) {
  return {
    workspaceId,
    name: overrides.name ?? "Invited Member",
    email: overrides.email ?? `invited-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@test.local`,
    password: overrides.password ?? "temp-pass-123",
    role: overrides.role ?? "MEMBER",
  };
}

describe("account security: member invitations", () => {
  test("unauthenticated requests cannot provision accounts (401)", async () => {
    const res = await callRoute({ POST: membersPOST }, "POST", MEMBERS, {
      body: inviteBody("ws-does-not-matter"),
    });
    expect(res.status).toBe(401);
  });

  test("MEMBER role cannot invite (403)", async () => {
    const owner = await registerUser("owner-m");
    // The owner invites a plain member into their workspace.
    const memberEmail = `plain-${Date.now()}@test.local`;
    const add = await callRoute({ POST: membersPOST }, "POST", MEMBERS, {
      body: inviteBody(owner.workspaceId, { email: memberEmail, password: "member-pw-123" }),
      token: owner.token,
    });
    expect(add.status).toBe(201);
    const login = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
      body: { email: memberEmail, password: "member-pw-123" },
      ip: "10.80.0.1",
    });
    const memberToken = ((await jsonBody(login)) as { token: string }).token;

    // The plain member must not be able to provision accounts.
    const res = await callRoute({ POST: membersPOST }, "POST", MEMBERS, {
      body: inviteBody(owner.workspaceId),
      token: memberToken,
    });
    expect(res.status).toBe(403);
  });

  test("admin invite creates the account with the admin-chosen password and leaks no credentials", async () => {
    const owner = await registerUser("owner-inv");
    const adminPassword = "admin-temp-pass-9";
    const res = await callRoute({ POST: membersPOST }, "POST", MEMBERS, {
      body: inviteBody(owner.workspaceId, { password: adminPassword }),
      token: owner.token,
    });
    expect(res.status).toBe(201);

    const data = (await jsonBody(res)) as Record<string, unknown>;
    // Response shape is exactly the documented membership data — no
    // password, no hash, no session token, no "email sent" claim.
    expect(Object.keys(data).sort()).toEqual(
      ["createdAt", "email", "membershipId", "name", "role", "userId"]
    );
    const raw = JSON.stringify(data);
    expect(raw).not.toContain("password");
    expect(raw).not.toContain(adminPassword);
    expect(raw).not.toContain("token");

    // The provisioned account works with the admin-chosen password.
    const login = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
      body: { email: data.email as string, password: adminPassword },
      ip: "10.80.1.1",
    });
    expect(login.status).toBe(200);
  });

  test("inviting an EXISTING user never overwrites their password", async () => {
    const owner = await registerUser("owner-ex");
    const existing = await registerUser("existing");
    const hashBefore = (
      await db.user.findUniqueOrThrow({ where: { id: existing.userId } })
    ).passwordHash;

    const attackerPassword = "invite-body-pass-7";
    const res = await callRoute({ POST: membersPOST }, "POST", MEMBERS, {
      body: inviteBody(owner.workspaceId, {
        email: existing.email,
        password: attackerPassword,
      }),
      token: owner.token,
    });
    expect(res.status).toBe(201);

    // Hash untouched.
    const hashAfter = (
      await db.user.findUniqueOrThrow({ where: { id: existing.userId } })
    ).passwordHash;
    expect(hashAfter).toBe(hashBefore);

    // Original password still valid; the invite-body password is NOT.
    const oldPw = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
      body: { email: existing.email, password: "password123" },
      ip: "10.80.2.1",
    });
    expect(oldPw.status).toBe(200);
    const newPw = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
      body: { email: existing.email, password: attackerPassword },
      ip: "10.80.2.2",
    });
    expect(newPw.status).toBe(401);
  });

  test("inviting the same user twice returns 409 ALREADY_MEMBER", async () => {
    const owner = await registerUser("owner-dup");
    const email = `dup-${Date.now()}@test.local`;
    const first = await callRoute({ POST: membersPOST }, "POST", MEMBERS, {
      body: inviteBody(owner.workspaceId, { email }),
      token: owner.token,
    });
    expect(first.status).toBe(201);
    const second = await callRoute({ POST: membersPOST }, "POST", MEMBERS, {
      body: inviteBody(owner.workspaceId, { email }),
      token: owner.token,
    });
    expect(second.status).toBe(409);
    const body = await jsonBody(second);
    expect((body.error as { code: string }).code).toBe("ALREADY_MEMBER");
  });

  test("audit log for an invite contains no password material", async () => {
    const owner = await registerUser("owner-audit");
    const adminPassword = "audit-secret-pass-3";
    const res = await callRoute({ POST: membersPOST }, "POST", MEMBERS, {
      body: inviteBody(owner.workspaceId, { password: adminPassword }),
      token: owner.token,
    });
    expect(res.status).toBe(201);
    const { membershipId } = (await jsonBody(res)) as { membershipId: string };

    const row = await db.auditLog.findFirst({
      where: { entityType: "membership", entityId: membershipId },
    });
    expect(row).not.toBeNull();
    const detail = JSON.stringify(row?.detail ?? "");
    expect(detail).not.toContain(adminPassword);
    expect(detail.toLowerCase()).not.toContain("password");
  });

  test("invitation provisioning is rate-limited per workspace (429)", async () => {
    const owner = await registerUser("owner-rate");
    let lastStatus = 0;
    for (let i = 0; i < 32; i++) {
      const res = await callRoute({ POST: membersPOST }, "POST", MEMBERS, {
        body: inviteBody(owner.workspaceId),
        token: owner.token,
      });
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("account security: credentials never leak in auth responses", () => {
  test("register response contains no hash and does not echo the password", async () => {
    const plain = "register-plain-pw-1";
    const res = await callRoute({ POST: registerPOST }, "POST", `${AUTH}/register`, {
      body: { name: "Leak Check", email: `leak-${Date.now()}@test.local`, password: plain },
      ip: "10.81.0.1",
    });
    expect(res.status).toBe(201);
    const raw = JSON.stringify(await jsonBody(res));
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain(plain);
  });

  test("login response contains no hash and does not echo the password", async () => {
    const u = await registerUser("leaklogin");
    const res = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
      body: { email: u.email, password: "password123" },
      ip: u.ip,
    });
    expect(res.status).toBe(200);
    const raw = JSON.stringify(await jsonBody(res));
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("password123");
  });
});

describe("account security: password change is self-service only", () => {
  test("unauthenticated password change is rejected (401)", async () => {
    const res = await callRoute({ POST: passwordPOST }, "POST", `${AUTH}/password`, {
      body: { currentPassword: "whatever", newPassword: "newpassword99" },
    });
    expect(res.status).toBe(401);
  });

  test("password change requires the CURRENT password (no reset-only path)", async () => {
    const u = await registerUser("nosreset");
    const res = await callRoute({ POST: passwordPOST }, "POST", `${AUTH}/password`, {
      body: { currentPassword: "wrong-current", newPassword: "newpassword99" },
      token: u.token,
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect((body.error as { code: string }).code).toBe("WRONG_PASSWORD");
  });
});

describe("account security: demo seeding is unreachable in production", () => {
  test("POST /dev/seed returns 404 when NODE_ENV=production and creates NOTHING", async () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      const usersBefore = await db.user.count();
      const res = await callRoute({ POST: seedPOST }, "POST", "/api/v1/dev/seed", {
        body: {},
        ip: "10.82.0.1",
      });
      expect(res.status).toBe(404);
      const body = await jsonBody(res);
      expect((body.error as { code: string }).code).toBe("NOT_FOUND");
      // No accounts, no records — not even the demo account.
      expect(await db.user.count()).toBe(usersBefore);
      expect(await db.user.findUnique({ where: { email: "demo@nexora.app" } })).toBeNull();
    } finally {
      env.NODE_ENV = prev;
    }
  });

  test("GET /dev/seed is a 405 (method not allowed) regardless of environment", async () => {
    const res = await callRoute({ GET: seedGET }, "GET", "/api/v1/dev/seed");
    expect(res.status).toBe(405);
  });
});
