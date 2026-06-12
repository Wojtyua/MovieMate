import { vi } from "vitest";
import type { TmdbMovie } from "@/lib/tmdb-discover";
import type { recommendRun } from "@/lib/recommend-run";

/**
 * Test doubles for the supply-layer `recommendRun` integration suite
 * (test-plan §3 Phase 1, the supply-half of R1).
 *
 * The honest seam is the NETWORK EDGE, not an injected stub: `recommendRun`
 * builds its own TMDB client via `createTmdbClient()` and makes its own Supabase
 * calls. So we stub global `fetch` (TMDB) + the `astro:env/server` token (done
 * in the test file) and hand-roll a fake `SupabaseClient`. No internal
 * `@/lib/recommend*` module is mocked.
 */

/** The exact Supabase parameter type `recommendRun` expects (a non-null client). */
type SupabaseClientArg = Parameters<typeof recommendRun>[0];

/** A raw TMDB discover-list item (the subset `normalizeMovie` reads). */
export function makeDiscoverMovie(partial: Partial<TmdbMovie> & { id: number }): Partial<TmdbMovie> {
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
 * A `fetch` stub for `/discover/movie` that returns canned results keyed on the
 * `page` query param, so a dedup-across-pages case is meaningful. Any page not
 * listed resolves to an empty result set. Returns an `ok: true` Response whose
 * `.json()` yields `{ results }` — never touches the network.
 */
export function makeFetchStub(pagesByNumber: Record<number, Partial<TmdbMovie>[]>) {
  return vi.fn((input: string | URL): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const page = Number(url.searchParams.get("page") ?? "1");
    const results = pagesByNumber[page] ?? [];
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ results }),
    } as unknown as Response);
  });
}

export interface FakeSupabaseConfig {
  /** Rows the `watched` read returns (`tmdb_movie_id` excluded from the pool). */
  watchedRows?: { tmdb_movie_id: number }[];
  /** Id the `recommendations` insert hands back; defaults to `"rec-1"`. */
  recommendationId?: string;
  /** Force the run insert to fail. */
  runError?: { message: string } | null;
  /** Force the picks insert to fail. */
  picksError?: { message: string } | null;
}

export interface FakeSupabase {
  /** Cast to the `recommendRun` Supabase parameter type. */
  client: SupabaseClientArg;
  /** Every `recommendation_picks.insert(rows)` call, in order, for assertions. */
  insertedPickRows: Record<string, unknown>[][];
}

/**
 * A minimal hand-rolled fake `SupabaseClient` covering exactly the three calls
 * `recommendRun` makes:
 * - `from("watched").select("tmdb_movie_id").eq("user_id", …)` → `{ data }`
 * - `from("recommendations").insert(…).select("id").single()` → `{ data: { id } }`
 * - `from("recommendation_picks").insert(rows)` → `{ error }` (rows captured)
 */
export function createFakeSupabase(config: FakeSupabaseConfig = {}): FakeSupabase {
  const watchedRows = config.watchedRows ?? [];
  const recommendationId = config.recommendationId ?? "rec-1";
  const runError = config.runError ?? null;
  const picksError = config.picksError ?? null;
  const insertedPickRows: Record<string, unknown>[][] = [];

  const client = {
    from(table: string) {
      if (table === "watched") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: watchedRows, error: null }),
          }),
        };
      }
      if (table === "recommendations") {
        return {
          insert: () => ({
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: runError ? null : { id: recommendationId },
                  error: runError,
                }),
            }),
          }),
        };
      }
      if (table === "recommendation_picks") {
        return {
          insert: (rows: Record<string, unknown>[]) => {
            insertedPickRows.push(rows);
            return Promise.resolve({ error: picksError });
          },
        };
      }
      throw new Error(`fake Supabase: unexpected table "${table}"`);
    },
  };

  return { client: client as unknown as SupabaseClientArg, insertedPickRows };
}
