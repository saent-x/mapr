import { getAuthUserId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;

export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  return await ctx.db.get(userId);
}

export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export async function requireAdmin(ctx: Ctx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") throw new Error("FORBIDDEN");
  return user;
}

/**
 * Trusted-worker auth for the Rust ingestor + migration job. The worker passes
 * a shared secret as a function argument, validated against MAPR_INGEST_KEY.
 * (The Convex transport is already admin-key authenticated on self-host; this
 * is defense-in-depth so ingest mutations are never callable by a logged-in
 * end user.)
 */
export function assertIngestKey(key: string | undefined): void {
  const expected = process.env.MAPR_INGEST_KEY;
  if (!expected) throw new Error("MAPR_INGEST_KEY not configured");
  if (key !== expected) throw new Error("FORBIDDEN_INGEST");
}
