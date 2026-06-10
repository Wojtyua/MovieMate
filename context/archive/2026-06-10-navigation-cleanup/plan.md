# Navigation Cleanup Implementation Plan

## Overview

Make the app's authenticated navigation coherent. Today the navbar lives on only one screen (home), its sole link points at a redundant `/dashboard` dead-end that duplicates the home hero, and inner pages render with no navigation at all. This plan establishes a single app shell — the dark cosmic background and a navbar — that every page inherits through `Layout.astro`, gives the navbar useful link targets (Home / Movie night / Taste core), and then removes the orphaned `/dashboard` page, its `PROTECTED_ROUTES` entry, and the `← Dashboard` back-links.

This is a pure UI / information-architecture change. It does not touch the recommendations pipeline, data model, or auth logic.

## Current State Analysis

- **The cosmic dark background is per-page, not global.** `body` is `bg-background text-foreground` (white in light mode — `global.css:8`); each page applies the dark gradient via `bg-cosmic min-h-screen` on its own wrapping `<div>`. The `bg-cosmic` utility is a `linear-gradient` (`global.css:113`). The navbar's translucent-white styling (`bg-white/5 text-white`, `Topbar.astro:6`) is only legible on top of that dark background.
- **`Layout.astro`** is the shared HTML shell every page renders through. It currently renders config banners + a bare `<slot/>` — no navbar, no background.
- **`Topbar.astro`** is rendered **only** inside `Welcome.astro` (home, `Welcome.astro:28`), inside that page's cosmic div. Authed, its sole nav link is `/dashboard` (`Topbar.astro:13`) plus email + Sign out; unauthed it shows "Not signed in" + Sign in / Sign up.
- **`dashboard.astro`** renders a greeting + links to `/profiles` and `/sessions` + Sign out — a strict subset of the home hero CTAs (`Welcome.astro:41-54`). Nothing routes to it: `signin.ts:19` and `callback.ts:26` both redirect to `/sessions`.
- **Back-links** `← Dashboard` exist on `sessions.astro:83` and `profiles.astro:34` (each inside a `mb-6 flex items-center justify-between` header next to the page `<h1>`). The recommendations page links `← Back to session` → `/sessions` (`sessions/[id]/recommendations.astro:66`) — correct, unchanged.
- **`middleware.ts:4`**: `PROTECTED_ROUTES = ["/dashboard", "/profiles", "/sessions"]`. The match is `startsWith`, so `/sessions` already covers `/sessions/[id]/recommendations`.
- **Auth pages** (`signin.astro`, `signup.astro`, `confirm-email.astro`) also use `Layout`, with a vertically-centered card via `flex min-h-screen items-center justify-center p-4`.
- **No test infrastructure exists yet** (Vitest not bootstrapped — see `test-plan.md` §3 Phase 1). Static/marketing snapshots are explicit negative space (`test-plan.md` §7). Verification here is lint + `astro check` + build + manual visual review.

## Desired End State

- Every page — home, sessions, profiles, recommendations, and the auth pages — renders the dark cosmic background and the navbar, inherited from `Layout.astro`.
- The navbar (authed) shows a brand/Home link, **Movie night** (`/sessions`), **Taste core** (`/profiles`), the user's email, and Sign out. The link matching the current path is visually highlighted. Unauthed, it shows the brand/Home link + Sign in / Sign up.
- `/dashboard` no longer exists, is no longer in `PROTECTED_ROUTES`, and is referenced from nowhere. No `← Dashboard` back-links remain.
- The home page is the canonical entry point and reads as such.

Verify by: loading each page logged-in and logged-out and confirming the navbar renders legibly on the dark background, the active link is highlighted, auth-page cards stay centered below the navbar, and `/dashboard` 404s. `npm run lint`, `npx astro check`, and `npm run build` all pass.

### Key Discoveries:

