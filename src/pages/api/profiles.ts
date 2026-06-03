import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { isKnownGenreId } from "@/lib/genres";

/** Read a text field from FormData, treating files/absent values as empty. */
function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** Redirect back to /profiles surfacing an error against a specific slot. */
function fail(context: Parameters<APIRoute>[0], slot: string, message: string) {
  const params = new URLSearchParams({ error: message, slot });
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
  const slotRaw = textField(form, "slot");

  // Slot must be 1 or 2 (mirrors the DB CHECK). Used in the error redirect too.
  if (slotRaw !== "1" && slotRaw !== "2") {
    return fail(context, slotRaw || "1", "Invalid profile slot");
  }
  const slot = Number(slotRaw);

  const displayName = textField(form, "display_name").trim();
  if (!displayName) {
    return fail(context, slotRaw, "Name is required");
  }

  const preferred = parseGenreIds(form, "preferred_genre_ids");
  const excluded = parseGenreIds(form, "excluded_genre_ids");
  if (preferred === null || excluded === null) {
    return fail(context, slotRaw, "Unknown genre selected");
  }
  if (preferred.some((id) => excluded.includes(id))) {
    return fail(context, slotRaw, "A genre cannot be both preferred and excluded");
  }

  const noteRaw = textField(form, "note").trim();
  const note = noteRaw === "" ? null : noteRaw;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return fail(context, slotRaw, "Supabase is not configured");
  }

  const user = context.locals.user;
  if (!user) {
    return context.redirect("/auth/signin");
  }

  const { error } = await supabase.from("viewer_profiles").upsert(
    {
      user_id: user.id,
      slot,
      display_name: displayName,
      preferred_genre_ids: preferred,
      excluded_genre_ids: excluded,
      note,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,slot" },
  );

  if (error) {
    return fail(context, slotRaw, error.message);
  }

  return context.redirect(`/profiles?saved=${slotRaw}`);
};
