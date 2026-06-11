import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

/** JSON response helper — every branch returns application/json. */
function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Mark a film watched (S-05, FR-011/FR-012). Idempotent: upserts on the
 * (user_id, tmdb_movie_id) unique constraint so repeat marks are no-ops.
 *
 * JSON style (mirrors api/health/integrations.ts): guards in-route with a 401
 * JSON rather than a redirect, because the caller is a React `fetch`, not an
 * HTML form. `user_id` is always derived from the JWT (context.locals.user) —
 * never from the request body.
 */
export const POST: APIRoute = async (context) => {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return json({ error: "Supabase is not configured" }, 500);
  }

  const user = context.locals.user;
  if (!user) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await context.request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const tmdbMovieId = (body as Record<string, unknown> | null)?.tmdb_movie_id;
  if (!Number.isInteger(tmdbMovieId) || (tmdbMovieId as number) <= 0) {
    return json({ error: "tmdb_movie_id must be a positive integer" }, 400);
  }

  const { error } = await supabase
    .from("watched")
    .upsert({ user_id: user.id, tmdb_movie_id: tmdbMovieId }, { onConflict: "user_id,tmdb_movie_id" });

  if (error) {
    return json({ error: error.message }, 500);
  }

  return json({ ok: true }, 200);
};
