---
date: 2026-06-13T13:58:59+0200
researcher: Claude (Opus 4.8)
git_commit: 553423264faffcd0ddc903db9e2c2e2b35e8f1cb
branch: main
repository: 10xMovie
topic: "Critical-path E2E journey (Risk #3): home → session → three picks — locators, auth, determinism"
tags: [research, codebase, e2e, playwright, sessions, recommendations, auth]
status: complete
last_updated: 2026-06-13
last_updated_by: Claude (Opus 4.8)
---

# Research: Critical-path E2E journey (Risk #3)

**Date**: 2026-06-13T13:58:59+0200
**Researcher**: Claude (Opus 4.8)
**Git Commit**: 5534232
**Branch**: main
**Repository**: 10xMovie

## Research Question

Ground test-plan **Phase 4 / Risk #3** for a Playwright E2E test: the journey
home → (auth) → `/sessions` preferences → submit → **three picks render** on
`/sessions/[id]/recommendations`. Confirm the exact accessible locators, the auth
shape for `storageState`, the POST→redirect contract, and _why a note-less,
single-genre submit deterministically yields exactly three picks_ — so the test's
core assertion protects the risk and isn't flaky.

## Summary

The feature is fully built and the journey is browser-level (auth → routing → API →
DB → SSR render) — a textbook `/10x-e2e` fit. Key findings:

- **Auth is real and `storageState`-friendly.** Middleware protects `/sessions`;
  unauthenticated → redirect `/auth/signin`. `POST /api/auth/signup` with local
  email-confirmation **off** returns a live session and redirects to `/` already
  logged in — so an auth-setup project signs up a unique user and saves the cookie
  jar. No UI login needed in the per-test flow (lesson rule: login is not a
  per-test dependency).
