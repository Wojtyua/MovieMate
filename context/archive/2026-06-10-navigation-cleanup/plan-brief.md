# Navigation Cleanup — Plan Brief

> Full plan: `context/changes/navigation-cleanup/plan.md`
> Frame brief: `context/changes/navigation-cleanup/frame.md`

## What & Why

The app's authenticated navigation is anchored to a redundant page: the navbar lives on only one screen (home) and its sole link points at a dead-end `/dashboard` that duplicates the home hero, leaving inner pages with no navigation at all. This change makes navigation coherent — every page gets the navbar, the navbar points at real destinations, and `/dashboard` is removed.

## Starting Point

`Topbar.astro` renders only inside the home page (`Welcome.astro`), and its only authed link is `/dashboard`. Inner pages (`/sessions`, `/profiles`, recommendations) render with no navbar and instead carry `← Dashboard` back-links. The dark cosmic background is applied per-page (each page's own `bg-cosmic min-h-screen` div), not globally — so the navbar can't simply move up to `Layout` without the background moving with it.

## Desired End State

Every page inherits a single app shell from `Layout.astro`: the dark cosmic background plus a navbar showing Home / Movie night / Taste core / Sign out (authed) with the current page highlighted, or Home + Sign in / Sign up (logged out). `/dashboard` is gone (404), removed from `PROTECTED_ROUTES`, and referenced nowhere. The home page reads as the canonical entry point.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Unit of work | Navigation coherence, not file deletion | Deleting `/dashboard` forces a navbar redesign since it was the navbar's only link | Frame |
| Navbar hosting | Move cosmic bg **and** navbar into `Layout.astro` | One true app shell matches the codebase's centralize-chrome convention | Plan |
| Background coupling | Shell owns `bg-cosmic`; strip per-page wrappers | Navbar styling needs the dark background; leaving per-page bg doubles the gradient and overflows | Plan |
| Auth-page centering | `flex-col` shell + `flex-1` main; cards center in main | Keeps centered auth cards from overflowing below the new navbar row | Plan |
| Navbar links (authed) | Home + Movie night + Taste core + Sign out | Surfaces every primary destination; makes home the canonical entry | Plan |
| Active state / scope | Highlight current link; navbar on all pages incl. auth | Clear "where am I"; simplest unconditional shell; logged-out home keeps Sign in/up | Plan |

## Scope

**In scope:** App shell in `Layout.astro` (cosmic bg + navbar); `Topbar.astro` link rework + active state; drop redundant background wrappers from Welcome / sessions / profiles / recommendations / auth pages; delete `dashboard.astro`; drop `/dashboard` from `PROTECTED_ROUTES`; remove `← Dashboard` back-links.

**Out of scope:** Recommendations pipeline, data model, API endpoints, auth logic/redirects; the home-only orbs/star field; automated tests; the recommendations page's `← Back to session` link.

## Architecture / Approach

`Layout.astro` becomes the app shell: a `bg-cosmic flex min-h-screen flex-col` container holding the config banners, `<Topbar/>` (a non-growing row), and a `flex-1 <main>` wrapping the `<slot/>`. Every page renders through it, so all chrome is inherited. Pages drop their own `bg-cosmic min-h-screen` wrappers; auth pages center their card inside the `flex-1` main. `Topbar.astro` reads `Astro.url.pathname` to highlight the active link.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Global app shell | Navbar + dark bg on every page; reworked links + active state; reconciled page wrappers | Splitting the Layout change from page reconciliation → overflow / doubled background |
| 2. Remove the dashboard | `/dashboard` deleted, dropped from `PROTECTED_ROUTES`, back-links removed | Leaving a dangling reference (mitigated: Phase 1 already drops the navbar's dashboard link) |

**Prerequisites:** None beyond the current codebase (S-02 / S-03 done).
**Estimated effort:** ~1 session across 2 phases; mechanical UI/IA edits.

## Open Risks & Assumptions

- Assumes the home-only orbs/star field should stay home-specific (not promoted to the shell) — preserved as-is.
- Assumes a navbar on auth pages is acceptable; auth cards re-center below it via the `flex-1` main.
- No automated tests exist yet, so regressions are caught by lint + `astro check` + build + manual visual review only.

## Success Criteria (Summary)

- Every page shows a legible navbar on the dark background with the current page highlighted.
- `/dashboard` 404s and is referenced nowhere; `/sessions` and `/profiles` stay auth-gated.
- The full home → sign in → session → recommendations journey works using only the navbar and on-page CTAs.
