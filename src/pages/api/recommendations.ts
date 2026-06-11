import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { recommendRun, type RecommendRunSession } from "@/lib/recommend-run";
import { type Taste } from "@/lib/recommend";
import { isKnownGenreId } from "@/lib/genres";
import { isKnownMood, isKnownIntensity, DEFAULT_INTENSITY, type Intensity } from "@/lib/session-options";

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

/** Parse repeated `name` form fields into a list of valid TMDB genre IDs. */
function parseGenreIds(form: FormData, name: string): number[] | null {
  const ids = form.getAll(name).map((v) => Number(v));
  if (ids.some((n) => !Number.isInteger(n) || !isKnownGenreId(n))) {
    return null;
  }
  // De-dupe while preserving order.
  return [...new Set(ids)];
}

// One-shot recommend: a single submit validates tonight's preferences, persists
// a new session row (the FK requires a persisted session before a run), then
// runs the always-three-picks pipeline and redirects straight to the picks. The
// session is created invisibly — there is no separate "save session" step and no
// `session_id` / update branch (edit mode is retired). On any failure we redirect
// back to /sessions?error=… ; the just-saved session is now the latest row, so
// the page re-fills the form from it and tonight's inputs survive a retry.
export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();

  // Validate the preference field set (same rules the standalone endpoint used).
  // mood: optional, but if present must be a known mood.
  const moodRaw = textField(form, "mood").trim();
  if (moodRaw !== "" && !isKnownMood(moodRaw)) {
    return redirectError(context, "/sessions", "Unknown mood selected");
  }
  const mood = moodRaw === "" ? null : moodRaw;

  // intensity: optional, defaults to medium; if present must be known.
  const intensityRaw = textField(form, "intensity").trim();
  if (intensityRaw !== "" && !isKnownIntensity(intensityRaw)) {
    return redirectError(context, "/sessions", "Unknown intensity selected");
  }
  const intensity: Intensity = intensityRaw === "" ? DEFAULT_INTENSITY : intensityRaw;

  const preferred = parseGenreIds(form, "preferred_genre_ids");
  const excluded = parseGenreIds(form, "excluded_genre_ids");
  if (preferred === null || excluded === null) {
    return redirectError(context, "/sessions", "Unknown genre selected");
  }
  if (preferred.some((id) => excluded.includes(id))) {
    return redirectError(context, "/sessions", "A genre cannot be both preferred and excluded");
  }

  // runtime_limit_minutes: optional ("no limit" → null); if present must be a
  // positive integer (mirrors the DB CHECK).
  const runtimeRaw = textField(form, "runtime_limit_minutes").trim();
  let runtimeLimit: number | null = null;
  if (runtimeRaw !== "") {
    const minutes = Number(runtimeRaw);
    if (!Number.isInteger(minutes) || minutes <= 0) {
      return redirectError(context, "/sessions", "Runtime limit must be a positive number of minutes");
    }
    runtimeLimit = minutes;
  }

  const noteRaw = textField(form, "note").trim();
  const note = noteRaw === "" ? null : noteRaw;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return redirectError(context, "/sessions", "Supabase is not configured");
  }

  // Guard auth in-route: /api/* is not in PROTECTED_ROUTES.
  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  // 1. Persist a new session row before running the pipeline — the FK
  //    (recommendations.session_id NOT NULL) requires it, and the error-recovery
  //    design depends on it being the latest row. user_id comes from the JWT via
  //    the column default, but we set it explicitly to mirror /profiles.
  const { data: inserted, error: insertError } = await supabase
    .from("movie_night_sessions")
    .insert({
      user_id: user.id,
      mood,
      preferred_genre_ids: preferred,
      excluded_genre_ids: excluded,
      runtime_limit_minutes: runtimeLimit,
      intensity,
      note,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insertError) {
    return redirectError(context, "/sessions", insertError.message);
  }

  const session: RecommendRunSession = {
    id: String((inserted as Record<string, unknown>).id),
    mood,
    preferred_genre_ids: preferred,
    excluded_genre_ids: excluded,
    runtime_limit_minutes: runtimeLimit,
    intensity,
    note,
  };

  // 2. Optional second viewer (duo path, FR-005). Captured on-device and POSTed
  //    inline as repeated fields — same pattern as session genres. It is NEVER
  //    persisted: it rides only this request and touches no table. A genre in
  //    both lists is dropped from excluded (self-overlap sanitize, mirrors
  //    SessionForm). `second` stays null unless at least one genre was picked,
  //    so absent/empty fields fall back to the solo path.
  const secondPreferred = form.getAll("second_preferred_genre_ids").map(Number).filter(Number.isInteger);
  const secondPreferredSet = new Set(secondPreferred);
  const secondExcluded = form
    .getAll("second_excluded_genre_ids")
    .map(Number)
    .filter((id) => Number.isInteger(id) && !secondPreferredSet.has(id));
  const second: Taste | null =
    secondPreferred.length > 0 || secondExcluded.length > 0
      ? { preferred_genre_ids: secondPreferred, excluded_genre_ids: secondExcluded }
      : null;

  // 3. Retrieve + score + persist (the always-three-picks pipeline). The helper
  //    returns data; we map each result to a redirect. On failure the just-saved
  //    session is the latest row, so /sessions re-fills the form from it.
  const result = await recommendRun(supabase, user, session, second);
  if (!result.ok) {
    return redirectError(context, "/sessions", result.message);
  }
  return context.redirect(result.redirectTo);
};
