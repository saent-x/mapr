import { test, expect } from "@playwright/test";

// Sign in if the account exists, otherwise create it (idempotent across runs).
async function signInOrUp(page, email, password) {
  await page.goto("/signin");
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  if (await page.locator(".composer").isVisible({ timeout: 6000 }).catch(() => false)) return;
  await page.goto("/signin");
  await page.locator(".auth-tabs button", { hasText: "Create account" }).click();
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('form button[type="submit"]').click();
  await expect(page.locator(".composer")).toBeVisible({ timeout: 30_000 });
}

test("admin page renders real ingestion health + source catalog for an admin", async ({ page }) => {
  // e2e-admin@mapr.test is granted role=admin via ADMIN_EMAILS on first sign-up.
  await signInOrUp(page, "e2e-admin@mapr.test", "watchdesk-admin-2026");
  await page.goto("/admin");
  // Real health stats (admin.health: events6h, sources, tier mix).
  await expect(page.locator(".stats .stat").first()).toBeVisible({ timeout: 25_000 });
  await expect(page.locator(".tier-ribbon")).toBeVisible({ timeout: 15_000 });
  // Sources tab → the real source catalog table.
  await page.locator(".pbar-tab", { hasText: "Sources" }).click();
  await expect(page.locator(".tbl tbody tr").first()).toBeVisible({ timeout: 15_000 });
});

test("admin surface is gated: a non-admin sees the admins-only wall", async ({ page }) => {
  const email = `analyst+${Date.now()}@mapr.test`;
  await signInOrUp(page, email, "watchdesk-2026");
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: /Admins only/i })).toBeVisible({ timeout: 20_000 });
});
