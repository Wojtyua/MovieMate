import { test, expect } from "@playwright/test";

/**
 * Seed exemplar — the pattern every generated E2E test in this project follows.
 * "What you show is what you get": this seed demonstrates the four levers so the
 * generator reproduces them.
 *
 *  1. Role/label locators (getByRole / getByLabel) — never CSS/XPath/DOM structure.
 *  2. Wait for STATE (waitForURL / toBeVisible), never page.waitForTimeout().
 *  3. Auth via storageState (set up in auth.setup.ts) — no UI login here.
 *  4. A test name bound to a test-plan risk; the assertion fails if the risk
 *     materializes.
 *
 * Isolation: the `setup` project mints a unique user per run and each submit
 * creates a brand-new session row, so re-runs never collide — no teardown needed.
 *
 * Ties to: context/foundation/test-plan.md Risk #3 (the rendered critical path).
 */
test("solo session renders three on-screen picks (seed exemplar)", async ({ page }) => {
  // Setup: start authenticated at the preferences form.
  await page.goto("/sessions");

  // Action: select one preferred genre. The same genre name appears in both the
  // Preferred and Avoid pickers, and the Preferred picker renders first — so
  // .first() scopes to it without coupling to CSS/DOM structure. Leave the Note
  // empty so the pipeline stays on the deterministic genre-only retrieval rung.
  await page.getByRole("button", { name: "Action", exact: true }).first().click();
  await page.getByRole("button", { name: /Get tonight's picks/ }).click();

  // Wait for state: the picks page, not an arbitrary duration.
  await page.waitForURL("**/sessions/*/recommendations");

  // Assert the business outcome: three picks render on screen (not a 200 / URL).
  await expect(page.getByRole("article")).toHaveCount(3);
});
