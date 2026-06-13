import { test as setup, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";

const authFile = "playwright/.auth/user.json";

/**
 * Mint a fresh, logged-in user once per run and persist the session so every test
 * starts authenticated — login is never a per-test dependency (Risk #3 / lesson
 * rule). Local Supabase has email confirmation disabled
 * (`supabase/config.toml` → enable_confirmations = false), so signup returns a
 * live session immediately.
 *
 * Signup goes through the API endpoint, not the form UI: the endpoint reads
 * email/password server-side, so we sidestep the controlled-input hydration race
 * on the React form island. `page.request` shares the browser context's cookie
 * jar, so the Supabase session cookies it sets are captured by `storageState`.
 *
 * A unique email per run keeps re-runs collision-free (no teardown needed).
 */
setup("authenticate", async ({ page }) => {
  mkdirSync("playwright/.auth", { recursive: true });

  const email = `e2e-${Date.now()}@example.com`;
  const password = "e2e-password-123";

  // Astro's CSRF guard rejects form-encoded POSTs whose Origin doesn't match the
  // site (a real browser form submit sends it automatically); set it explicitly.
  const res = await page.request.post("/api/auth/signup", {
    form: { email, password },
    headers: { Origin: "http://localhost:4321" },
  });
  expect(res.ok()).toBeTruthy();

  // Prove the session is real through the browser: a protected route renders
  // without bouncing to /auth/signin (the middleware guard).
  await page.goto("/sessions");
  await expect(page.getByRole("button", { name: /Get tonight's picks/ })).toBeVisible();

  await page.context().storageState({ path: authFile });
});
