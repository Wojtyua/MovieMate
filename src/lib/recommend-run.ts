import type { createClient } from "@/lib/supabase";
import { createTmdbClient } from "@/lib/tmdb";
import { createAiClient } from "@/lib/ai";
import { parseNote } from "@/lib/note-parse";
import { resolveEntities } from "@/lib/tmdb-search";
import { fetchCandidates, type TmdbMovie } from "@/lib/tmdb-discover";
import { recommend, WEIGHTS, type Taste, type SessionPrefs } from "@/lib/recommend";

/** The (non-null) Supabase client the pipeline persists through. */
type SupabaseClient = NonNullable<ReturnType<typeof createClient>>;

/**
 * Shared ceiling for the whole note-augmented TMDB path (entity resolution +
 * all relaxation attempts), matching `fetchCandidates`' own ~8s budget. Keeps
 * cumulative retrieval under the <10s NFR even when the ladder re-queries.
 */
const RETRIEVAL_BUDGET_MS = 8000;

/** A loaded session — scoring inputs plus the genre fields (tonight's taste),
 *  the runtime hard-filter, and id. */
export interface RecommendRunSession extends SessionPrefs {
  id: string;
  preferred_genre_ids: number[];
  excluded_genre_ids: number[];
  runtime_limit_minutes: number | null;
  /** Free-text note (S-04); parsed into extra discover signal, or `null`. */
  note: string | null;
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

  // S-04: parse the free-text note into extra discover signal (extra genres +
  // people/keyword strings). The AI call keeps its OWN ~2.5s budget (inside
  // `extract`), deliberately separate from TMDB's so a slow model can't starve
  // retrieval. Fails soft to empty, so a missing/unparseable note — or
  // unconfigured/slow/erroring AI — leaves the discover call below byte-for-byte
  // today's genre-only retrieval.
  let aiGenreIds: number[] = [];
  let people: string[] = [];
  let keywords: string[] = [];
  if (session.note) {
    const ai = createAiClient();
    if (ai) {
      const parsed = await parseNote(ai, session.note);
      aiGenreIds = parsed.genreIds;
      people = parsed.people;
      keywords = parsed.keywords;
    }
  }

  // One shared deadline for ALL TMDB work on the note path — entity resolution
  // plus every relaxation attempt — so stacked re-queries can't sum past the
  // <10s NFR (each `fetchCandidates` also keeps its own per-call ceiling). The
  // AI parse above already ran under its own separate budget.
  const retrievalController = new AbortController();
  const retrievalTimeout = setTimeout(() => {
    retrievalController.abort();
  }, RETRIEVAL_BUDGET_MS);

  let candidates: TmdbMovie[] = [];
  try {
    // Resolve people/keywords → TMDB ids under the shared budget.
    let castIds: number[] = [];
    let keywordIds: number[] = [];
    if (people.length > 0 || keywords.length > 0) {
      const resolved = await resolveEntities(tmdb, { people, keywords }, retrievalController.signal);
      castIds = resolved.castIds;
      keywordIds = resolved.keywordIds;
    }

    // Relaxation ladder (OQ-2 / FR-007). Stacked AI filters can drain the pool
    // below three picks, so try the fully-constrained query first and drop
    // filters in a fixed order — keywords → cast → AI-genres → genre-only
    // baseline — stopping at the first attempt with ≥3 candidates.
    // `dedupeAttempts` collapses steps that don't change the filter set (so a
    // note-less run issues a single query), and the final attempt is exactly
    // today's genre-only call, so retrieval is never worse than before S-04.
    const augmentedGenreIds = [...new Set([...discoverGenreIds, ...aiGenreIds])];
    const ladder = dedupeAttempts([
      { genreIds: augmentedGenreIds, castIds, keywordIds },
      { genreIds: augmentedGenreIds, castIds, keywordIds: [] },
      { genreIds: augmentedGenreIds, castIds: [], keywordIds: [] },
      { genreIds: discoverGenreIds, castIds: [], keywordIds: [] },
    ]);

    for (const attempt of ladder) {
      candidates = await fetchCandidates(tmdb, {
        genreIds: attempt.genreIds,
        castIds: attempt.castIds,
        keywordIds: attempt.keywordIds,
        runtimeLteMinutes: session.runtime_limit_minutes,
        voteCountGte: WEIGHTS.VOTE_COUNT_FLOOR,
        pages: 3,
        signal: retrievalController.signal,
      });
      if (candidates.length >= 3) {
        break;
      }
    }
  } catch {
    return { ok: false, message: "Could not reach TMDB, try again" };
  } finally {
    clearTimeout(retrievalTimeout);
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

/** One discover query's filter set in the relaxation ladder (S-04). */
interface DiscoverAttempt {
  genreIds: number[];
  castIds: number[];
  keywordIds: number[];
}

/**
 * Drop ladder steps whose filter set is identical to one already kept, preserving
 * order. A note-less run (or one where every AI filter dropped out) collapses to
 * a single genre-only attempt, so we never spend extra subrequests re-querying
 * the same thing.
 */
function dedupeAttempts(attempts: DiscoverAttempt[]): DiscoverAttempt[] {
  const seen = new Set<string>();
  const out: DiscoverAttempt[] = [];
  for (const attempt of attempts) {
    const sig = [attempt.genreIds, attempt.castIds, attempt.keywordIds]
      .map((ids) => [...ids].sort((a, b) => a - b).join(","))
      .join("|");
    if (!seen.has(sig)) {
      seen.add(sig);
      out.push(attempt);
    }
  }
  return out;
}
