import { test, expect } from "@playwright/test";

/**
 * Regression guard for change `page-transition-flash` (roadmap S-09, rendering
 * polish). Two invariants together mean "no white flash on navigation":
 *
 *  1. NO FULL RELOAD on client navigation — proves Astro View Transitions
 *     (<ClientRouter />) is intercepting the nav and swapping the DOM in place.
 *     A sentinel set on `window` survives a VT swap (same execution context) but
 *     is wiped by a full document reload (fresh window). If ClientRouter is
 *     removed, the link click full-reloads and the sentinel assertion fails.
 *  2. DARK CANVAS — the document root (`html`) background is never white, so no
 *     white frame is exposed on full-document paints VT can't intercept.
 *
 * Follows the house pattern (seed.spec.ts): role locators, wait for STATE
 * (waitForURL), storageState auth via the `setup` project — no UI login here,
 * no page.waitForTimeout(). Reads navigation state only, so no teardown needed.
 */
test("client navigation swaps without a full reload and never shows a white canvas", async ({ page }) => {
  // Authenticated start (storageState) where the in-app nav links are present.
  await page.goto("/sessions");

  // Plant a sentinel on the live window. A View Transitions swap preserves the
  // window; a full document reload replaces it and wipes the sentinel.
  await page.evaluate(() => {
    (window as unknown as { __vtNoReload?: boolean }).__vtNoReload = true;
  });

  // Navigate via a real nav link (authenticated user sees "Taste core" → /profiles).
  await page.getByRole("link", { name: "Taste core" }).click();
  await page.waitForURL("**/profiles");

  // Invariant 1: the sentinel survived → ClientRouter intercepted, no full reload.
  const survivedSwap = await page.evaluate(
    () => (window as unknown as { __vtNoReload?: boolean }).__vtNoReload === true,
  );
  expect(survivedSwap).toBe(true);

  // Invariant 2: the document canvas is dark, never white.
  const htmlBackground = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  expect(htmlBackground).not.toBe("rgb(255, 255, 255)");
});
