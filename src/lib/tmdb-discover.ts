import type { TmdbClient } from "@/lib/tmdb";

/**
 * Candidate-retrieval client for S-03 scored recommendations (FR-005).
 *
 * Built on top of the `request()` seam in `tmdb.ts` (bearer v4, raw workerd-safe
 * fetch). Adds the discover query the recommendation engine needs: a typed
 * `/discover/movie` call, a query-param builder, multi-page merge/dedup, an
 * `AbortController` budget for the <10s NFR, and a watched-exclusion seam
 * (S-05) defaulted empty.
 *
 * NOTE: discover list items do NOT carry `runtime`. Runtime is enforced solely
 * by the `with_runtime.lte` hard filter at query time — never by a per-movie
 * detail call (which would blow the 50-subrequest / <10s budget).
 */

/** The subset of a TMDB discover list item the scoring engine + UI consume. */
export interface TmdbMovie {
  id: number;
  title: string;
  genre_ids: number[];
  vote_average: number;
  vote_count: number;
  popularity: number;
  release_date: string;
  overview: string;
  poster_path: string | null;
}

/** Inputs to a single `/discover/movie` page request. */
export interface DiscoverParams {
  /** Preferred TMDB genre ids, OR-unioned (`with_genres = a|b|c`). */
  genreIds?: number[];
  /** AI-derived cast (person) ids, OR-unioned (`with_cast = a|b`); S-04. */
  castIds?: number[];
  /** AI-derived keyword ids, OR-unioned (`with_keywords = a|b|c`); S-04. */
  keywordIds?: number[];
  /** Runtime ceiling in minutes; `with_runtime.lte` only when non-null. */
  runtimeLteMinutes?: number | null;
  /** Minimum vote count floor; keeps low-vote outliers out of the pool. */
  voteCountGte?: number;
  /** TMDB sort key; defaults to `popularity.desc`. */
  sortBy?: string;
  /** 1-based page index; defaults to 1. */
  page?: number;
}

/** TMDB's discover response envelope (only the fields we read). */
interface DiscoverResponse {
  results?: Partial<TmdbMovie>[];
}

/** Coerce a raw discover result into a fully-populated `TmdbMovie`. */
function normalizeMovie(raw: Partial<TmdbMovie>): TmdbMovie {
  return {
    id: Number(raw.id),
    title: raw.title ?? "",
    genre_ids: Array.isArray(raw.genre_ids) ? raw.genre_ids : [],
    vote_average: typeof raw.vote_average === "number" ? raw.vote_average : 0,
    vote_count: typeof raw.vote_count === "number" ? raw.vote_count : 0,
    popularity: typeof raw.popularity === "number" ? raw.popularity : 0,
    release_date: raw.release_date ?? "",
    overview: raw.overview ?? "",
    poster_path: raw.poster_path ?? null,
  };
}

/**
 * One typed `/discover/movie` page. Builds the query string, calls the
 * `request()` seam, parses `results` into `TmdbMovie[]`, and returns `[]` on any
 * non-ok response (graceful degradation — never throws on a bad status).
 *
 * `signal` is threaded so `fetchCandidates` can share one `AbortController`
 * across its pages.
 */
export async function discoverMovies(
  client: TmdbClient,
  params: DiscoverParams,
  signal?: AbortSignal,
): Promise<TmdbMovie[]> {
  const query = new URLSearchParams();
  query.set("include_adult", "false");
  query.set("sort_by", params.sortBy ?? "popularity.desc");
  query.set("page", String(params.page ?? 1));

  if (params.genreIds && params.genreIds.length > 0) {
    // OR-union: preferred genres are a hint, not an AND filter (FR-006).
    query.set("with_genres", params.genreIds.join("|"));
  }
  if (params.castIds && params.castIds.length > 0) {
    // OR-union, consistent with with_genres (S-04 note-derived cast).
    query.set("with_cast", params.castIds.join("|"));
  }
  if (params.keywordIds && params.keywordIds.length > 0) {
    // OR-union, consistent with with_genres (S-04 note-derived keywords).
    query.set("with_keywords", params.keywordIds.join("|"));
  }
  if (params.runtimeLteMinutes != null) {
    // The ONLY hard filter (runtime is unavailable per-candidate).
    query.set("with_runtime.lte", String(params.runtimeLteMinutes));
  }
  if (params.voteCountGte != null) {
    query.set("vote_count.gte", String(params.voteCountGte));
  }

  const response = await client.request(`/discover/movie?${query.toString()}`, { signal });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json()) as DiscoverResponse;
  const results = Array.isArray(body.results) ? body.results : [];
  return results.map(normalizeMovie).filter((m) => Number.isInteger(m.id));
}

/** Options for assembling the full candidate pool. */
export interface FetchCandidatesOptions {
  genreIds?: number[];
  /** AI-derived cast ids merged into every discover page (S-04). */
  castIds?: number[];
  /** AI-derived keyword ids merged into every discover page (S-04). */
  keywordIds?: number[];
  runtimeLteMinutes?: number | null;
  /** Number of discover pages to merge; defaults to 3 (subrequest budget). */
  pages?: number;
  voteCountGte?: number;
  /** Watched-exclusion seam (S-05); defaults to empty (no exclusions). */
  excludeMovieIds?: Set<number>;
}

/** Default page count — keeps retrieval at ≤3 subrequests for the <10s budget. */
const DEFAULT_PAGES = 3;
/** Abort ceiling for the whole candidate fetch, well under the <10s NFR. */
const FETCH_BUDGET_MS = 8000;

/**
 * Assemble the candidate pool: fetch `pages` discover pages, merge + dedup by
 * `id`, drop any `excludeMovieIds`, all under one shared `AbortController` with
 * an ~8s budget. Returns whatever was gathered before the budget/last page —
 * a timeout or a non-ok page yields a shorter (possibly empty) list, never a throw.
 */
export async function fetchCandidates(client: TmdbClient, opts: FetchCandidatesOptions): Promise<TmdbMovie[]> {
  const pages = opts.pages ?? DEFAULT_PAGES;
  const exclude = opts.excludeMovieIds ?? new Set<number>();
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, FETCH_BUDGET_MS);

  const byId = new Map<number, TmdbMovie>();
  try {
    for (let page = 1; page <= pages; page++) {
      if (controller.signal.aborted) {
        break;
      }
      const movies = await discoverMovies(
        client,
        {
          genreIds: opts.genreIds,
          castIds: opts.castIds,
          keywordIds: opts.keywordIds,
          runtimeLteMinutes: opts.runtimeLteMinutes,
          voteCountGte: opts.voteCountGte,
          page,
        },
        controller.signal,
      );
      for (const movie of movies) {
        if (!byId.has(movie.id) && !exclude.has(movie.id)) {
          byId.set(movie.id, movie);
        }
      }
    }
  } catch {
    // Abort or network error: return what we gathered so far (graceful).
  } finally {
    clearTimeout(timeout);
  }

  return [...byId.values()];
}
