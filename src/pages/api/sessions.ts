import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isKnownGenreId } from "@/lib/genres";
import { isKnownMood, isKnownIntensity, DEFAULT_INTENSITY } from "@/lib/session-options";

/** Read a text field from FormData, treating files/absent values as empty. */
function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** Redirect back to /sessions surfacing an error message. */
function fail(context: Parameters<APIRoute>[0], message: string) {
  const params = new URLSearchParams({ error: message });
  return context.redirect(`/sessions?${params.toString()}`);
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

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();

  // Empty session_id → create a new session; present → update that row.
  const sessionId = textField(form, "session_id").trim();

  // mood: optional, but if present must be a known mood.
  const moodRaw = textField(form, "mood").trim();
  if (moodRaw !== "" && !isKnownMood(moodRaw)) {
    return fail(context, "Unknown mood selected");
  }
  const mood = moodRaw === "" ? null : moodRaw;

  // intensity: optional, defaults to medium; if present must be known.
  const intensityRaw = textField(form, "intensity").trim();
  if (intensityRaw !== "" && !isKnownIntensity(intensityRaw)) {
    return fail(context, "Unknown intensity selected");
  }
  const intensity = intensityRaw === "" ? DEFAULT_INTENSITY : intensityRaw;

  const preferred = parseGenreIds(form, "preferred_genre_ids");
  const excluded = parseGenreIds(form, "excluded_genre_ids");
  if (preferred === null || excluded === null) {
    return fail(context, "Unknown genre selected");
  }
  if (preferred.some((id) => excluded.includes(id))) {
    return fail(context, "A genre cannot be both preferred and excluded");
  }

  // runtime_limit_minutes: optional ("no limit" → null); if present must be a
  // positive integer (mirrors the DB CHECK).
  const runtimeRaw = textField(form, "runtime_limit_minutes").trim();
  let runtimeLimit: number | null = null;
  if (runtimeRaw !== "") {
    const minutes = Number(runtimeRaw);
    if (!Number.isInteger(minutes) || minutes <= 0) {
      return fail(context, "Runtime limit must be a positive number of minutes");
    }
    runtimeLimit = minutes;
  }

  const noteRaw = textField(form, "note").trim();
  const note = noteRaw === "" ? null : noteRaw;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return fail(context, "Supabase is not configured");
  }

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const fields = {
    mood,
    preferred_genre_ids: preferred,
    excluded_genre_ids: excluded,
    runtime_limit_minutes: runtimeLimit,
    intensity,
    note,
    updated_at: new Date().toISOString(),
  };

  if (sessionId) {
    // Edit the named session. RLS already scopes to the owner; the explicit
    // id match keeps the update targeted to the one row.
    const { data, error } = await supabase
      .from("movie_night_sessions")
      .update(fields)
      .eq("id", sessionId)
      .select("id")
      .maybeSingle();

    if (error) {
      return fail(context, error.message);
    }
    if (!data) {
      // No row matched under RLS (not owner, or deleted) — surface rather than
      // silently creating a duplicate.
      return fail(context, "Session not found");
    }
    return context.redirect(`/sessions?saved=${data.id}`);
  }

  // Start a new session. user_id comes from the JWT via the column default, but
  // we set it explicitly to mirror the profiles endpoint.
  const { data, error } = await supabase
    .from("movie_night_sessions")
    .insert({ user_id: user.id, ...fields })
    .select("id")
    .single();

  if (error) {
    return fail(context, error.message);
  }

  return context.redirect(`/sessions?saved=${data.id}`);
};
