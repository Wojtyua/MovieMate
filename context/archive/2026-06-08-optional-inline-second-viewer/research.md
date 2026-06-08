---
date: 2026-06-08T00:00:00Z
researcher: Wojciech Derlikiewicz
git_commit: cf8788356cd05e4f5721bd93449d7c979a2ee5a1
branch: main
repository: 10xMovie
topic: "S-03 optional inline second viewer (duo path) — what exists, what S-03 must wire"
tags: [research, codebase, recommend-engine, duo-path, recommendations-api, session-form]
status: complete
last_updated: 2026-06-08
last_updated_by: Wojciech Derlikiewicz
---

# Research: S-03 Optional inline second viewer (duo path)

**Date**: 2026-06-08
**Researcher**: Wojciech Derlikiewicz
**Git Commit**: cf8788356cd05e4f5721bd93449d7c979a2ee5a1
**Branch**: main
**Repository**: 10xMovie

## Research Question

For roadmap slice S-03 — let the operator optionally add a second viewer's genre taste **inline for tonight** (or stay solo) and receive duo picks labeled **safe / compromise / wild card**, scored against both present tastes, with the second taste captured **on-device and never persisted** — what is the current live state of the engine, the recommendations transport, the session UI, and the DB role domain, and what exactly must S-03 wire?

## Summary

**S-03 is a wiring slice, not an engine slice.** S-02 already generalized the deterministic engine to one-or-two tastes and left the duo branch **live but unreachable in production**. Concretely, all of the following already exist and are correct on `main`:

- The engine accepts `recommend(tastes: [Taste] | [Taste, Taste], …)` and `scoreCandidate(…, tastes: [Taste] | [Taste, Taste], …)`; the two-taste math (`combined`, `balance`, `perTaste`, excluded-overlap) is real, not stubbed (`src/lib/recommend/scoring.ts`, `src/lib/recommend/roles.ts`).
- The middle-pick role **branches on cardinality at runtime**: `tastes.length === 2` → `compromise` (argmax `balance`); else → `crowd_pleaser` (argmax `crowd`) (`src/lib/recommend/roles.ts:127-146`).
- The DB role CHECK already admits `compromise` (`supabase/migrations/20260607073440_solo_role_crowd_pleaser.sql`), with pgTAP coverage.
- The recommendations display already maps `compromise` → "Compromise" in `ROLE_LABEL`/`ROLE_RANK` (`src/pages/sessions/[id]/recommendations.astro:24-30`).

So S-03's real work is **three small wiring deltas plus one UI surface**:
1. **Capture** an optional second viewer's preferred/excluded genres in the browser, never written to the session row.
2. **Transport** that ephemeral taste on the existing `POST /api/recommendations` request.
3. **Branch** the API: build `[taste]` or `[taste, second]` and pass it through; union the second viewer's preferred genres into the TMDB discover hint.

The one genuine **design decision** S-03 must settle is the *capture-and-transport seam* (see Open Questions §1): the "Get recommendations" trigger is a plain server-rendered Astro `<form>` (`src/pages/sessions.astro:128-136`) that is **separate** from the React `SessionForm`, and it currently carries only a hidden `session_id`. The duo genre input is React (the `GenrePicker` is a React component), so an optional second-viewer island must emit hidden inputs **into that recommendations form** for the plain POST to carry them.

## Detailed Findings

### Engine — already duo-ready (`src/lib/recommend/`)

- **`Taste` type** (`scoring.ts:33-37`): `{ preferred_genre_ids: number[]; excluded_genre_ids: number[] }`. Re-exported from `index.ts`.
- **Signatures** accept the tuple union:
  - `recommend(tastes: [Taste] | [Taste, Taste], session: SessionPrefs, candidates: TmdbMovie[]): RecommendationResult` (`roles.ts:100-104`).
  - `scoreCandidate(candidate, tastes: [Taste] | [Taste, Taste], session, maxPopularity): CandidateScore` (`scoring.ts:108-113`).
