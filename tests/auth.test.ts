/**
 * Authentication & session regression tests.
 * Exercises the real register/login/logout/password handlers, real scrypt
 * verification and real SQLite session records.
 */
import { describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import { callRoute, jsonBody, registerUser } from "./helpers";

import { GET as meGET, PATCH as mePATCH } from "@/app/api/v1/auth/me/route";
import { POST as loginPOST } from "@/app/api/v1/auth/login/route";
import { POST as logoutPOST } from "@/app/api/v1/auth/logout/route";
import { POST as passwordPOST } from "@/app/api/v1/auth/password/route";

const AUTH = "/api/v1/auth";

describe("auth: registration", () => {
  test("creates user + workspace and returns session token", async () => {
    const u = await registerUser("reg");
    expect(u.token).toBeTruthy();
    expect(u.workspaceId).toBeTruthy();
    const row = await db.user.findUnique({ where: { email: u.email } });
    expect(row).not.toBeNull();
    expect(row?.passwordHash.startsWith("scrypt$")).toBe(true);
  });

  test("rejects duplicate email with 409 EMAIL_TAKEN", async () => {
    const u = await registerUser("dup");
    // sanity: login with the account works
    const login = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
      body: { email: u.email, password: "password123" },
      ip: u.ip,
    });
    expect(login.status).toBe(200);

    const { POST } = await import("@/app/api/v1/auth/register/route");
    const dup = await callRoute({ POST }, "POST", `${AUTH}/register`, {
      body: { name: "Other User", email: u.email, password: "password456" },
      ip: `10.78.0.1`,
    });
    expect(dup.status).toBe(409);
    const body = await jsonBody(dup);
    expect((body.error as { code: string }).code).toBe("EMAIL_TAKEN");
  });

  test("rejects weak password and malformed email with 422", async () => {
    const { POST } = await import("@/app/api/v1/auth/register/route");
    const weak = await callRoute({ POST }, "POST", `${AUTH}/register`, {
      body: { name: "Weak Pass", email: `weak-${Date.now()}-a@test.local`, password: "short" },
      ip: "10.78.0.2",
    });
    expect(weak.status).toBe(422);

    const badEmail = await callRoute({ POST }, "POST", `${AUTH}/register`, {
      body: { name: "Bad Email", email: "not-an-email", password: "password123" },
      ip: "10.78.0.3",
    });
    expect(badEmail.status).toBe(422);
  });
});

