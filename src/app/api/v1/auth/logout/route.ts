import { handler, ok } from "@/lib/server/api";
import { destroySession } from "@/lib/server/auth";

export const POST = handler(async () => {
  await destroySession();
  return ok({ success: true });
});

export const dynamic = "force-dynamic";