- The cosmic background lives per-page (`bg-cosmic min-h-screen` on each page's outer div), not on `body` — so hosting the navbar in `Layout.astro` requires moving the dark background up into the shell, or the navbar renders white-on-white. (`global.css:8`, `global.css:113`)
- `Topbar.astro` already branches on `Astro.locals.user`; the rework is link targets + active state, not auth logic.
- Auth pages rely on `min-h-screen items-center justify-center` for centering; once the shell owns `min-h-screen` and adds a navbar row, the centering must move to a `flex-1` main region (otherwise navbar + full-height card overflows the viewport).
- Nothing redirects to `/dashboard` (`signin.ts:19`, `callback.ts:26` → `/sessions`), so deletion is safe for the auth flow.

## What We're NOT Doing

- Not touching the recommendations pipeline, scoring, data model, or any API endpoint.
- Not changing auth logic or redirect targets (sign-in still lands on `/sessions`).
- Not restyling pages beyond removing the redundant per-page background wrappers and back-links.
- Not adding new pages or routes.
- Not removing the home-only decorative orbs / star field from `Welcome.astro` — those stay home-specific.
- Not writing automated tests (no test harness exists yet; that is `test-plan.md` §3 Phase 1/4 work).
- Not changing the `← Back to session` link on the recommendations page.

## Implementation Approach

Establish the app shell first (Phase 1) so navigation exists everywhere, then delete the dead-end (Phase 2). Ordering matters: Phase 1 rewrites `Topbar` to drop the `/dashboard` link, so by the time Phase 2 deletes the page there is no dangling navbar link at any intermediate state. The per-page background-wrapper cleanup is coupled to the `Layout` change and therefore lands together in Phase 1 — leaving a page's own `bg-cosmic min-h-screen` in place after the shell owns it would double the gradient and overflow the viewport.

## Critical Implementation Details

**State sequencing.** Phase 1 must reconcile **every** Layout-consuming page in the same phase that changes `Layout.astro`. The shell adds `min-h-screen` + a navbar row; any page that still carries its own `min-h-screen` will overflow (navbar height + full-screen content > viewport) and show a redundant gradient. Do not split the Layout change from the page reconciliation.

**User experience spec.** The shell must keep auth-page cards vertically centered. The robust structure is a `flex min-h-screen flex-col` shell with the navbar as a non-growing row and the `<slot/>` wrapped in a `flex-1` main; auth pages then center their card within that main (e.g. `flex h-full items-center justify-center`) instead of within the full viewport. This is the one non-obvious bit of the refactor.

## Phase 1: Global App Shell

### Overview

Move the cosmic background and the navbar into `Layout.astro` so every page inherits them, rework `Topbar.astro`'s links and add active-state highlighting, and reconcile each Layout-consuming page to drop its now-redundant background wrapper.

### Changes Required:

#### 1. App shell in Layout

**File**: `src/layouts/Layout.astro`

**Intent**: Make `Layout` own the dark background and the navbar so every page inherits coherent chrome, while preserving vertical centering for auth pages.

**Contract**: Wrap the body content in a `bg-cosmic flex min-h-screen flex-col` container. Render the existing config banners, then `<Topbar />` (imported here) as a non-growing row, then a `flex-1` `<main>` wrapping the existing `<slot/>`. The `flex-col` + `flex-1` structure is load-bearing — it lets auth pages center within the remaining space below the navbar.

#### 2. Navbar links + active state

**File**: `src/components/Topbar.astro`

**Intent**: Replace the single `/dashboard` link with the real destinations and highlight the link matching the current page. Keep the existing auth branching (authed vs Sign in / Sign up).

**Contract**: Authed state shows a brand/Home link (→ `/`), **Movie night** (→ `/sessions`), **Taste core** (→ `/profiles`), the user's email, and the existing Sign-out form. Unauthed state keeps the brand/Home link plus Sign in / Sign up. Derive the active link from `Astro.url.pathname` (use `startsWith` so `/sessions/[id]/recommendations` highlights Movie night) and apply an emphasized style (e.g. `text-white`/underline) to the active link versus the muted `text-purple-300` default.

#### 3. Drop the navbar + background wrapper from home

**File**: `src/components/Welcome.astro`

**Intent**: Stop rendering `<Topbar/>` here (the shell now provides it) and stop owning the cosmic background, while keeping the home-only decorative orbs and star field.

**Contract**: Remove the `Topbar` import and its usage (`Welcome.astro:2`, `:28`). On the outer wrapper, drop `bg-cosmic` and `min-h-screen` but keep `relative w-full overflow-hidden` so the absolutely-positioned orbs/star field still anchor correctly.

#### 4. Drop redundant background wrappers from content pages

**File**: `src/pages/sessions.astro`, `src/pages/profiles.astro`, `src/pages/sessions/[id]/recommendations.astro`

**Intent**: Let the shell own the background and page height; keep each page's inner content layout.

**Contract**: On each page's outer `<div class="bg-cosmic min-h-screen p-4">`, remove `bg-cosmic` and `min-h-screen` (keep `p-4` and the inner `mx-auto max-w-* py-*` content). Leave all other markup untouched in this phase (back-links are handled in Phase 2).

#### 5. Reconcile auth-page centering

**File**: `src/pages/auth/signin.astro`, `src/pages/auth/signup.astro`, `src/pages/auth/confirm-email.astro`

**Intent**: Keep the centered card now that the shell owns the background, height, and a navbar row.

**Contract**: On each auth page's outer `flex min-h-screen items-center justify-center p-4` wrapper, drop `bg-cosmic` and `min-h-screen` and center within the shell's `flex-1` main instead (e.g. `flex h-full items-center justify-center p-4`). Card markup is otherwise unchanged.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type/template check passes: `npx astro check`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Logged in, the navbar renders legibly on the dark background on home, `/sessions`, `/profiles`, and `/sessions/<id>/recommendations`, showing Home / Movie night / Taste core / email / Sign out.
- The link matching the current page is visibly highlighted; visiting `/sessions/<id>/recommendations` highlights Movie night.
- Logged out, the navbar shows the brand/Home link + Sign in / Sign up on home and on the auth pages.
- Auth-page cards (`/auth/signin`, `/auth/signup`, `/auth/confirm-email`) stay vertically centered below the navbar with no viewport overflow / double scrollbar.
- Home page still shows its decorative orbs / star field and the hero CTAs.
- No page shows a doubled or missing background.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to Phase 2.

---

## Phase 2: Remove the Dashboard

### Overview

Delete the orphaned `/dashboard` page, remove it from `PROTECTED_ROUTES`, and remove the `← Dashboard` back-links — now safe because the navbar (Phase 1) already provides navigation and no longer links to the dashboard.

### Changes Required:

#### 1. Delete the dashboard page

**File**: `src/pages/dashboard.astro`

**Intent**: Remove the redundant dead-end page.

**Contract**: Delete the file. After this, a request to `/dashboard` 404s.

#### 2. Drop `/dashboard` from protected routes

**File**: `src/middleware.ts`

**Intent**: Stop guarding a route that no longer exists.

**Contract**: Remove `"/dashboard"` from `PROTECTED_ROUTES` (`middleware.ts:4`), leaving `["/profiles", "/sessions"]`. No other middleware logic changes.

#### 3. Remove the back-links

**File**: `src/pages/sessions.astro`, `src/pages/profiles.astro`

**Intent**: Remove the `← Dashboard` back-links; navigation now lives in the navbar.

**Contract**: Delete the `<a href="/dashboard">← Dashboard</a>` element on `sessions.astro:83` and `profiles.astro:34`. Each lives in a `mb-6 flex items-center justify-between` header beside the page `<h1>`; with the link gone, simplify that header so the heading sits correctly (the `justify-between` no longer needs a second child).

### Success Criteria:

#### Automated Verification:

- No remaining references to `/dashboard`: `grep -rn "/dashboard" src` returns nothing (the only prior matches were the deleted page, middleware, Topbar, and the two back-links).
- Linting passes: `npm run lint`
- Type/template check passes: `npx astro check`
- Production build succeeds: `npm run build`

#### Manual Verification:

- Visiting `/dashboard` returns a 404 (page gone).
- `/sessions` and `/profiles` still load and are still gated behind auth (redirect to `/auth/signin` when logged out).
- The session and profiles page headers render cleanly with no leftover back-link or misaligned heading.
- The full journey home → Sign in → `/sessions` → preferences → recommendations still works, navigating only via the navbar and on-page CTAs.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful.

---

## Testing Strategy

No automated test harness exists yet (Vitest is bootstrapped in `test-plan.md` §3 Phase 1; e2e in Phase 4), and static page snapshots are explicit negative space (§7). Verification for this UI/IA change is the existing quality gates plus manual visual review.

### Manual Testing Steps:

1. Log in; visit home, `/sessions`, `/profiles`, and a recommendations page — confirm the navbar is present, legible, and highlights the current page.
2. Log out; confirm the navbar shows Home + Sign in / Sign up on home and auth pages, and that auth cards stay centered.
3. Visit `/dashboard` — confirm 404.
4. Confirm `/sessions` and `/profiles` redirect to `/auth/signin` when logged out (middleware still guards them).
5. Walk the full movie-night journey using only navbar + on-page CTAs.

## Performance Considerations

None. This is markup/styling only; no new data fetching or client JS. `Topbar.astro` reads `Astro.url.pathname`, already available during SSR.

## Migration Notes

No data migration. `/dashboard` had no inbound redirects, so no users land there; any stale bookmark will 404, which is acceptable for an internal dead-end.

## References

- Frame brief: `context/changes/navigation-cleanup/frame.md`
- Change identity: `context/changes/navigation-cleanup/change.md`
- Test strategy / negative space: `context/foundation/test-plan.md` (§3, §7)
- Shared-chrome convention: `src/layouts/Layout.astro`, `src/components/Topbar.astro`
- Cosmic background utility: `src/styles/global.css:113`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Global App Shell

#### Automated

- [x] 1.1 Linting passes: `npm run lint` — 4eeb535
- [x] 1.2 Type/template check passes: `npx astro check` — 4eeb535
- [x] 1.3 Production build succeeds: `npm run build` — 4eeb535

#### Manual

- [x] 1.4 Navbar renders legibly on dark background across home, sessions, profiles, recommendations (Home / Movie night / Taste core / email / Sign out) — 4eeb535
- [x] 1.5 Active link highlighted; recommendations page highlights Movie night — 4eeb535
- [x] 1.6 Logged-out navbar shows Home + Sign in / Sign up on home and auth pages — 4eeb535
- [x] 1.7 Auth-page cards stay vertically centered below the navbar, no overflow — 4eeb535
- [x] 1.8 Home still shows decorative orbs / star field and hero CTAs — 4eeb535
- [x] 1.9 No page shows a doubled or missing background — 4eeb535

### Phase 2: Remove the Dashboard

#### Automated

- [x] 2.1 No remaining `/dashboard` references: `grep -rn "/dashboard" src` is empty — 2194815
- [x] 2.2 Linting passes: `npm run lint` — 2194815
- [x] 2.3 Type/template check passes: `npx astro check` — 2194815
- [x] 2.4 Production build succeeds: `npm run build` — 2194815

#### Manual

- [x] 2.5 `/dashboard` returns 404 — 2194815
- [x] 2.6 `/sessions` and `/profiles` still gated (redirect to `/auth/signin` when logged out) — 2194815
- [x] 2.7 Session and profiles headers render cleanly with no leftover back-link — 2194815
- [x] 2.8 Full home → sign in → session → recommendations journey works via navbar + CTAs — 2194815