- **The core assertion is `getByRole('article')` → `toHaveCount(3)`.** `PicksGrid`
  renders one `<article>` per pick (implicit ARIA role `article`), with a role-badge
  `<span>` (`Safe pick` / `Compromise` / `Crowd-pleaser` / `Wild card`), an `<h2>`
  title, and a `Mark watched` button. The page shows an **empty state** ("No
  recommendations yet…") when `picks.length === 0`, so the count assertion genuinely
  fails if the pipeline drains the pool — exactly Risk #3's failure mode.
- **Determinism is by construction with no note.** A null note collapses the
  retrieval relaxation ladder to a single genre-only TMDB query; a common preferred
  genre returns ≥3 candidates → `recommend()` returns 3 picks. So **real TMDB** is a
  sound choice for this phase, provided the test selects one preferred genre and
  leaves the note empty.
- **One locator wrinkle:** genre buttons are named by genre and appear in _two_
  pickers (Preferred + Avoid), so `getByRole('button', { name: 'Action' })` is
  ambiguous — scope it to the "Preferred genres" group.

## Detailed Findings

### Routing & auth gate

- `src/middleware.ts:4` — `PROTECTED_ROUTES = ["/profiles", "/sessions"]`;
  `:25-29` redirects to `/auth/signin` when `context.locals.user` is null.
  `:14-23` builds the Supabase client from request headers + cookies and sets
  `locals.user` via `supabase.auth.getUser()`. → A captured `storageState` (cookie
  jar) makes `/sessions` reachable directly, no login UI.
- `src/pages/api/auth/signup.ts:15-33` — `supabase.auth.signUp(...)`; when
  `data.session` exists (confirmations off) redirects to `/` **already signed in**;
  otherwise `/auth/confirm-email`. `supabase/config.toml:209` →
  `enable_confirmations = false` locally. So signup = immediate session for the
  auth-setup project.
- `src/lib/supabase.ts` — `@supabase/ssr` `createServerClient`; cookie names/format
  are managed internally (chunked `sb-*-auth-token`). Playwright captures the whole
  jar — we don't hard-code cookie names.

### The preferences form (`/sessions`)

`src/components/sessions/SessionForm.tsx` — native full-page `POST` to
`/api/recommendations` (`:79-81`). Fields and their accessible handles:

| Control       | Source                                                      | Locator                                                |
| ------------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| Mood          | `select#mood` + `<label htmlFor="mood">Mood` (`:90-108`)    | `getByLabel('Mood')` (combobox)                        |
| Intensity     | `select#intensity` + label (`:112-130`)                     | `getByLabel('Intensity')`                              |
| Runtime limit | `select#runtime_limit_minutes` + label (`:134-153`)         | `getByLabel('Runtime limit')`                          |
| Note          | `textarea#note` + `<label htmlFor="note">Note` (`:172-190`) | `getByLabel('Note')` — **leave empty**                 |
| Submit        | `SubmitButton` text `Get tonight's picks` (`:198-204`)      | `getByRole('button', { name: "Get tonight's picks" })` |

- **Genres**: `GenrePicker` (`src/components/sessions/GenrePicker.tsx:25-39`) renders
  every `MOVIE_GENRES` entry as `<button type="button" aria-pressed>{genre.name}</button>`.
  `SessionForm.tsx:159-160` renders **two** pickers ("Preferred genres",
  "Avoid genres"); selected ids are emitted as hidden repeated inputs
  `preferred_genre_ids` / `excluded_genre_ids` (`:164-169`). **Wrinkle:** a genre name
  (e.g. "Action") is a button in both pickers → ambiguous. Scope to the Preferred
  group, e.g. the parent of the "Preferred genres" label span, then
  `getByRole('button', { name: 'Action' })`. The label is a plain `<span>`
  (`GenrePicker.tsx:20`), not a fieldset — there's no group role to target directly.
- **Second viewer** (optional): `src/components/sessions/SecondViewer.tsx:61-73`
  collapsed = `button { name: 'Add a second viewer' }`; expanded reveals
  "Second viewer (tonight only)" + two more pickers ("Their preferred/avoid genres")
  and `Remove`. Not needed for the solo critical path; selecting genres here would
  flip the pipeline to the duo branch (`compromise` role).

### POST → pipeline → redirect

- `src/pages/api/recommendations.ts:37-147` — validates prefs, **in-route auth
  guard** (`:85-88` redirect `/auth/signin` if no user; `/api/*` isn't a protected
  route), inserts a `movie_night_sessions` row (`:94-110`), builds the optional
  `second` taste (`:128-137` — null unless a second genre picked), then
  `recommendRun(...)` (`:142`). On `result.ok` → `context.redirect(result.redirectTo)`
  (`:146`); on failure → `/sessions?error=…` (the just-saved session is the latest
  row, so the form re-fills).
- `src/lib/recommend-run.ts:198` — `redirectTo = `/sessions/${session.id}/recommendations``.
→ test waits `page.waitForURL('\*_/sessions/_/recommendations')`.

### Why three picks, deterministically (the assertion's foundation)

- `recommend-run.ts:78-86` — AI note-parse runs **only if `session.note`** is set.
  Null note ⇒ `aiGenreIds/people/keywords` stay empty.
- `:125-131` ladder = `[augmented+kw+cast, augmented+cast, augmented, genre-only]`;
  `dedupeAttempts` (`:214-227`) collapses identical filter sets. With no note,
  augmented == genre-only, so the ladder is **one** genre-only query
  (`{ genreIds: discoverGenreIds, castIds: [], keywordIds: [] }`).
- `:133-147` `fetchCandidates(pages: 3, voteCountGte: WEIGHTS.VOTE_COUNT_FLOOR)`,
  stop at first attempt with ≥3 candidates. For a common genre, TMDB returns far
  more than 3.
- `:160-167` `recommend([taste], …, candidates)` → solo branch returns
  safe / crowd_pleaser / wild_card (≤3, exactly 3 with a healthy pool). Persisted to
  `recommendation_picks` (`:180-193`).
- **Implication:** the test must **select one preferred genre** (empty preferred ⇒
  no discover hint ⇒ non-deterministic/empty pool) and **leave the note empty** (a
  note pulls in the OpenRouter/AI path — non-deterministic, out of scope for Risk #3,
  that's Risk #2/Phase 2).

### The picks page & the risk-tied assertion

- `src/pages/sessions/[id]/recommendations.astro:13-30` — server-side reads the most
  recent `recommendations` run for the session (RLS owner-scoped) then its
  `recommendation_picks`. `:43-58` renders the **empty state** when `picks.length === 0`,
  else `<PicksGrid client:load picks={picks} />`.
- `src/components/sessions/PicksGrid.tsx`:
  - `:85` one `<article>` per pick ⇒ `expect(page.getByRole('article')).toHaveCount(3)`
    — **the core risk-tied assertion** (three picks rendered, not a 200/URL).
  - `:92-94` role badge `<span>` text via `ROLE_LABEL` (`:26-31`): `Safe pick`,
    `Compromise`, `Crowd-pleaser`, `Wild card` (CSS uppercases visually; DOM text is
    original case → `getByText('Safe pick')` matches).
  - `:116-121` `<h2>` title ⇒ `getByRole('heading', { level: 2 })` count 3.
  - `:125-149` `Mark watched` button per card.

## Code References

- `src/middleware.ts:4,25-29` — protected routes + signin redirect.
- `src/pages/api/auth/signup.ts:29-33` — signup → live session → `/` (confirmations off).
- `src/components/sessions/SessionForm.tsx:90-204` — labelled controls + submit.
- `src/components/sessions/GenrePicker.tsx:25-39` — genre buttons (`aria-pressed`, named).
- `src/components/sessions/SecondViewer.tsx:61-73` — "Add a second viewer".
- `src/pages/api/recommendations.ts:142-146` — pipeline call + redirect.
- `src/lib/recommend-run.ts:125-147,198` — relaxation ladder + redirect target.
- `src/pages/sessions/[id]/recommendations.astro:43-58` — empty state vs PicksGrid.
- `src/components/sessions/PicksGrid.tsx:85,92-94,116-121` — article / badge / title.

## Architecture Insights

- **No `data-testid` anywhere** — semantic HTML (labels, headings, `<article>`,
  `aria-pressed`). Role/label locators are the right default and match the lesson rule.
- **Real-vs-mocked boundary:** auth, routing, Supabase DB, SSR-on-workerd stay real
  (that's where Risk #3's integration failure hides). TMDB is called **server-side**
  (`src/lib/tmdb*`, env via `astro:env/server`) so browser `page.route()` can't
  intercept it — by decision we use real TMDB; the note-less path keeps it
  deterministic enough. (Degradation/mocking of the external edge is Risk #2 /
  Phase 2 at the integration layer with MSW, not here.)
- **Deliberate-break candidates (VERIFY):** weaken the protected "three picks render"
  behavior and confirm red — e.g. `PicksGrid` `sorted.slice(0, 1)`, or cap
  `result.picks` in `recommend-run.ts`. Revert immediately; never commit.

## Historical Context (from prior changes)

- `context/archive/2026-06-12-testing-always-three-picks-core/` — Phase 1 built the
  unit/integration "always three" coverage; the _shape_ (`recommend()`) and _supply_
  (ladder) layers are tested there. Phase 4 (this change) adds the **rendered**
  end-to-end proof that the unit layer can't give.
- `context/foundation/test-plan.md` §2 R3, §6.4 (cookbook "Adding an e2e test" — TBD,
  to be filled by this change), §3 Phase 4 (`not started` → will flip to `complete`).

## Related Research

- `context/foundation/test-plan.md` — risk map + phased rollout (the source of R3).

## Open Questions

- **Signup submit button name** in `SignUpForm.tsx` (for the auth-setup UI flow) —
  confirm during P1, or POST directly to `/api/auth/signup` to avoid UI coupling.
- **Cleanup/teardown** strategy for the `movie_night_sessions` + `recommendations`
  rows each run creates: unique-by-nature (fresh user per setup) covers collisions;
  for tidy re-runs consider a Playwright teardown project (Supabase RLS: same
  account or service role) — lesson Deep Dive "Teardown jako projekt".
