import type { TmdbMovie } from "@/lib/tmdb-discover";

/**
 * Hand-built `TmdbMovie` fixtures for the pure-layer `recommend()` suite
 * (test-plan §3 Phase 1, R5 + the shape-half of R1).
 *
 * Each pool is ORDERED so the intended argmax / disjointness outcome is forced
 * by construction — the oracle comes from the PRD/domain rules in
 * `research.md`, never from a hardcoded float score (test-plan §7 forbids exact
 * score assertions). Tests assert role labels, distinctness, ≤3, and wild-card
 * genre disjointness — not `pick.score`.
 */

// TMDB genre ids used across the fixtures (see src/lib/genres.ts).
export const ACTION = 28;
export const ADVENTURE = 12;
export const COMEDY = 35;
export const HORROR = 27;

/**
 * Build a fully-populated `TmdbMovie`, overriding only the fields a test cares
 * about. Neutral defaults keep every other signal out of the way so a pool's
 * ordering alone decides the winners.
 */
export function makeMovie(partial: Partial<TmdbMovie> & { id: number }): TmdbMovie {
  return {
    id: partial.id,
    title: partial.title ?? `Movie ${partial.id}`,
    genre_ids: partial.genre_ids ?? [],
    vote_average: partial.vote_average ?? 0,
    vote_count: partial.vote_count ?? 0,
    popularity: partial.popularity ?? 0,
    release_date: partial.release_date ?? "2020-01-01",
    overview: partial.overview ?? "",
    poster_path: partial.poster_path ?? null,
  };
}

/**
 * Healthy ≥3 pool WITH a genre-disjoint wild-card candidate. Ordered so:
 * - id 1 ([ACTION, ADVENTURE], top quality + popularity) wins `combined` → safe;
 * - id 2 ([ACTION], next popularity) wins the solo `crowd` / duo `balance`
 *   middle;
 * - id 3 ([COMEDY]) is FULLY disjoint from safe's genres → the wild card,
 *   exercising the "disjoint preferred when available" branch.
 */
export function healthyPool(): TmdbMovie[] {
  return [
    makeMovie({ id: 1, genre_ids: [ACTION, ADVENTURE], vote_average: 8, vote_count: 1000, popularity: 100 }),
    makeMovie({ id: 2, genre_ids: [ACTION], vote_average: 7, vote_count: 500, popularity: 80 }),
    makeMovie({ id: 3, genre_ids: [COMEDY], vote_average: 6, vote_count: 300, popularity: 50 }),
  ];
}

/**
 * Narrow-genre pool where NO candidate is fully disjoint from safe — every film
 * shares the ACTION genre with the id-1 safe pick. Forces the wild card's
 * minimum-Jaccard fallback: after safe (id 1) and the popular crowd middle
 * (id 2), the wild card must be id 3 ([ACTION, HORROR], overlap 1/3) over id 4
 * ([ACTION, ADVENTURE, HORROR], overlap 2/3).
 */
export function narrowGenrePool(): TmdbMovie[] {
  return [
    makeMovie({ id: 1, genre_ids: [ACTION, ADVENTURE], vote_average: 9, vote_count: 1000, popularity: 100 }),
    makeMovie({ id: 2, genre_ids: [ACTION], vote_average: 5, vote_count: 800, popularity: 90 }),
    makeMovie({ id: 3, genre_ids: [ACTION, HORROR], vote_average: 4, vote_count: 200, popularity: 20 }),
    makeMovie({ id: 4, genre_ids: [ACTION, ADVENTURE, HORROR], vote_average: 4, vote_count: 100, popularity: 10 }),
  ];
}

/** Exactly two distinct films → safe + middle, no wild card (min(N,3) = 2). */
export function twoFilmPool(): TmdbMovie[] {
  return [
    makeMovie({ id: 1, genre_ids: [ACTION, ADVENTURE], vote_average: 8, vote_count: 1000, popularity: 100 }),
    makeMovie({ id: 2, genre_ids: [ACTION], vote_average: 7, vote_count: 500, popularity: 80 }),
  ];
}

/** A single film → safe only (min(N,3) = 1). */
export function oneFilmPool(): TmdbMovie[] {
  return [makeMovie({ id: 1, genre_ids: [ACTION, ADVENTURE], vote_average: 8, vote_count: 1000, popularity: 100 })];
}

/**
 * Two entries share id 1 with different field values; `dedupeById` keeps the
 * FIRST-seen ([ACTION, ADVENTURE]) and drops the second ([COMEDY]), collapsing
 * the pool to 2 distinct films BEFORE role assignment.
 */
export function duplicateIdPool(): TmdbMovie[] {
  return [
    makeMovie({ id: 1, genre_ids: [ACTION, ADVENTURE], vote_average: 8, vote_count: 1000, popularity: 100 }),
    makeMovie({ id: 1, genre_ids: [COMEDY], vote_average: 9, vote_count: 2000, popularity: 200 }),
    makeMovie({ id: 2, genre_ids: [COMEDY], vote_average: 6, vote_count: 300, popularity: 50 }),
  ];
}
