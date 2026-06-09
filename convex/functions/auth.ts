import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

/**
 * Email + password auth. On a fresh account the afterUserCreatedOrUpdated
 * callback seeds app/billing defaults and grants admin to any address listed in
 * ADMIN_EMAILS.
 *
 * Email verification: the Password provider can take a `verify` EmailConfig to
 * require an OTP before an account is usable. It is intentionally NOT wired here
 * because the current web sign-up flow (web/src/sw/AuthPage.jsx) calls
 * signIn("password", { flow: "signUp" }) and signs the user in immediately — it
 * has no UI to collect a verification code, so enabling `verify` would break
 * sign-up. The ADMIN_EMAILS gate below is written to be forward-compatible: if
 * an operator later enables verification (see emailVerificationEnabled), the
 * admin auto-grant automatically requires a verified email with no further code
 * changes.
 */

/**
 * Whether email verification is effectively trusted on this deployment. True
 * only when a verification transport is configured AND the operator has opted
 * in via AUTH_REQUIRE_EMAIL_VERIFICATION. AUTH_RESEND_KEY alone is used for
 * digests/notifications and does NOT imply the auth sign-up flow verifies
 * email, so it is not sufficient on its own.
 */
function emailVerificationEnabled(): boolean {
  const optIn = (process.env.AUTH_REQUIRE_EMAIL_VERIFICATION ?? "").toLowerCase();
  const enabled = optIn === "1" || optIn === "true" || optIn === "yes";
  return enabled && !!process.env.AUTH_RESEND_KEY;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [Password<DataModel>()],
  callbacks: {
    async afterUserCreatedOrUpdated(ctx, { userId }) {
      const user = await ctx.db.get(userId);
      if (!user || user.createdAt !== undefined) return;
      // First admin(s) are granted declaratively via the ADMIN_EMAILS env
      // (comma-separated) — set it before that account's first sign-in.
      //
      // SECURITY: ADMIN_EMAILS is operator-controlled, and because the current
      // password flow does NOT verify email ownership, the operator MUST register
      // (or pre-create) the admin account themselves — listing an unregistered
      // address lets the first person to sign up with that email self-grant admin.
      // When email verification is enabled (emailVerificationEnabled), we
      // additionally require a verified email before granting admin, closing the
      // account-squatting window.
      const adminEmails = (process.env.ADMIN_EMAILS ?? "")
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
      const emailListed = !!user.email && adminEmails.includes(user.email.toLowerCase());
      const verificationTrusted = !emailVerificationEnabled() || user.emailVerificationTime !== undefined;
      const isAdmin = emailListed && verificationTrusted;
      await ctx.db.patch(userId, {
        role: isAdmin ? "admin" : user.role ?? "user",
        subscriptionStatus: user.subscriptionStatus ?? "free",
        createdAt: Date.now(),
      });
      await ctx.scheduler.runAfter(0, internal.users.applyPendingBilling, { userId });
    },
  },
});
