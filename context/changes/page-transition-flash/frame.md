# Frame Brief: White flash on page navigation

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

A brief **full-screen white-background flash** appears **when navigating
between pages** in the app (e.g. clicking a navbar link from home to sessions).
The app is intended to be **dark-only** (the cosmic gradient), so any white
frame is always a defect, never an intentional state.

## Initial Framing (preserved)

- **User's stated cause or approach**: FOUC-style flash — the root paints the
  browser-default white before the theme/app background CSS applies.
- **User's proposed direction**: Fix it — either a static root background, or
  adopt Astro View Transitions.
- **Pre-dispatch narrowing**: flash is on **page-to-page navigation** (not first
  load, not React re-render), looks like a **full white screen** (whole-document
  backdrop, not edges or an inner content area), and the app is **dark-only** so
  white `:root` is a leftover starter default, not a real light theme.

## Dimension Map

The observation could originate at any of these dimensions:

1. **Document root backdrop (`html`/`body`)** — `html` has no background set
   (`Layout.astro:53-60` sets only margin/size); `body` resolves to
   `--background` which is `oklch(1 0 0)` = **white**, because the `.dark` class
   is never applied so the light-theme `:root` wins. The browser's document
   canvas is therefore white. ← **root cause**
2. **Dark background lives on a nested element** — the `bg-cosmic` gradient is
   on a single `<div>` _inside_ `<body>` (`Layout.astro:26`), not on
   `html`/`body`. It only covers `min-h-screen` of that div, so the white
   document backdrop sits underneath/around it. ← reinforces #1
3. **Navigation model exposes the backdrop** — `astro.config.mjs:11` is
   `output: "server"` with **no View Transitions**, so every navigation is a
   full fresh-document load. Between the old and new document the browser paints
   the new document's (white) backdrop → the flash. ← initial framing lands here
4. **React hydration / re-mount clears styled content** — a component re-mount
   could briefly blank content. ← would keep the dark chrome, not full-screen.
5. **Stylesheet load-order / render-blocking timing** — CSS arriving late would
   show unstyled content on first paint. ← would also hit first load, not only
   navigation.

## Hypothesis Investigation

| Hypothesis                                                   | Evidence                                                                                                                                                                                                                                                     | Verdict                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| #1 Document root (`html`/`body`) is white                    | `:root --background: oklch(1 0 0)` (`global.css:8`); `body { @apply bg-background }` (`global.css:121-123`); `.dark` class **never applied** in any `.astro`/`.tsx` (only dormant `dark:` variants in `button.tsx`); `html` has no bg (`Layout.astro:53-60`) | **STRONG**                       |
| #2 Dark bg only on a nested div                              | `@utility bg-cosmic` (`global.css:113-115`) used at exactly one place: `Layout.astro:26` on an inner `<div>`                                                                                                                                                 | **STRONG**                       |
| #3 Full-document navigation exposes it (no View Transitions) | `output: "server"`, integrations `[react(), sitemap()]` — no `astro:transitions` anywhere in `src`/config                                                                                                                                                    | **STRONG** (mechanism, not root) |
| #4 React re-mount clears content                             | User reports flash on navigation, full-screen, not on re-render; a re-mount would keep the dark chrome                                                                                                                                                       | **NONE**                         |
| #5 Stylesheet load-order timing                              | CSS is bundled/imported in `Layout.astro:2`; flash is navigation-only, not first-load-only; CSS is loaded, backdrop is still white                                                                                                                           | **WEAK**                         |

## Narrowing Signals

Decisive observations that narrowed the hypothesis space:

- **"On page-to-page navigation"** → rules out #4 (re-render) and weakens #5
  (a load-order FOUC would hit first load too).
- **"Full white screen"** (not edges, not inner content area) → it's the whole
  **document backdrop**, i.e. `html`/`body`, not a content-region or chrome gap.
- **"Dark-only app"** → the white `:root --background` is an un-overridden
  starter default, not a legitimate light theme; the dark palette in
  `global.css:41-73` is dead code (no `.dark` ancestor ever set).

## Cross-System Convention

The standard fix for a dark-only app is to paint the dark color on the
**document root itself** (`html`/`body` background), so the browser's canvas —
the thing shown during any full-document navigation, overscroll, or pre-paint
frame — is already dark. Putting the themed background on a nested element and
leaving the root white is the anti-pattern that produces exactly this flash.
The leading hypothesis matches this convention directly.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: the app's dark background is painted
> by a nested `<div>` while the document root (`html`/`body`) stays light-theme
> **white**, so every full-document navigation exposes the white canvas for a
> frame.

This is a structural background-placement bug, **not** a timing/FOUC bug and
**not** a missing-animation bug. Because the stylesheet is already loaded, the
white frame is not about _when_ CSS applies — it's that the document backdrop is
_the wrong color_. The minimal fix moves the dark background onto the document
root (and/or activates the dormant dark theme) so there is no white backdrop to
expose. This **narrows the user's proposed direction**: "adopt Astro View
Transitions" would smooth/animate navigations but the underlying root would
still be white — VT is a separate UX enhancement, not the fix for this defect,
and pursuing it first would inflate scope without resolving the flash.

## Confidence

**HIGH** — strong, file:line-level evidence for #1 and #2; matches the
dark-app convention; the narrowing signals (navigation-only, full-screen,
dark-only) are decisive and independently consistent. No reproduction gap: the
white backdrop is statically present in the code regardless of timing.

## What Changes for /10x-plan

Plan a **document-root background fix** (paint the dark/cosmic background on
`html`/`body`, or enable the dormant `.dark` theme on the root so
`--background` resolves dark), not a View-Transitions feature. Treat Astro
View Transitions as out of scope here — park it as an optional follow-up.

## References

- Source files: `src/layouts/Layout.astro:22-60`, `src/styles/global.css:6-9`,
  `src/styles/global.css:41-73`, `src/styles/global.css:113-123`,
  `astro.config.mjs:10-16`
- Related research: none (no `research.md` for this change)
- Investigation: inline (small surface, no sub-agents dispatched — per the
  no-hypothesis-padding guardrail)
- Lesson applied: "Reproduce and confirm a bug's root cause before planning a
  fix" (`context/foundation/lessons.md`) — root cause confirmed against current
  code before any plan.
