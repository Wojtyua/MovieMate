# Page-Transition White Flash — View Transitions Implementation Plan

## Overview

Eliminate the full-screen white flash on page-to-page navigation by adopting
**Astro View Transitions** (`<ClientRouter />`): client-side navigations swap the
DOM in place instead of doing a full document teardown + reload, so the browser
never paints the white document canvas between pages. A one-line companion
(`html { background-color: #0a0e1a }`) closes the same white on the paths VT does
_not_ cover — first load, hard reload (Cmd-R), and overscroll bounce.

## Current State Analysis

The frame brief (`frame.md`, confidence HIGH) established that the flash is a
**white document canvas** exposed during navigation, because:

- `:root --background` is `oklch(1 0 0)` = white (`global.css:8`) and the `.dark`
  class is never applied, so the document root resolves to white.
- The dark cosmic gradient lives only on a nested `<div class="bg-cosmic …">`
  (`Layout.astro:26`), and the scoped `html, body` style (`Layout.astro:53-60`)
  sets no background — so the `html` canvas stays white.
- `astro.config.mjs:11` is `output: "server"` with **no View Transitions**
  (`integrations: [react(), sitemap()]`), so every navigation is a full
  fresh-document load. Between the old document unloading and the new one
  painting, the browser shows the new document's (white) canvas → the flash.

The user chose **View Transitions as the fix mechanism** (rather than painting the
document root dark / activating the dormant `.dark` theme). VT removes the flash
on the _reported_ path — clicking navbar links — by avoiding the full reload.

### Codebase facts that shape the VT integration (verified during research):

- **Astro 6.3.1** (`package.json`) → the API is `<ClientRouter />` imported from
  `astro:transitions`, placed in `<head>`. Works with `output: "server"` +
  `@astrojs/cloudflare`.
- **No inline `<script>` anywhere** in `src/**/*.astro` (grep clean) — the single
  biggest VT footgun (scripts bound to `DOMContentLoaded` that don't re-run after
  a swap) does not exist here.
- **All React islands are `client:load`** (`sessions.astro:73`,
  `auth/signin.astro:16`, `auth/signup.astro:16`,
  `sessions/[id]/recommendations.astro:56`) — Astro automatically re-hydrates
  islands after each swap (on `astro:page-load`); no code change needed.
- **Topbar must re-render per navigation** (`Topbar.astro:7-8`): it computes the
  active-link highlight from `Astro.url.pathname` and reads `Astro.locals.user`.
  Persisting it (`transition:persist`) would freeze the highlight on the previous
  page — so the default swap behavior is correct and **no `transition:persist` is
  used**.
- **Sign-out is a POST form** (`Topbar.astro:41`) and several pages issue
  server-side auth redirects; ClientRouter intercepts form submissions and
  follows redirects on client navigation — a manual-verify checkpoint.

## Desired End State

Clicking any navbar link (MovieMate / Movie night / Taste core / Sign in / Sign
up) transitions with a smooth default fade and **no white frame**. Direct URL
entry, hard reload, and overscroll show the dark canvas, never white. React
islands remain interactive after navigation, and sign-out still works. An
automated guard asserts client navigations do not trigger a full document reload
and that the `html` canvas is never white.

### Key Discoveries:

- VT API for Astro 6 is `import { ClientRouter } from "astro:transitions"` placed
  in `<head>` (`Layout.astro:16-21`).
- The white canvas is the `html` element's (absent) background — the companion
  fix is one declaration in the existing scoped `<style>` (`Layout.astro:53-60`).
- The default Astro fade uses the native View Transitions API with an automatic
  animation fallback for browsers without it, and respects
  `prefers-reduced-motion` (animation auto-disabled) — no extra work for either.

## What We're NOT Doing

- **Not activating the dormant `.dark` theme** (`global.css:41-73`) and not
  changing any `:root` token. The companion fix paints only the `html` canvas
  color; component tokens (buttons, etc.) stay exactly as they are today.
- **Not adding custom per-element motion** (`transition:name` / `transition:animate`
  choreography). Default fade only. Bespoke motion is a possible later polish.
- **Not persisting any shell element** across navigations (`transition:persist`),
  because the Topbar's active-link state must refresh per page.
- **Not changing `output: "server"`, the adapter, or any API route.**

## Implementation Approach

