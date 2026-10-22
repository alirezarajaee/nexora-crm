import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, verifyPassword, rateLimit, clientIp } from "@/lib/server/auth";
import { fail, handler, ok, parseBody } from "@/lib/server/api";

const loginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(128),
});

export const POST = handler(async (req) => {
  const ip = clientIp(req);
  if (!rateLimit(`login:${ip}`, 20, 5 * 60 * 1000)) {
    return fail(429, "RATE_LIMITED", "Too many attempts.");
  }
  const body = await parseBody(req, loginSchema);
  const email = body.email.toLowerCase().trim();
  // Per-account throttle: stops distributed brute-force of one account even
  // when the attacker rotates spoofable proxy headers.
  if (!rateLimit(`login-account:${email}`, 10, 5 * 60 * 1000)) {
    return fail(429, "RATE_LIMITED", "Too many attempts for this account.");
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(body.password, user.passwordHash)) {
    return fail(401, "INVALID_CREDENTIALS", "Incorrect email or password.");
  }

  // Token is also returned in the body so the client can use Bearer-header
  // auth when cookies are blocked (e.g. cross-site iframe preview).
  const token = await createSession(user.id);

  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    include: { workspace: true },
    orderBy: { createdAt: "asc" },
  });

  return ok({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      locale: user.locale as "fa" | "en",
      createdAt: user.createdAt.toISOString(),
    },
    memberships: memberships.map((m) => ({
      workspaceId: m.workspaceId,
      role: m.role,
      workspace: {
        id: m.workspace.id,
        name: m.workspace.name,
        currency: m.workspace.currency,
        timezone: m.workspace.timezone,
        ownerId: m.workspace.ownerId,
      },
    })),
  });
});

export const dynamic = "force-dynamic";
