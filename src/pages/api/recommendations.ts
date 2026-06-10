import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { recommendRun, type RecommendRunSession } from "@/lib/recommend-run";
import { type Taste } from "@/lib/recommend";
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

  // 1. Load the target session (named id when present, else the latest). RLS
  //    scopes the query to the owner. Tonight's session genres ARE the taste
  //    (FR-008) — no separate core load, no /profiles precondition gate: a
  //    session with no genres simply scores on mood/intensity + quality alone.
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
  const session: RecommendRunSession = {
    id: String(sessionRaw.id),
    mood: toNullableText(sessionRaw.mood),
    preferred_genre_ids: toIntArray(sessionRaw.preferred_genre_ids),
    excluded_genre_ids: toIntArray(sessionRaw.excluded_genre_ids),
    runtime_limit_minutes: runtimeRaw == null ? null : Number(runtimeRaw),
    intensity: toIntensity(sessionRaw.intensity),
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
  //    returns data; we map each result to the existing redirects so the route's
  //    external behavior (status codes, redirect URLs, messages) is unchanged.
  const result = await recommendRun(supabase, user, session, second);
  if (!result.ok) {
    return redirectError(context, "/sessions", result.message);
  }
  return context.redirect(result.redirectTo);
};
