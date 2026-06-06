import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isKnownGenreId } from "@/lib/genres";

/** Redirect back to /profiles surfacing an error message. */
function fail(context: Parameters<APIRoute>[0], message: string) {
  const params = new URLSearchParams({ error: message });
  return context.redirect(`/profiles?${params.toString()}`);
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

  const preferred = parseGenreIds(form, "preferred_genre_ids");
  const excluded = parseGenreIds(form, "excluded_genre_ids");
  if (preferred === null || excluded === null) {
    return fail(context, "Unknown genre selected");
  }
  if (preferred.some((id) => excluded.includes(id))) {
    return fail(context, "A genre cannot be both preferred and excluded");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return fail(context, "Supabase is not configured");
  }

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const { error } = await supabase.from("viewer_profiles").upsert(
    {
      user_id: user.id,
      preferred_genre_ids: preferred,
      excluded_genre_ids: excluded,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return fail(context, error.message);
  }

  return context.redirect("/profiles?saved=1");
};
