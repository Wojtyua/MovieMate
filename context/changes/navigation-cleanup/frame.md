# Frame Brief: Navigation cleanup (remove dashboard / global navbar / home as entry)

> Framing step before /10x-plan. This document captures what is *actually*
> at issue, separated from what was initially assumed.

## Reported Observation

1. The `/dashboard` page is pointless — it adds nothing over the home page.
2. The preferences view (`/sessions`) has no navbar.

## Initial Framing (preserved)

- **User's stated cause or approach**: the dashboard is a redundant page; delete it.
- **User's proposed direction**: remove `/dashboard`; the home page becomes the entry point for starting a movie night.
- **Pre-dispatch narrowing**: asked what is actually wrong with the dashboard — user picked **"redundant dead-end"** (the page duplicates the home hero and is never needed), not primarily "incoherent navigation."

## Dimension Map

The observation could originate at any of these dimensions:

1. **The page's content/purpose** — `/dashboard` only renders a greeting + three links ("Edit taste core", "Start a movie night", "Sign out"), which duplicate the home hero (`Welcome.astro:41-54`). ← initial framing lands here.
2. **Where auth routing sends users** — nothing routes to `/dashboard`: sign-in and the email callback both redirect to `/sessions` (`signin.ts:19`, `callback.ts:26`). The page is reachable only via nav links, not as a landing target.
3. **The navbar's placement** — `Topbar.astro` is included **only** in `Welcome.astro` (home). The shared `Layout.astro` has no navbar, so `/sessions`, `/profiles`, `/recommendations` render without one (Observation 2).
4. **The navbar's link targets** — the navbar's only navigational link is **"Dashboard"** (`Topbar.astro:13`). Inner pages additionally carry `← Dashboard` back-links (`sessions.astro:83`, `profiles.astro:34`). The whole app's navigation is anchored to the page being deleted.

## Hypothesis Investigation

| Hypothesis | Evidence | Verdict |
| --- | --- | --- |
| D1: dashboard content is redundant with home | `dashboard.astro` = greeting + 3 links; home hero offers the same "Start a movie night" / "Edit taste core" CTAs (`Welcome.astro:41-54`) | STRONG |
| D2: dashboard is not an auth landing target | `signin.ts:19` → `/sessions`; `callback.ts:26` → `/sessions`; no redirect to `/dashboard` anywhere (`grep`) | STRONG |
| D3: navbar missing from inner pages | `Topbar.astro` imported only by `Welcome.astro`; `Layout.astro` renders `<slot/>` with no navbar | STRONG |
| D4: navigation is anchored to the deleted page | navbar's sole link = `/dashboard` (`Topbar.astro:13`); back-links in `sessions.astro:83`, `profiles.astro:34`; `PROTECTED_ROUTES` includes `/dashboard` (`middleware.ts:4`) | STRONG |

All four dimensions show strong evidence; they are not competing causes but **four facets of one coupled change**. The surface is small and was read in full, so no sub-agent dispatch was needed (guardrail #6).

## Narrowing Signals

- User confirms the dashboard is a **redundant dead-end**, not a page to repurpose → deletion (not a redesign of the page) is in scope.
- Objective coupling the user didn't state: deleting `/dashboard` **forces** a navbar decision, because the navbar's only link points there. "Add a navbar to inner pages" and "remove the dashboard" cannot be done independently — the navbar needs new, useful targets the moment the dashboard is gone.

## Cross-System Convention

This app already centralizes chrome in shared components: `Layout.astro` is the single HTML shell every page renders through, and `Topbar.astro` is a self-contained, auth-aware component (`Astro.locals.user` → email + Sign out, or Sign in / Sign up). The convention-aligned move is to host the navbar in `Layout.astro` so every page inherits it, and point its links at the real destinations (home, movie night, taste core) instead of the dashboard. This matches how the codebase already handles cross-cutting UI.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the app's authenticated navigation is anchored to a redundant page — the navbar lives on only one screen and its sole link points at a dead-end `/dashboard` that duplicates the home hero, leaving inner pages with no navigation at all.

The user's "delete the dashboard" instinct is correct, but the real unit of work is **navigation coherence**, not file deletion. Removing `/dashboard` is necessary but not sufficient: the same change must re-home the navbar into `Layout.astro`, give it useful link targets, drop the `← Dashboard` back-links, and remove `/dashboard` from `PROTECTED_ROUTES`. Treated as "just delete a file," the plan would leave a navbar with a dangling link and inner pages still bare.

## Confidence

- **HIGH** — every dimension has strong, file:line-anchored evidence; the reframe (deletion ⊂ navigation coherence) matches the codebase's existing shared-chrome convention; the narrowing signal was decisive.

## What Changes for /10x-plan

Plan a single "navigation coherence" change, not a file deletion: move the navbar into `Layout.astro` with link targets that survive the dashboard's removal (home / movie night / taste core), delete `/dashboard` + its `PROTECTED_ROUTES` entry + the inner-page back-links, and confirm the home page reads as the canonical entry point. Open question for /10x-plan: exact navbar link set and active-state treatment.

## References

- Source files: `src/pages/dashboard.astro`, `src/components/Topbar.astro:13`, `src/layouts/Layout.astro`, `src/components/Welcome.astro:41-54`, `src/pages/sessions.astro:83`, `src/pages/profiles.astro:34`, `src/middleware.ts:4`, `src/pages/api/auth/signin.ts:19`, `src/pages/auth/callback.ts:26`
- Related research: none yet (`/10x-research` not run for this change)
- Investigation tasks: none dispatched — surface small and fully read (guardrail #6)
