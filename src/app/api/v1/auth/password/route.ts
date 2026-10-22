import { z } from "zod";
import { db } from "@/lib/db";
import { fail, handler, ok, parseBody, requireAuth } from "@/lib/server/api";
import { hashPassword, verifyPassword, getRequestToken, rateLimit } from "@/lib/server/auth";
import { createHash } from "crypto";

const schema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export const POST = handler(async (req) => {
  const auth = await requireAuth();
  // Throttle current-password verification (slows brute-force of a hijacked session)
  if (!rateLimit(`password:${auth.id}`, 10, 5 * 60 * 1000)) {
    return fail(429, "RATE_LIMITED", "Too many attempts.");
  }
  const body = await parseBody(req, schema);
  const user = await db.user.findUniqueOrThrow({ where: { id: auth.id } });
  if (!verifyPassword(body.currentPassword, user.passwordHash)) {
    return fail(400, "WRONG_PASSWORD", "Current password is incorrect.");
  }
  await db.user.update({
    where: { id: auth.id },
    data: { passwordHash: hashPassword(body.newPassword) },
  });
  // Invalidate all other sessions; keep the current one active
  // (works with both cookie and Bearer-token sessions)
  const currentToken = await getRequestToken();
  const currentHash = currentToken ? createHash("sha256").update(currentToken).digest("hex") : null;
  await db.session.deleteMany({
    where: { userId: auth.id, ...(currentHash ? { tokenHash: { not: currentHash } } : {}) },
  });
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