- **Two-taste math is real** (`scoring.ts:114-132`):
  - `perTaste = tastes.map(t => tasteAffinity(candidate, t))`
  - `combined = sum(perTaste) + shared`  (safe ranking)
  - `balance = min(perTaste.map(a => a + shared))`  (compromise ranking — best serves the worse-off taste)
  - `crowd = W_QUALITY·Q + W_CROWD·P − W_EXCL·(excluded overlap across ALL tastes)`
- **Cardinality branch** (`roles.ts:127-146`), quoted:
  ```ts
  if (tastes.length === 2) {
    const compromise = argmax(afterSafe, (s) => s.score.balance);
    if (compromise) { picks.push({ role: "compromise", movie: compromise.movie, score: compromise.score.balance }); usedIds.add(compromise.movie.id); }
  } else {
    const crowd = argmax(afterSafe, (s) => s.score.crowd, (s) => s.score.combined);
    if (crowd) { picks.push({ role: "crowd_pleaser", movie: crowd.movie, score: crowd.score.crowd }); usedIds.add(crowd.movie.id); }
  }
  ```
  Safe = argmax `combined`; wild card = genre-disjoint-from-safe (both cardinality-agnostic, unchanged).
- **`Role` union** (`roles.ts:4-11`): `"safe" | "compromise" | "wild_card" | "crowd_pleaser"` — all four already defined.
- **`WEIGHTS`** (`scoring.ts:13-31`): `W_PREF 2`, `W_EXCL 4`, `W_MOOD 2`, `W_INT 1`, `W_QUALITY 3`, `W_POP 1`, `W_CROWD 3`, `VOTE_COUNT_FLOOR 100`.
- **Status marker** (doc comment `roles.ts:83-85`): the compromise branch is *"Preserved intact for S-03."* No TODO/dead-code; nothing in the engine needs to change for S-03 unless we choose to retune.

### Recommendations API + transport (`src/pages/api/recommendations.ts`)

- **`POST` handler** (`recommendations.ts:48`). Reads **FormData**, only field today is `session_id` (`:49-50`).
- **Auth/RLS**: requires `context.locals.user` (`:57-61`, else redirect to sign-in); all writes are owner-scoped via RLS on `recommendations` / `recommendation_picks`.
- **Session load** (`:63-86`): from `movie_night_sessions` only — columns `id, mood, preferred_genre_ids, excluded_genre_ids, runtime_limit_minutes, intensity`. **The S-01 `viewer_profiles` shim is gone** (confirmed: no core load, no `/profiles` gate).
- **Single taste built from tonight's session genres** (`:88-92`):
  ```ts
  const taste: Taste = { preferred_genre_ids: session.preferred_genre_ids, excluded_genre_ids: session.excluded_genre_ids };
  ```
- **Discover hint** (`:100-110`): `fetchCandidates(tmdb, { genreIds: taste.preferred_genre_ids, runtimeLteMinutes, voteCountGte, pages: 3 })`. Excluded genres are scoring penalties, **not** discover filters.
- **Engine call** (`:120`): `recommend([taste], { mood, intensity }, candidates)` — hardwired to the one-taste array today.
- **Persistence** (`:125-152`): inserts one `recommendations` row, then `recommendation_picks` rows with `role: pick.role` (+ TMDB snapshot fields). No change needed for duo beyond the engine producing `compromise`.
- **Success redirect** (`:155`): `/sessions/${session.id}/recommendations`.

**S-03 transport seam:** add optional repeated form fields (e.g. `second_preferred_genre_ids` / `second_excluded_genre_ids`) parsed exactly like `sessions.ts` parses genres, build `const second = …` only when present, then `recommend(second ? [taste, second] : [taste], …)`. Union `second.preferred_genre_ids` into the `genreIds` discover hint.

### The trigger is a server-rendered form, separate from SessionForm (`src/pages/sessions.astro`)

