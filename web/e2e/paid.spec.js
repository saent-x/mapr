import { test, expect } from "@playwright/test";

async function dismissCold(page) {
  const explore = page.locator(".cold-btn.btn-ghost");
  if (await explore.isVisible().catch(() => false)) { await explore.click(); await page.waitForTimeout(400); }
}
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

test("create a standing watch freezes a real baseline and renders a deterministic diff report", async ({ page }) => {
  test.setTimeout(160_000);
  await signUp(page);
  await dismissCold(page);
  // Investigate to scope a region (sets the REGION chip the watch is built from).
  const ta = page.locator(".input-row textarea");
  await ta.fill("What is driving conflict and humanitarian risk in Sudan this week?");
  await ta.press("Enter");
  await expect(page.locator(".thread .card .bottomline, .thread .card .answer-prose").first()).toBeVisible({ timeout: 135_000 });
  // "Watch this scope" → createWatchWithBaseline (freezes a baseline) → Watches drawer.
  await page.locator(".thread .card .move.primary").first().click();
  const drawer = page.locator(".drawer");
  await expect(drawer.locator(".list-item .li-title").first()).toBeVisible({ timeout: 20_000 });
  // Open the watch → the real Baseline Diff Report (computeWatchDiff).
  await drawer.locator(".list-item").first().click();
  await expect(page.locator(".diff-grid").first()).toBeVisible({ timeout: 20_000 });
});

test("cases are Pro-gated server-side: a free user hits the real upgrade paywall", async ({ page }) => {
  await signUp(page);
  await dismissCold(page);
  await page.locator(".menu-btn").click();
  await page.locator(".menu-item", { hasText: "Cases" }).click();
  await page.locator(".drawer .btn-block", { hasText: "New case" }).click();
  // cases.create throws FEATURE_LOCKED for free → the app opens the upgrade modal.
  await expect(page.locator(".plans").first()).toBeVisible({ timeout: 15_000 });
});
