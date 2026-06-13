import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the critical-path E2E layer (test-plan Phase 4 / Risk #3).
 *
 * - `webServer` starts `astro dev` (real workerd locally) on :4321 and reuses an
 *   already-running dev server outside CI.
 * - A `setup` project signs up a fresh user and saves the Supabase session to
 *   `playwright/.auth/user.json`; the `chromium` project injects it via
 *   `storageState`, so every test starts authenticated (login is never a
 *   per-test dependency).
 *
 * Prereqs to run: local Supabase up (`npm run db:start`) and `.dev.vars`
 * populated (SUPABASE_URL/KEY, TMDB_READ_ACCESS_TOKEN).
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4321",
    trace: "on-first-retry",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "playwright/.auth/user.json" },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
