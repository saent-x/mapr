import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against the LIVE local stack: a clean Chromium → Vite (5174) → the
 * self-hosted Convex backend (127.0.0.1:3210, real ingested data) → Ollama
 * (qwen2.5:3b + bge-m3). Nothing mocked. Run: `bunx playwright test`.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "bunx vite --port 5174 --host 127.0.0.1",
    url: "http://127.0.0.1:5174",
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
