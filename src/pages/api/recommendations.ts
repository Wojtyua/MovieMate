import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { createTmdbClient } from "@/lib/tmdb";
import { fetchCandidates } from "@/lib/tmdb-discover";
import { recommend, WEIGHTS, type Profile, type SessionPrefs } from "@/lib/recommend";
import { DEFAULT_INTENSITY, isKnownIntensity, type Intensity } from "@/lib/session-options";

/** Read a text field from FormData, treating files/absent values as empty. */
function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** Redirect to `path` surfacing an error message in the query string. */
function redirectError(context: Parameters<APIRoute>[0], path: string, message: string) {
  const params = new URLSearchParams({ error: message });
  return context.redirect(`${path}?${params.toString()}`);
}

// The Supabase client is untyped (no Database generic), so query fields come
// back as `any`. These helpers take `unknown` (which `any` assigns to cleanly)
// and return concrete types, so no `any` leaks into the typed engine inputs.

/** Coerce an unknown value into an array of integer ids. */
function toIntArray(value: unknown): number[] {
  return Array.isArray(value) ? value.map((v) => Number(v)) : [];
}

/** Coerce an unknown value into a nullable trimmed string. */
function toNullableText(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Coerce an unknown value into a known Intensity, defaulting when unknown. */
function toIntensity(value: unknown): Intensity {
  return typeof value === "string" && isKnownIntensity(value) ? value : DEFAULT_INTENSITY;
}

/** A loaded session — scoring inputs plus the runtime hard-filter + id. */
interface SessionRow extends SessionPrefs {
  id: string;
  runtime_limit_minutes: number | null;
}

/** Union of session + core preferred genre ids (OR-union discover hint). */
function unionGenres(...lists: number[][]): number[] {
  return [...new Set(lists.flat())];
}

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const sessionId = textField(form, "session_id").trim();

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return redirectError(context, "/sessions", "Supabase is not configured");
  }

  // Guard auth in-route: /api/* is not in PROTECTED_ROUTES.
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  // 1. Need the remembered taste core (US-01 / FR-008 precondition).
  const { data: coreData } = await supabase
    .from("viewer_profiles")
    .select("preferred_genre_ids, excluded_genre_ids")
    .maybeSingle();
  if (!coreData) {
    return redirectError(context, "/profiles", "Set your taste core before getting recommendations");
  }
  const coreRaw = coreData as Record<string, unknown>;
  const core: Profile = {
    preferred_genre_ids: toIntArray(coreRaw.preferred_genre_ids),
    excluded_genre_ids: toIntArray(coreRaw.excluded_genre_ids),
  };

  // 2. Load the target session (named id when present, else the latest). RLS
  //    already scopes both queries to the owner.
  let sessionQuery = supabase
    .from("movie_night_sessions")
    .select("id, mood, preferred_genre_ids, excluded_genre_ids, runtime_limit_minutes, intensity");
  sessionQuery = sessionId
    ? sessionQuery.eq("id", sessionId)
    : sessionQuery.order("created_at", { ascending: false }).limit(1);
  const { data: sessionData } = await sessionQuery.maybeSingle();
  if (!sessionData) {
    return redirectError(context, "/sessions", "Start a movie-night session first");
  }
  const sessionRaw = sessionData as Record<string, unknown>;
  const runtimeRaw = sessionRaw.runtime_limit_minutes;
  const session: SessionRow = {
    id: String(sessionRaw.id),
    mood: toNullableText(sessionRaw.mood),
    preferred_genre_ids: toIntArray(sessionRaw.preferred_genre_ids),
    excluded_genre_ids: toIntArray(sessionRaw.excluded_genre_ids),
    runtime_limit_minutes: runtimeRaw == null ? null : Number(runtimeRaw),
    intensity: toIntensity(sessionRaw.intensity),
  };

  // 3. TMDB must be configured to retrieve candidates; persist nothing if not.
  const tmdb = createTmdbClient();
  if (!tmdb) {
    return redirectError(context, "/sessions", "Recommendations unavailable: TMDB is not configured");
  }

  // 4. Retrieve candidates. Excluded genres are NOT passed to discover — they
  //    are a scoring penalty (FR-006). Only runtime is a hard filter.
  let candidates;
  try {
    candidates = await fetchCandidates(tmdb, {
      genreIds: unionGenres(session.preferred_genre_ids, core.preferred_genre_ids),
      runtimeLteMinutes: session.runtime_limit_minutes,
      voteCountGte: WEIGHTS.VOTE_COUNT_FLOOR,
      pages: 3,
    });
  } catch {
    return redirectError(context, "/sessions", "Could not reach TMDB, try again");
  }
  if (candidates.length === 0) {
    return redirectError(context, "/sessions", "Could not reach TMDB, try again");
  }

  // 5. Score + assign roles. S-01 stopgap: the engine still takes a fixed
  //    [Profile, Profile] pair, so we feed the single core to both slots as a
  //    degenerate duo. Passing [core, core] doubles each candidate's per-viewer
  //    reward uniformly, leaving ranking/roles/diversity unchanged versus a
  //    single-viewer pass. S-02 generalizes the engine and removes this shim.
  const result = recommend([core, core], session, candidates);
  if (result.picks.length === 0) {
    return redirectError(context, "/sessions", "No matching films — broaden your preferences");
  }

  // 6. Persist the run + its picks (snapshotting display fields).
  const { data: runData, error: runError } = await supabase
    .from("recommendations")
    .insert({ user_id: user.id, session_id: session.id })
    .select("id")
    .single();
  if (runError) {
    return redirectError(context, "/sessions", runError.message);
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
    return redirectError(context, "/sessions", picksError.message);
  }

  // 7. Show the results.
  return context.redirect(`/sessions/${session.id}/recommendations`);
};