describe("auth: login + session restoration", () => {
  test("valid login returns token + memberships", async () => {
    const u = await registerUser("login");
    const res = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
      body: { email: u.email, password: "password123" },
      ip: u.ip,
    });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect(data.token).toBeTruthy();
    const memberships = data.memberships as { workspaceId: string }[];
    expect(memberships[0].workspaceId).toBe(u.workspaceId);
  });

  test("wrong password → 401 INVALID_CREDENTIALS (no user enumeration)", async () => {
    const u = await registerUser("wrongpw");
    const res = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
      body: { email: u.email, password: "definitely-wrong" },
      ip: `10.78.1.1`,
    });
    expect(res.status).toBe(401);
    const body = await jsonBody(res);
    expect((body.error as { code: string }).code).toBe("INVALID_CREDENTIALS");

    // Unknown email gives the SAME code (no account existence leak)
    const res2 = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
      body: { email: `ghost-${Date.now()}@test.local`, password: "whatever123" },
      ip: "10.78.1.2",
    });
    expect(res2.status).toBe(401);
    const body2 = await jsonBody(res2);
    expect((body2.error as { code: string }).code).toBe("INVALID_CREDENTIALS");
  });

  test("Bearer token restores session (GET /auth/me)", async () => {
    const u = await registerUser("restore");
    const res = await callRoute({ GET: meGET }, "GET", `${AUTH}/me`, { token: u.token });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect((data.user as { email: string }).email).toBe(u.email);
  });

  test("cookie session also works", async () => {
    const u = await registerUser("cookie");
    const jar = new Map<string, string>();
    const loginRes = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
      body: { email: u.email, password: "password123" },
      ip: u.ip,
      cookieJar: jar,
    });
    expect(loginRes.status).toBe(200);

    // The login handler stored the session cookie in the (mocked) cookie store
    const cookieToken = jar.get("nexora_session");
    expect(cookieToken).toBeTruthy();

    // Use ONLY the cookie (no Authorization header)
    const res = await callRoute({ GET: meGET }, "GET", `${AUTH}/me`, { cookie: cookieToken });
    expect(res.status).toBe(200);
    const data = await jsonBody(res);
    expect((data.user as { email: string }).email).toBe(u.email);
  });

  test("expired sessions are rejected and cleaned up", async () => {
    const u = await registerUser("expired");
    expect((await callRoute({ GET: meGET }, "GET", `${AUTH}/me`, { token: u.token })).status).toBe(200);

    const session = await db.session.findFirst({ where: { userId: u.userId } });
    expect(session).not.toBeNull();
    await db.session.update({
      where: { id: session!.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await callRoute({ GET: meGET }, "GET", `${AUTH}/me`, { token: u.token });
    expect(res.status).toBe(401);
    // Session record deleted after expiry detection
    const gone = await db.session.findUnique({ where: { id: session!.id } });
    expect(gone).toBeNull();
  });

  test("logout invalidates the session", async () => {
    const u = await registerUser("logout");
    const res = await callRoute({ POST: logoutPOST }, "POST", `${AUTH}/logout`, { token: u.token });
    expect(res.status).toBe(200);
    const after = await callRoute({ GET: meGET }, "GET", `${AUTH}/me`, { token: u.token });
    expect(after.status).toBe(401);
  });

  test("unauthenticated requests are rejected with 401", async () => {
    const res = await callRoute({ GET: meGET }, "GET", `${AUTH}/me`);
    expect(res.status).toBe(401);
  });
});

describe("auth: password change", () => {
  test("changes password, keeps current session, kills others", async () => {
    const u = await registerUser("pwchange");
    // Second session for the same account
    const second = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
      body: { email: u.email, password: "password123" },
      ip: u.ip,
    });
    const secondToken = ((await jsonBody(second)) as { token: string }).token;

    // Wrong current password → 400 WRONG_PASSWORD
    const wrong = await callRoute({ POST: passwordPOST }, "POST", `${AUTH}/password`, {
      body: { currentPassword: "nope-wrong", newPassword: "newpassword99" },
      token: u.token,
    });
    expect(wrong.status).toBe(400);
    expect(((await jsonBody(wrong)).error as { code: string }).code).toBe("WRONG_PASSWORD");

    // Correct change
    const okRes = await callRoute({ POST: passwordPOST }, "POST", `${AUTH}/password`, {
      body: { currentPassword: "password123", newPassword: "newpassword99" },
      token: u.token,
    });
    expect(okRes.status).toBe(200);

    // Current session still valid
    expect((await callRoute({ GET: meGET }, "GET", `${AUTH}/me`, { token: u.token })).status).toBe(200);
    // Other session invalidated
    expect((await callRoute({ GET: meGET }, "GET", `${AUTH}/me`, { token: secondToken })).status).toBe(401);
    // Old password no longer works, new one does
    const oldPw = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
      body: { email: u.email, password: "password123" },
      ip: `10.78.2.1`,
    });
    expect(oldPw.status).toBe(401);
    const newPw = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
      body: { email: u.email, password: "newpassword99" },
      ip: `10.78.2.2`,
    });
    expect(newPw.status).toBe(200);
  });
});

describe("auth: abuse protection", () => {
  test("login rate limit returns 429 after repeated failures for one account", async () => {
    const u = await registerUser("ratelimit");
    let lastStatus = 0;
    for (let i = 0; i < 12; i++) {
      // different IP each time — the per-account limit must still catch it
      const res = await callRoute({ POST: loginPOST }, "POST", `${AUTH}/login`, {
        body: { email: u.email, password: "bad-guess-" + i },
        ip: `10.79.${i}.1`,
      });
      lastStatus = res.status;
      if (res.status === 429) break;
    }
    expect(lastStatus).toBe(429);
  });

  test("language preference persists via PATCH /auth/me", async () => {
    const u = await registerUser("locale");
    const patch = await callRoute({ PATCH: mePATCH }, "PATCH", `${AUTH}/me`, {
      body: { locale: "en" },
      token: u.token,
    });
    expect(patch.status).toBe(200);
    const me = await callRoute({ GET: meGET }, "GET", `${AUTH}/me`, { token: u.token });
    const data = await jsonBody(me);
    expect((data.user as { locale: string }).locale).toBe("en");
  });
});
