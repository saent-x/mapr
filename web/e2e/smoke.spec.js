import { test, expect } from "@playwright/test";

async function dismissCold(page) {
  const explore = page.locator(".cold-btn.btn-ghost");
  if (await explore.isVisible().catch(() => false)) {
    await explore.click();
    await page.waitForTimeout(400);
  }
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

test("console renders the live event feed on the real choropleth map", async ({ page }) => {
  await page.goto("/");
  await dismissCold(page);
  // The MapLibre GL canvas mounts and the live Convex feed populates the count.
  await expect(page.locator(".sw-maplibre canvas").first()).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => Number((await page.locator(".tb-status-text b").first().textContent()) || 0), { timeout: 30_000 })
    .toBeGreaterThan(50);
});

test("sign up creates a real account and lands authenticated on the console", async ({ page }) => {
  await signUp(page);
  await expect(page).toHaveURL(/127\.0\.0\.1:5174\/?$/);
  const hasToken = await page.evaluate(() =>
    Object.keys(localStorage).some((k) => /convexAuth|auth.*jwt|__convex/i.test(k) && !!localStorage.getItem(k)),
  );
  expect(hasToken).toBeTruthy();
});

test("trends card computes real severity activity over the owned corpus", async ({ page }) => {
  await page.goto("/");
  await dismissCold(page);
  await page.locator('.tb-icon[title="Trends"]').click();
  const card = page.locator(".thread .card").first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  // Deterministic, corpus-computed bottom line (not the synthetic mock copy).
  await expect(card.locator(".bottomline")).toContainText(/located events over the last/i, { timeout: 20_000 });
  await expect(card.locator(".trend-row").first()).toBeVisible();
});

test("signals drawer shows real computed anomalies (movers) from the corpus", async ({ page }) => {
  await page.goto("/");
  await dismissCold(page);
  await page.locator(".menu-btn").click();
  await page.locator(".menu-item", { hasText: "Signals" }).click();
  const drawer = page.locator(".drawer");
  await expect(drawer).toBeVisible({ timeout: 15_000 });
  // Deterministic recency-weighted mover (trends.anomalies), not the synthetic mock.
  await expect(drawer.locator(".list-item").first()).toContainText(/vs prior window/i, { timeout: 15_000 });
});

test("entities drawer + dossier render real co-occurrence data from the corpus", async ({ page }) => {
  await page.goto("/");
  await dismissCold(page);
  await page.locator(".menu-btn").click();
  await page.locator(".menu-item", { hasText: "Entities" }).click();
  const drawer = page.locator(".drawer");
  await expect(drawer.locator(".list-item .li-title").first()).toBeVisible({ timeout: 15_000 });
  await drawer.locator(".list-item").first().click();
  const card = page.locator(".thread .card").first();
  await expect(card.locator(".card-q .qt")).toContainText(/entity lens/i, { timeout: 20_000 });
  // Deterministic facts computed over the corpus (Events (7d) etc.).
  await expect(card.locator(".fact .fv").first()).toBeVisible({ timeout: 15_000 });
});

test("feeds drawer shows the real ingested source catalog", async ({ page }) => {
  await page.goto("/");
  await dismissCold(page);
  await page.locator(".menu-btn").click();
  await page.locator(".menu-item", { hasText: "Feeds" }).click();
  const drawer = page.locator(".drawer");
  await expect(drawer.locator(".feed-item .feed-name").first()).toBeVisible({ timeout: 15_000 });
  await expect(drawer.locator(".sov-banner")).toContainText(/active source/i);
});

test("investigate runs real RAG over the owned corpus and returns a grounded answer", async ({ page }) => {
  test.setTimeout(150_000); // qwen2.5:3b generation on CPU can be slow
  await signUp(page);
  await dismissCold(page);

  const ta = page.locator(".input-row textarea");
  await ta.fill("What is driving maritime and shipping risk in the Gulf this week?");
  await ta.press("Enter");

  // The deterministic "computing" state appears, then a real grounded card.
  const card = page.locator(".thread .card").first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  // The generated bottom line (real qwen output over the owned corpus).
  await expect(card.locator(".bottomline, .answer-prose").first()).toBeVisible({ timeout: 130_000 });
  // Computed deterministic source-strength strip is present.
  await expect(card.locator(".strength").first()).toBeVisible({ timeout: 5_000 });
});
