# Page-Transition White Flash — Plan Brief

> Full plan: `context/changes/page-transition-flash/plan.md`
> Frame brief: `context/changes/page-transition-flash/frame.md`

## What & Why

A brief full-screen **white flash** appears when navigating between pages in this
dark-only app. We adopt **Astro View Transitions** (`<ClientRouter />`) so
client-side navigations swap the DOM in place instead of doing a full document
reload — removing the white-canvas frame on link clicks — plus a one-line
document-root paint that closes the same white on first load, hard reload, and
overscroll.

## Starting Point

The dark cosmic gradient lives on a nested `<div>` (`Layout.astro:26`) while the
document root (`html`) has no background and `:root --background` is white. With
`output: "server"` and no View Transitions, every navigation is a full reload that
briefly exposes the white `html` canvas between pages.

## Desired End State

Navbar link clicks transition with a smooth default fade and no white frame.
Direct URL entry, Cmd-R, and overscroll show the dark canvas, never white. React
islands stay interactive after navigation, sign-out still works, and an automated
guard asserts client nav does not full-reload and the canvas is never white.

## Key Decisions Made

| Decision                   | Choice                                         | Why (1 sentence)                                                                  | Source |
| -------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------- | ------ |
| Fix mechanism              | View Transitions (`<ClientRouter />`)          | User chose VT over painting the root dark / activating `.dark`.                   | Plan   |
| Animation                  | Astro default fade                             | Native, zero extra code, automatic fallback + respects reduced-motion.            | Plan   |
| First-load/reload residual | 1-line `html { background-color: #0a0e1a }`    | VT can't cover non-client-nav paints; one line closes them with no token changes. | Plan   |
| Shell persistence          | No `transition:persist` on Topbar              | Topbar's active-link highlight must refresh per page.                             | Plan   |
| Verification               | Playwright: no-full-reload + dark-canvas guard | Deterministic invariant tied to the fix; locks roadmap S-09 polish.               | Plan   |
| View Transitions vs root   | VT is the fix here, not the root-dark refactor | User's explicit scope choice; frame had parked VT as a separate enhancement.      | Frame  |

## Scope

**In scope:**

- Add `<ClientRouter />` to `Layout.astro` `<head>` (default fade).
- Add `html { background-color: #0a0e1a }` to Layout's scoped style.
- New Playwright regression spec.

**Out of scope:**

- Activating the dormant `.dark` theme or changing any `:root` token.
- Custom per-element motion (`transition:name`/`animate` choreography).
- `transition:persist` on any shell element.
- Any change to `output: "server"`, the adapter, or API routes.

## Architecture / Approach

One file does the work: `Layout.astro` gains `<ClientRouter />` in `<head>` and one
CSS line in its scoped `<style>`. Astro intercepts same-origin link clicks and form
posts, fetches the next page, and cross-fades the swap — no full reload, so no white
canvas. All islands are `client:load` (auto re-hydrate on `astro:page-load`); there
are no inline scripts to migrate. A Playwright spec proves the invariant.

## Phases at a Glance

| Phase                           | What it delivers                                   | Key risk                                           |
| ------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| 1. Enable VT + canvas companion | ClientRouter + 1-line root paint in `Layout.astro` | React island re-hydration / form-post interception |
| 2. Regression guard             | Playwright no-full-reload + dark-canvas spec       | Test must bite if ClientRouter is removed          |

**Prerequisites:** local Supabase up (`npm run db:start`) + `.dev.vars` populated, for the E2E suite.
**Estimated effort:** ~1 session, 2 small phases (one file + one spec).

## Open Risks & Assumptions

- VT does not cover first load / hard reload / overscroll — those rely entirely on
  the companion CSS line, which is load-bearing, not optional.
- React 19 islands re-hydrating under VT is expected but explicitly manual-verified
  (forms + PicksGrid) as the riskiest interaction.
- Assumes no inline scripts are added without migrating them to `astro:page-load`.

## Success Criteria (Summary)

- No white flash on navbar navigation; smooth fade between pages.
- Dark canvas on first load, hard reload, and overscroll — never white.
- Islands and sign-out still work; automated guard fails if VT or the dark canvas
  regresses.
