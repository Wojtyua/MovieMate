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

/**
 * A per-edge failure injection for `makeNetworkStub`. The three modes reproduce
 * the canonical degradation triggers Risk #2 cares about:
 * - `non-ok`   → an `ok:false` Response (default 500). Discover/search read the
 *   status and short-circuit to `[]`/`null`; the AI `extract` returns `null`.
 * - `throw`    → the stub throws, modelling a network error / abort / timeout.
 *   This is the throw-to-simulate-timeout technique: `fetchCandidates` and
 *   `extract` both catch *any* error identically to a real abort, so a thrown
 *   error exercises the exact degrade branch a wall-clock timeout would —
 *   deterministic and instant, no fake timers.
 * - `malformed`→ an `ok:true` Response whose `.json()` rejects, so the parser
 *   throws and the edge degrades the same way.
 */
export type EdgeFailure = { kind: "non-ok"; status?: number } | { kind: "throw" } | { kind: "malformed" };

/** Healthy discover data (keyed by page) is anything that is not a failure. */
function isEdgeFailure(value: unknown): value is EdgeFailure {
  return typeof value === "object" && value !== null && "kind" in value;
}

/** Build a Response (or thrown error) for one configured edge failure. */
function failureResponse(failure: EdgeFailure): Promise<Response> {
  switch (failure.kind) {
    case "non-ok":
      return Promise.resolve({
        ok: false,
        status: failure.status ?? 500,
        json: () => Promise.resolve({}),
      } as unknown as Response);
    case "throw":
      // Synchronous throw → modelled as a rejected fetch. `fetchCandidates`
      // (tmdb-discover.ts:190) and `extract` (ai.ts:103) both catch it.
      return Promise.reject(new TypeError("network error (simulated edge failure)"));
    case "malformed":
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.reject(new SyntaxError("malformed JSON (simulated edge failure)")),
      } as unknown as Response);
  }
}

/** Wrap an ok:true Response around a JSON body. */
function okJson(body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

/** Configuration for the URL-routing, failure-injecting network stub. */
export interface NetworkStubConfig {
  /** Healthy discover data keyed by page, OR a failure applied to every page. */
  discover: Record<number, Partial<TmdbMovie>[]> | EdgeFailure;
  /** Resolved id for any `/search/*` call, OR a failure (default: a stable id). */
  search?: number | EdgeFailure;
  /**
   * Extraction object the OpenRouter call returns (wrapped as
   * `choices[0].message.content`), OR a failure. Leave unset on paths that do
   * not exercise the AI edge — an unexpected OpenRouter request then throws,
   * surfacing the miswiring rather than silently degrading.
   */
  openrouter?: { genres: string[]; people: string[]; keywords: string[] } | EdgeFailure;
}

/** A stable person/keyword id the healthy `/search/*` branch resolves to. */
const DEFAULT_SEARCH_ID = 999;

/**
 * A single `fetch` stub the degradation suite configures per-edge. It routes by
 * URL substring to the three external edges and injects either healthy data or
 * a failure mode, recording every requested URL so a test can prove *which rung*
 * ran (e.g. no `/search/`, no `with_cast` ⇒ the genre-only baseline):
 *
 * - `url.includes("openrouter.ai")` → AI extraction (`ai.ts`)
 * - `url.includes("/search/")`      → entity resolution (`tmdb-search.ts`)
 * - `url.includes("/discover/movie")` → candidate retrieval, page-keyed (`tmdb-discover.ts`)
 *
 * Returns the stub plus the ordered `requests` log. Install via
 * `vi.stubGlobal("fetch", makeNetworkStub({...}).fetch)`.
 */
export function makeNetworkStub(config: NetworkStubConfig): {
  fetch: ReturnType<typeof vi.fn>;
  requests: string[];
} {
  const requests: string[] = [];

  const fetchStub = vi.fn((input: string | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    requests.push(url);

    if (url.includes("openrouter.ai")) {
      const openrouter = config.openrouter;
      if (openrouter === undefined) {
        // Not configured for this path — fail loudly-ish by erroring (which the
        // AI client catches → null); a test that meant to exercise AI must set it.
        return Promise.reject(new Error("makeNetworkStub: OpenRouter requested but not configured"));
      }
      if (isEdgeFailure(openrouter)) {
        return failureResponse(openrouter);
      }
      // Healthy: wrap the extraction as the OpenRouter chat-completion envelope
      // `extract` (ai.ts:95-102) parses.
      return okJson({ choices: [{ message: { content: JSON.stringify(openrouter) } }] });
    }

    if (url.includes("/search/")) {
      const search = config.search ?? DEFAULT_SEARCH_ID;
      if (isEdgeFailure(search)) {
        return failureResponse(search);
      }
      return okJson({ results: [{ id: search }] });
    }

    if (url.includes("/discover/movie")) {
      const discover = config.discover;
      if (isEdgeFailure(discover)) {
        return failureResponse(discover);
      }
      const page = Number(new URL(url).searchParams.get("page") ?? "1");
      return okJson({ results: discover[page] ?? [] });
    }

    return Promise.reject(new Error(`makeNetworkStub: unexpected URL "${url}"`));
  });

  return { fetch: fetchStub, requests };
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
