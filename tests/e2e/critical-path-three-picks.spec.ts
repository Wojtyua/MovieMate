import { test, expect } from "@playwright/test";

/**
 * Risk #3 (test-plan §2) — the multi-step critical path must render THREE picks
 * on screen, not just return a 200 / change the URL. Crosses real boundaries:
 * auth (storageState) → routing → POST /api/recommendations → DB → SSR PicksGrid.
 *
 * Modeled on seed.spec.ts. Real vs mocked: auth, routing, Supabase, and
 * SSR-on-workerd stay real; TMDB is used live (server-side, by decision —
 * degradation/mocking is Risk #2 at the integration layer). Determinism comes from
 * a single common genre + an empty Note (the genre-only retrieval rung).
 *
 * The assertion fails exactly when the risk materializes: if the pipeline drains
 * the pool, the page renders its empty state (0 articles) and toHaveCount(3) fails.
 */
test("three picks render end-to-end for a solo session", async ({ page }) => {
  // Start authenticated (storageState) at the preferences form.
  await page.goto("/sessions");

  // Pick one preferred genre. The genre name is also a button in the Avoid picker,
  // and the Preferred picker renders first — .first() scopes to it without coupling
  // to CSS/DOM structure. Leave the Note empty so retrieval stays on the
  // deterministic genre-only rung (a note triggers the non-deterministic AI path).
  await page.getByRole("button", { name: "Action", exact: true }).first().click();

  // Submit and wait for the picks page (state, not time).
  await page.getByRole("button", { name: /Get tonight's picks/ }).click();
  await page.waitForURL("**/sessions/*/recommendations");

  // Core risk-tied assertion: exactly three picks render on screen.
  await expect(page.getByRole("article")).toHaveCount(3);

  // The three picks are real, role-labelled cards (solo branch: safe /
  // crowd_pleaser / wild_card), each with a title — not an empty state.
  await expect(page.getByText("Safe pick")).toBeVisible();
  await expect(page.getByText("Crowd-pleaser")).toBeVisible();
  await expect(page.getByText("Wild card")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveCount(3);
});
