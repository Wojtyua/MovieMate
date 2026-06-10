import type { createClient } from "@/lib/supabase";
import { createTmdbClient } from "@/lib/tmdb";
import { fetchCandidates } from "@/lib/tmdb-discover";
import { recommend, WEIGHTS, type Taste, type SessionPrefs } from "@/lib/recommend";

/** The (non-null) Supabase client the pipeline persists through. */
type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

/** A loaded session — scoring inputs plus the genre fields (tonight's taste),
 *  the runtime hard-filter, and id. */
export interface RecommendRunSession extends SessionPrefs {
  id: string;
  preferred_genre_ids: number[];
  excluded_genre_ids: number[];
  runtime_limit_minutes: number | null;
}

/** Discriminated result of a run: success carries the persisted run id and the
 *  picks-page redirect target; failure carries the user-facing message. The
 *  helper never redirects — the caller maps these to its own redirects. */
export type RecommendRunResult =
  | { ok: true; recommendationId: string; redirectTo: string }
  | { ok: false; message: string };

/**
 * Given a loaded session (+ optional second taste), retrieve TMDB candidates,
 * score them, and persist the run + its picks. This is the always-three-picks
 * pipeline (test-plan Risk #1 / #2) extracted verbatim from the endpoint so a
 * single implementation backs both the legacy and the one-shot callers and the
 * guarantee logic is unit-testable in isolation. It returns data; it does NOT
 * call `context.redirect`.
 */
export async function recommendRun(
  supabase: SupabaseClient,
  user: { id: string },
  session: RecommendRunSession,
  second: Taste | null,
): Promise<RecommendRunResult> {
  // Tonight's session genres are the single taste (FR-008).
  const taste: Taste = {
    preferred_genre_ids: session.preferred_genre_ids,
    excluded_genre_ids: session.excluded_genre_ids,
  };

  // TMDB must be configured to retrieve candidates; persist nothing if not.
  const tmdb = createTmdbClient();
  if (!tmdb) {
    return { ok: false, message: "Recommendations unavailable: TMDB is not configured" };
  }

  // Retrieve candidates. Excluded genres are NOT passed to discover — they
  // are a scoring penalty (FR-006). Only runtime is a hard filter. The
  // discover hint is the union of both viewers' preferred genres so the
  // candidate pool covers the duo (solo path: just tonight's preferred).
  const discoverGenreIds = [...new Set([...taste.preferred_genre_ids, ...(second?.preferred_genre_ids ?? [])])];
  let candidates;
  try {
    candidates = await fetchCandidates(tmdb, {
      genreIds: discoverGenreIds,
      runtimeLteMinutes: session.runtime_limit_minutes,
      voteCountGte: WEIGHTS.VOTE_COUNT_FLOOR,
      pages: 3,
    });
  } catch {
    return { ok: false, message: "Could not reach TMDB, try again" };
  }
  if (candidates.length === 0) {
    return { ok: false, message: "Could not reach TMDB, try again" };
  }

  // Score + assign roles (FR-009). Solo session → the single-taste branch
  // returns safe / crowd_pleaser / wild_card. With a second viewer the engine
  // takes the two-taste branch and returns safe / compromise / wild_card.
  const result = recommend(
    second ? [taste, second] : [taste],
    { mood: session.mood, intensity: session.intensity },
    candidates,
  );
  if (result.picks.length === 0) {
    return { ok: false, message: "No matching films — broaden your preferences" };
  }

  // Persist the run + its picks (snapshotting display fields).
  const { data: runData, error: runError } = await supabase
    .from("recommendations")
    .insert({ user_id: user.id, session_id: session.id })
    .select("id")
    .single();
  if (runError) {
    return { ok: false, message: runError.message };
  }
  const recommendationId = String((runData as Record<string, unknown>).id);

  const pickRows = result.picks.map((pick) => ({
    user_id: user.id,
    recommendation_id: recommendationId,
    role: pick.role,
    tmdb_movie_id: pick.movie.id,
    score: pick.score,
    title: pick.movie.title,
    poster_path: pick.movie.poster_path,
    overview: pick.movie.overview,
    genre_ids: pick.movie.genre_ids,
    release_date: pick.movie.release_date,
    vote_average: pick.movie.vote_average,
  }));
  const { error: picksError } = await supabase.from("recommendation_picks").insert(pickRows);
  if (picksError) {
    return { ok: false, message: picksError.message };
  }

  return { ok: true, recommendationId, redirectTo: `/sessions/${session.id}/recommendations` };
}
