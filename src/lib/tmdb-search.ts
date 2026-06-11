import type { TmdbClient } from "@/lib/tmdb";

/**
 * Name → id resolution for AI-derived note entities (S-04).
 *
 * `/discover/movie` filters by cast and keyword only by numeric id, so the
 * strings the note extractor produces must first be resolved to TMDB ids via
 * `/search/person` and `/search/keyword`. Built on the `request()` seam in
 * `tmdb.ts`; mirrors the graceful-degradation contract (return `null`/`[]` on a
 * bad status or no match, never throw).
 */

interface SearchResponse {
  results?: { id?: number }[];
}

/** Top match's id for a free-text query against a TMDB `/search/*` endpoint. */
async function searchTopId(
  client: TmdbClient,
  endpoint: string,
  query: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const trimmed = query.trim();
  if (!trimmed) {
    return null;
  }
  const params = new URLSearchParams({ query: trimmed, include_adult: "false" });
  try {
    const response = await client.request(`${endpoint}?${params.toString()}`, { signal });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as SearchResponse;
    const id = body.results?.[0]?.id;
    return typeof id === "number" && Number.isInteger(id) ? id : null;
  } catch {
    // Abort, network error, or malformed body — fail soft.
    return null;
  }
}

/** Resolve a person name to its top TMDB person id, or `null`. */
export function searchPerson(client: TmdbClient, name: string, signal?: AbortSignal): Promise<number | null> {
  return searchTopId(client, "/search/person", name, signal);
}

/** Resolve a keyword string to its top TMDB keyword id, or `null`. */
export function searchKeyword(client: TmdbClient, keyword: string, signal?: AbortSignal): Promise<number | null> {
  return searchTopId(client, "/search/keyword", keyword, signal);
}

/** Resolved cast + keyword ids ready to merge into the discover query. */
export interface ResolvedEntities {
  castIds: number[];
  keywordIds: number[];
}

/**
 * Resolve people → person ids and keyword strings → keyword ids in parallel,
 * dropping any that fail to resolve. Caps are expected to be applied upstream
 * (note-parse): this resolves whatever it is given. Shares the caller's
 * `AbortSignal` so resolution lives within the retrieval budget.
 */
export async function resolveEntities(
  client: TmdbClient,
  entities: { people: string[]; keywords: string[] },
  signal?: AbortSignal,
): Promise<ResolvedEntities> {
  const [castIds, keywordIds] = await Promise.all([
    Promise.all(entities.people.map((p) => searchPerson(client, p, signal))),
    Promise.all(entities.keywords.map((k) => searchKeyword(client, k, signal))),
  ]);
  return {
    castIds: castIds.filter((id): id is number => id !== null),
    keywordIds: keywordIds.filter((id): id is number => id !== null),
  };
}