- **`SessionForm`** (React, `client:load`) saves the session via `POST /api/sessions` (`sessions.astro:93-105`; form internals in `SessionForm.tsx:80`). It owns mood/intensity/runtime/note + the two `GenrePicker`s (`SessionForm.tsx:155-156`) and serializes genres as hidden `preferred_genre_ids`/`excluded_genre_ids` inputs (`:160-165`).
- **The "Get recommendations" trigger is a different, plain Astro form** (`sessions.astro:128-136`):
  ```astro
  <form method="POST" action="/api/recommendations">
    <input type="hidden" name="session_id" value={latest.id} />
    <button type="submit">Get recommendations</button>
  </form>
  ```
  This is the form the ephemeral second taste must ride. It is **not** the React island — so the duo input needs its own React island (the `GenrePicker` is React) that contributes hidden `<input>`s into this form.

### GenrePicker is reusable (`src/components/sessions/SessionForm.tsx:215-254`)

```ts
interface GenrePickerProps {
  label: string;
  kind: "preferred" | "excluded";
  selected: Set<number>;
  onToggle: (kind: "preferred" | "excluded", id: number) => void;
}
```
Generic, stateless, value/onChange via a `Set<number>` + toggle callback. Mutually-exclusive preferred/excluded toggling lives in the parent (`:49-77`). Reusable for a second viewer with separate state; currently defined **inside** `SessionForm.tsx` (would need extraction/export to reuse in a new island).

### Display already wired for duo (`src/pages/sessions/[id]/recommendations.astro:24-30`)

```ts
const ROLE_RANK: Record<Role, number> = { safe: 0, compromise: 1, crowd_pleaser: 1, wild_card: 2 };
const ROLE_LABEL: Record<Role, string> = { safe: "Safe pick", compromise: "Compromise", crowd_pleaser: "Crowd-pleaser", wild_card: "Wild card" };
```
Picks sorted by `ROLE_RANK` (`:50`), rendered as 3 cards (`:82-122`). Duo labels render with **no display change required**.

### DB role domain already admits `compromise` (`supabase/`)

- `recommendation_picks.role` CHECK widened to `('safe','compromise','wild_card','crowd_pleaser')` (`migrations/20260607073440_solo_role_crowd_pleaser.sql:1-18`); migration comment notes *"the duo `compromise` role stays valid because S-03 reintroduces the two-viewer flow."*
- pgTAP (`supabase/tests/recommendations_isolation.sql`): `crowd_pleaser` lives_ok (`:133-138`), unknown-role throws_ok 23514 (`:105-114`), unique `(recommendation_id, role)` throws_ok 23505 (`:116-123`). **No migration is needed for S-03's role storage.**

### TMDB discover hint blends via set union at the call site (`src/lib/tmdb-discover.ts`)

- `DiscoverParams.genreIds?: number[]` → `with_genres = a|b|c` OR-union (`tmdb-discover.ts:31-42`, `:64-85`). The blend is computed by the caller; the original S-01 duo code unioned session + both profiles' preferred genres. S-03 unions `session.preferred ∪ second.preferred` at the API layer.

## Code References

- `src/lib/recommend/scoring.ts:13-37` — WEIGHTS, `Taste`; `:108-132` — `scoreCandidate` duo math.
- `src/lib/recommend/roles.ts:4-11` — `Role`; `:100-104` — `recommend` signature; `:127-146` — cardinality branch.
- `src/lib/recommend/index.ts` — barrel re-exports `Taste`, `recommend`.
- `src/pages/api/recommendations.ts:48-50` — POST/FormData/`session_id`; `:88-92` — single taste; `:100-110` — discover hint; `:120` — `recommend([taste], …)`; `:125-155` — persist + redirect.
- `src/pages/sessions.astro:93-105` — SessionForm props; `:128-136` — the recommendations trigger form.
- `src/components/sessions/SessionForm.tsx:12-23` — props; `:155-165` — GenrePickers + hidden genre inputs; `:215-254` — `GenrePicker`.
- `src/pages/sessions/[id]/recommendations.astro:24-30` — ROLE maps; `:82-122` — render.
- `supabase/migrations/20260607073440_solo_role_crowd_pleaser.sql` — role CHECK (admits `compromise`).
- `supabase/tests/recommendations_isolation.sql:105-138` — role-domain assertions.
- `src/lib/tmdb-discover.ts:31-42,64-85` — discover hint / genre OR-union.
- `src/pages/api/sessions.ts:82-90` — persisted session columns (where the second taste must NOT go).

