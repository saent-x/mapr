import { test, expect } from "@playwright/test";

async function signUp(page) {
  const email = `analyst+${Date.now()}-${Math.floor(performance.now())}@mapr.test`;
  await page.goto("/signin");
  await page.locator(".auth-tabs button", { hasText: "Create account" }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill("watchdesk-2026");
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator(".composer")).toBeVisible({ timeout: 30_000 });
  return email;
}

test("account page renders the real signed-in user, plan, and live quota", async ({ page }) => {
  const email = await signUp(page);
  await page.goto("/account");
  // Real user identity from users.me (not the synthetic Dana Okonkwo).
  await expect(page.locator(".acct-id .em")).toContainText(email, { timeout: 20_000 });
  // Free plan + the real free quota limit (10) from qa.quotaStatus / entitlements.
  await expect(page.locator(".plan-badge").first()).toContainText("FREE");
  await expect(page.locator(".usage-card .lim")).toContainText("10");
});

test("Go Pro launches a real Stripe checkout session", async ({ page }) => {
  test.setTimeout(70_000);
  await signUp(page);
  await page.goto("/account");
  const goPro = page.locator("button", { hasText: "Go Pro" });
  await expect(goPro).toBeVisible({ timeout: 20_000 });
  await goPro.click();
  // The real billing.createCheckout action returns a Stripe URL and the app
  // redirects there — proving the paywall is genuine, not client mock state.
  await page.waitForURL(/stripe\.com|checkout\.stripe/, { timeout: 45_000 });
  expect(page.url()).toMatch(/stripe/);
});
