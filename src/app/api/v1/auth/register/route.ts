import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, hashPassword, rateLimit, clientIp } from "@/lib/server/auth";
import { fail, handler, ok, parseBody, HttpError } from "@/lib/server/api";
import { audit } from "@/lib/server/activity";

const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email().max(160),
  password: z.string().min(8).max(128),
  workspaceName: z.string().min(1).max(80).optional(),
  locale: z.enum(["fa", "en"]).optional(),
});

function defaultStageNames(locale: string) {
  if (locale === "en") {
    return {
      qualification: "Qualification",
      discovery: "Discovery",
      proposal: "Proposal",
      negotiation: "Negotiation",
      won: "Won",
      lost: "Lost",
    };
  }
  return {
    qualification: "ارزیابی",
    discovery: "کشف نیاز",
    proposal: "پیشنهاد",
    negotiation: "مذاکره",
    won: "برده‌شده",
    lost: "باخته‌شده",
  };
}

export const POST = handler(async (req) => {
  const ip = clientIp(req);
  if (!rateLimit(`register:${ip}`, 8, 10 * 60 * 1000)) {
    return fail(429, "RATE_LIMITED", "Too many attempts.");
  }
  const body = await parseBody(req, registerSchema);
  const email = body.email.toLowerCase().trim();

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return fail(409, "EMAIL_TAKEN", "Email already registered.");
  }

  const locale = body.locale === "en" ? "en" : "fa";
  const user = await db.user.create({
    data: {
      name: body.name.trim(),
      email,
      passwordHash: hashPassword(body.password),
      locale,
    },
  });

  await db.workspace.create({
    data: {
      name: (body.workspaceName ?? (locale === "en" ? "My Workspace" : "فضای کاری من")).trim(),
      ownerId: user.id,
      memberships: { create: { userId: user.id, role: "OWNER" } },
      pipelines: {
        create: {
          name: locale === "en" ? "Sales Pipeline" : "قیف فروش",
          isDefault: true,
          stages: {
            create: (() => {
              const names = defaultStageNames(locale);
              return [
                { key: "qualification", name: names.qualification, order: 1, probability: 10, type: "OPEN" },
                { key: "discovery", name: names.discovery, order: 2, probability: 25, type: "OPEN" },
                { key: "proposal", name: names.proposal, order: 3, probability: 50, type: "OPEN" },
                { key: "negotiation", name: names.negotiation, order: 4, probability: 75, type: "OPEN" },
                { key: "won", name: names.won, order: 5, probability: 100, type: "WON" },
                { key: "lost", name: names.lost, order: 6, probability: 0, type: "LOST" },
              ];
            })(),
          },
        },
      },
    },
  });

  const membership = await db.membership.findFirstOrThrow({ where: { userId: user.id } });
  await audit({
    workspaceId: membership.workspaceId,
    userId: user.id,
    action: "CREATE",
    entityType: "workspace",
  });

  // Token is also returned in the body so the client can use Bearer-header
  // auth when cookies are blocked (e.g. cross-site iframe preview).
  const token = await createSession(user.id);

  const memberships = await db.membership.findMany({
    where: { userId: user.id },
    include: { workspace: true },
  });

  return ok(
    {
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
    },
    201
  );
});

export const dynamic = "force-dynamic";