Two phases. Phase 1 is the change itself — enable `<ClientRouter />` and add the
one-line canvas companion, both in `Layout.astro` — and verify the existing app
(islands, forms, redirects) still behaves under SPA-style navigation. Phase 2
adds a deterministic Playwright regression guard tied to the VT invariant: a
client navigation must preserve a `window` marker (proving no full reload) and
the `html` background must never be white.

## Critical Implementation Details

- **`<ClientRouter />` placement & lifecycle**: it must live in `<head>`
  (`Layout.astro`), not `<body>`. Once present, navigation no longer fires
  `DOMContentLoaded`/`load` on each page; lifecycle hooks are `astro:page-load`
  (runs on initial load _and_ after every swap) and `astro:after-swap`. This app
  has no inline scripts, so nothing needs migrating — but this is the rule to
  apply if any script is added later.
- **Topbar active-link correctness**: do **not** add `transition:persist` to the
  header/Topbar. Verify after wiring that navigating Movie night ↔ Taste core
  moves the underline highlight — if it sticks on the old link, something is
  being persisted that shouldn't be.

## Phase 1: Enable View Transitions + canvas companion

### Overview

Add `<ClientRouter />` to the document head so client navigations swap instead of
reloading, and paint the `html` canvas dark so the residual (first load / hard
reload / overscroll) is also covered.

### Changes Required:

#### 1. Layout head — enable ClientRouter

**File**: `src/layouts/Layout.astro`

**Intent**: Turn on Astro View Transitions app-wide so link clicks and form posts
swap the DOM in place rather than triggering a full-document reload — removing the
white-canvas frame on navigation. Use the default fade (no custom transition
config).

**Contract**: Import `ClientRouter` from `astro:transitions` in the component
frontmatter and render `<ClientRouter />` inside `<head>` (alongside the existing
`<meta>`/`<title>`). No props.

#### 2. Layout scoped style — paint the canvas

**File**: `src/layouts/Layout.astro`

**Intent**: Set the document-root canvas to the cosmic anchor color so the white
never shows on the paths VT does not intercept (direct URL entry, Cmd-R,
overscroll). No theme activation, no token changes.

**Contract**: In the existing scoped `<style>` block (`html, body { margin/width/
height }`), add `background-color: #0a0e1a;` to the `html, body` rule. This sits
outside any `@layer`, so it wins over the base-layer `body { @apply bg-background }`
without specificity tricks.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Clicking navbar links (MovieMate ↔ Movie night ↔ Taste core; Sign in/Sign up
  when logged out) shows a smooth fade and **no white flash**.
- Direct URL entry and hard reload (Cmd-R) on any route show the dark canvas, no
  white frame.
- Overscroll / rubber-band bounce shows dark, not white.
- React islands remain interactive after navigation: SignIn/SignUp forms accept
  input, the sessions preferences form works, PicksGrid renders.
- Sign-out (POST form) still signs the user out and lands on the correct page.
- The Topbar active-link underline updates correctly when moving between Movie
  night and Taste core (not frozen on the previous page).
- With `prefers-reduced-motion: reduce` set, navigation still has no white flash
  (animation disabled is fine).

**Implementation Note**: After completing this phase and all automated
verification passes, pause for manual confirmation that the navigation behavior
(no flash, islands, sign-out, active link) is correct before proceeding to
Phase 2.

---

## Phase 2: Regression guard (Playwright)

### Overview

Add a deterministic E2E spec that fails if View Transitions stop intercepting
navigation (full reload returns) or if the `html` canvas ever resolves to white —
locking the fix against future regressions. This is roadmap slice **S-09**
(rendering polish).

### Changes Required:

#### 1. No-full-reload + dark-canvas spec

**File**: `tests/e2e/view-transitions.spec.ts` (new)

**Intent**: Prove a client-side navigation is a SPA swap (not a document reload)
and that the document canvas is never white — the two invariants that together
mean "no white flash on navigation." Model on existing specs
(`tests/e2e/critical-path-three-picks.spec.ts`): `@playwright/test`, role-based
locators, state-not-time waits, runs under the authenticated `chromium` project
(storageState).