## Architecture Insights

- **Asymmetric, ephemeral second viewer is enforced by *omission*, not by new schema.** The clean way to honor "never persisted" is to route the second taste **only** through `POST /api/recommendations` and never through `POST /api/sessions`. Because `recommendations.ts` writes only `recommendations` + `recommendation_picks` (never the session row), an ephemeral taste arriving on that request leaves no persisted trace by construction.
- **Cardinality drives everything downstream for free.** Passing `[taste, second]` flips the middle role to `compromise`, the discover union, the balance metric, and the display label without any branching the caller has to repeat — the engine and display already encode it.
- **The transport mismatch is the one real seam.** Session genres are React-island state POSTed to `/api/sessions`; the recommendation trigger is a static Astro form. The duo input bridges the two layers and must deposit hidden inputs into the *recommendations* form specifically.
- **No engine change is strictly required** — only optional retuning of `W_*` if duo picks feel off in manual testing (out of scope unless observed).

## Historical Context (from prior changes)

- `context/archive/2026-06-06-session-first-solo-flow/plan.md:42-43` — S-02 explicitly deferred "Second-viewer input / duo UI" to S-03 and typed the engine input as `[Taste] | [Taste, Taste]` precisely so S-03's duo call stays compile-checked.
- `context/archive/2026-06-06-session-first-solo-flow/plan.md` (Phase 1 contract) — generalized scoring/roles, deleted the session-genre weight block, kept the duo branch intact.
- `context/archive/2026-06-06-scored-recommendations/plan.md:53-62` — the original duo scoring math (`combined`, `balance`) that the current engine preserves.
- `context/archive/2026-06-06-remembered-taste-core/plan.md:161-164` — the `[core, core]` shim S-02 removed.

## Related Research

- None prior for this change. Upstream frame: `context/changes/session-first-flow/frame.md` (root causes D2/D3/D5, referenced by S-02).

## Open Questions

1. **Capture-and-transport seam (the one real design choice).** The recommendation trigger is a plain Astro form separate from the React `SessionForm`; the duo genre input is React. Options for `/10x-plan`:
   - **(A, recommended) A dedicated optional second-viewer React island** beside the "Get recommendations" form (`sessions.astro:128-136`) that renders an "Add a second viewer" toggle + two reused `GenrePicker`s, and emits hidden `second_preferred_genre_ids`/`second_excluded_genre_ids` inputs into that form. Keeps capture co-located with transport; nothing touches `/api/sessions`; requires extracting `GenrePicker` from `SessionForm.tsx` into a shared module.
   - **(B) Fold the duo input into `SessionForm` and carry it forward** — worse: `SessionForm` POSTs to `/api/sessions`, risking accidental persistence and a second hop to reach the recommendations form.
   - **(C) `sessionStorage`** keyed by session id, read client-side and injected into the form — more moving parts, no benefit over (A).
2. **Solo role label finalization (roadmap OQ-1).** Duo keeps safe/compromise/wild card (already in place). Solo currently labels the middle pick "Crowd-pleaser". Non-blocking for the duo branch; confirm copy during planning.
3. **Discover-union saturation.** Unioning two viewers' preferred genres widens `with_genres`; confirm the pool still yields ≥3 distinct picks after the safe/wild-card disjointness filters. Likely fine (OR-union only broadens), but worth a manual duo check.
4. **`GenrePicker` extraction.** It currently lives inside `SessionForm.tsx`. Reusing it for the second viewer means exporting/extracting it into `src/components/sessions/`. Decide extraction vs. duplication in `/10x-plan` (extraction preferred).

## Negative space — what S-03 does NOT need

- **No new table, no migration** — the role domain already includes `compromise`.
- **No engine rewrite** — duo scoring/roles ship intact; at most optional weight retuning.
- **No display change** — `compromise` is already mapped.
- **No `/api/sessions` change** — the second taste must bypass session persistence entirely.
