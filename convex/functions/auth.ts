import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

/**
 * Email + password auth (no third-party email transport). On a fresh account the
 * afterUserCreatedOrUpdated callback seeds app/billing defaults and grants admin
 * to any address listed in ADMIN_EMAILS.
 */
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password<DataModel>()],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId }) {
      const user = await ctx.db.get(userId);
      if (!user || user.createdAt !== undefined) return;
      // First admin(s) are granted declaratively via the ADMIN_EMAILS env
      // (comma-separated) — set it before that account's first sign-in.
      const adminEmails = (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      const isAdmin = !!user.email && adminEmails.includes(user.email.toLowerCase());
      await ctx.db.patch(userId, {
        role: isAdmin ? "admin" : user.role ?? "user",
        subscriptionStatus: user.subscriptionStatus ?? "free",
        createdAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.users.applyPendingBilling, { userId });
    },
  },
});