**Contract**: One test that (a) `page.goto("/sessions")`, sets a sentinel on
`window` via `page.evaluate` (a full reload would wipe it), (b) clicks the
`getByRole("link", { name: "Taste core" })` nav link and `waitForURL("**/profiles")`,
(c) asserts the sentinel still exists (→ no full reload → ClientRouter
intercepted), and (d) asserts `getComputedStyle(document.documentElement).backgroundColor`
is **not** `rgb(255, 255, 255)`. Use unique/timestamped values only if state is
written; this test reads nav state, so standard setup/teardown suffices.

### Success Criteria:

#### Automated Verification:

- E2E suite passes: `npm run test:e2e`
- The new spec is present and asserts both invariants (sentinel survives nav; html
  background ≠ white).

#### Manual Verification:

- Sanity-check the guard bites: temporarily removing `<ClientRouter />` makes the
  sentinel assertion fail (confirming the test detects a regression), then restore.

**Implementation Note**: After automated verification passes, pause for manual
confirmation before closing the plan.

---

## Testing Strategy

### Unit Tests:

- None — this is a layout/navigation behavior with no isolated unit surface.

### Integration / E2E Tests:

- `tests/e2e/view-transitions.spec.ts`: client navigation preserves a `window`
  sentinel (no full reload) and the `html` canvas is never `rgb(255,255,255)`.

### Manual Testing Steps:

1. `npm run dev`, log in, click between Movie night and Taste core — watch for any
   white frame (there should be none) and confirm the fade.
2. Hard-reload (Cmd-R) each route — dark canvas, no white.
3. Overscroll the page — dark, not white.
4. Submit the sign-out form — confirm logout + redirect.
5. On the sessions page, interact with the preferences form after navigating to it
   client-side — confirm the React island is live.
6. Toggle OS "reduce motion" and re-test navigation — no flash.

## Performance Considerations

ClientRouter adds a small client runtime and fetches the next page over `fetch`
before swapping; perceived navigation is typically faster (no full reload) for
same-origin links. No measurable regression expected on this small app.

## Migration Notes

None — no data or schema involved. Rollback is removing `<ClientRouter />` and the
one CSS line from `Layout.astro`.

## References

- Frame brief: `context/changes/page-transition-flash/frame.md`
- Roadmap slice S-09 (Stream E — Rendering polish): `context/foundation/roadmap.md`
- Source: `src/layouts/Layout.astro:14-60`, `src/styles/global.css:6-9,113-123`,
  `astro.config.mjs:10-16`, `src/components/Topbar.astro:1-15,41`
- Existing E2E pattern: `tests/e2e/critical-path-three-picks.spec.ts`,
  `playwright.config.ts`

## Open Risks & Assumptions

- **VT does not cover non-client-nav paths.** First load, hard reload, and
  overscroll are full-document paints VT cannot intercept. The Phase 1 companion
  line (`html` background) covers these, so the white is closed — but if that line
  is dropped, the white returns on those paths. The companion is load-bearing, not
  optional polish.
- **React 19 island re-hydration under VT.** Islands are `client:load` and
  re-hydrate on `astro:page-load`; expected to work, but explicitly manual-verified
  (forms + PicksGrid) because it is the riskiest interaction.
- **Form-post interception.** Sign-out posts through ClientRouter; verified
  manually that logout + redirect still complete.
- **Assumption:** no inline scripts will be added without migrating them to
  `astro:page-load` — recorded in Critical Implementation Details for future edits.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Enable View Transitions + canvas companion

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 471640c
- [x] 1.2 Linting passes: `npm run lint` — 471640c
- [x] 1.3 Production build succeeds: `npm run build` — 471640c

#### Manual

- [ ] 1.4 Navbar link clicks show smooth fade, no white flash
- [ ] 1.5 Direct entry + hard reload show dark canvas, no white
- [ ] 1.6 Overscroll bounce shows dark, not white
- [ ] 1.7 React islands interactive after navigation (forms, PicksGrid)
- [ ] 1.8 Sign-out POST form still logs out and redirects
- [ ] 1.9 Topbar active-link underline updates between pages
- [ ] 1.10 `prefers-reduced-motion` set: navigation has no white flash

### Phase 2: Regression guard (Playwright)

#### Automated

- [x] 2.1 E2E suite passes: `npm run test:e2e`
- [x] 2.2 New spec asserts both invariants (sentinel survives nav; html bg ≠ white)

#### Manual

- [ ] 2.3 Removing `<ClientRouter />` makes the guard fail, then restore
