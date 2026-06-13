import { beforeAll, describe, expect, it } from "vitest";
import { signUpClient, SUPABASE_URL, type AuthedClient } from "./supabase-clients";

// Risk #4 — IDOR / own-data isolation (test-plan §2, Phase 3).
//
// Two freshly signed-up users run against the LOCAL Supabase stack, each with
// their own authenticated supabase-js client (anon key + their session JWT) —
// mirroring the app's real data seam (src/lib/supabase.ts: PostgREST as the
// authenticated user, auth.uid() RLS applies). User A writes one row into every
// owner-scoped entity; user B then tries to read A's rows by A's identifiers
// (the URL-id-swap vector for recommendations/picks) and must get EMPTY results.
// A reads its own rows as a positive ("teeth") control so the suite fails loudly
// if writes silently no-op or auth is misconfigured rather than passing on a
// broken-auth false green.
//
// Gated behind RUN_ISOLATION (set only by `npm run test:isolation`) so the
// keyless default `npm run test:run` collects but SKIPS this Docker-dependent
// spec. This is the app-wiring counterpart to the DB-layer pgTAP policy proof
// (supabase/tests/*_isolation.sql), which exercises the policies but not the
// createClient-with-JWT seam nor the URL-swap read path.

const RUN = !!process.env.RUN_ISOLATION;

describe.skipIf(!RUN)("own-data isolation (IDOR) at the app client seam", () => {
  let a: AuthedClient;
  let b: AuthedClient;
  let sessionId: string;
  let recId: string;

  const TMDB_MOVIE_ID = 101;

  beforeAll(async () => {
    // Fail fast with an actionable message if the stack is down, rather than
    // emitting opaque connection errors from the first query.
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/health`);
      if (!res.ok) {
        throw new Error(`health endpoint returned ${res.status}`);
      }
    } catch (cause) {
      throw new Error(
        `Local Supabase stack unreachable at ${SUPABASE_URL} — start it with \`npm run db:start\`. (${
          cause instanceof Error ? cause.message : String(cause)
        })`,
      );
    }

    a = await signUpClient();
    b = await signUpClient();

    // A writes one row per owner-scoped entity. user_id is never passed — it
    // comes from the auth.uid() column default, exercising the real
    // ownership-on-insert path the app relies on.
    const profile = await a.client
      .from("viewer_profiles")
      .upsert({ preferred_genre_ids: [28], excluded_genre_ids: [27] }, { onConflict: "user_id" });
    expect(profile.error, profile.error?.message).toBeNull();

    const session = await a.client
      .from("movie_night_sessions")
      .insert({ mood: "cozy", intensity: "low" })
      .select("id")
      .single();
    expect(session.error, session.error?.message).toBeNull();
    sessionId = (session.data?.id ?? "") as string;

    const rec = await a.client.from("recommendations").insert({ session_id: sessionId }).select("id").single();
    expect(rec.error, rec.error?.message).toBeNull();
    recId = (rec.data?.id ?? "") as string;

    const pick = await a.client.from("recommendation_picks").insert({
      recommendation_id: recId,
      role: "safe",
      tmdb_movie_id: TMDB_MOVIE_ID,
      score: 1.5,
      title: "A safe pick",
    });
    expect(pick.error, pick.error?.message).toBeNull();

    const watched = await a.client.from("watched").insert({ tmdb_movie_id: TMDB_MOVIE_ID });
    expect(watched.error, watched.error?.message).toBeNull();
  });

  it("viewer_profiles: B reads zero, A reads its own taste core", async () => {
    const bRead = await b.client.from("viewer_profiles").select("user_id");
    expect(bRead.error, bRead.error?.message).toBeNull();
    expect(bRead.data).toHaveLength(0);

    const aRead = await a.client.from("viewer_profiles").select("user_id");
    expect(aRead.error, aRead.error?.message).toBeNull();
    expect(aRead.data?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("movie_night_sessions: B cannot read A's session by id, A reads its own", async () => {
    const bRead = await b.client.from("movie_night_sessions").select("id").eq("id", sessionId);
    expect(bRead.error, bRead.error?.message).toBeNull();
    expect(bRead.data).toHaveLength(0);

    const aRead = await a.client.from("movie_night_sessions").select("id").eq("id", sessionId);
    expect(aRead.error, aRead.error?.message).toBeNull();
    expect(aRead.data?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("recommendations: B cannot read A's run by A's session_id (URL-swap), A reads its own", async () => {
    // The sharpest case: B swaps in A's session_id — exactly what
    // src/pages/sessions/[id]/recommendations.astro does with the URL param.
    const bRead = await b.client.from("recommendations").select("id").eq("session_id", sessionId);
    expect(bRead.error, bRead.error?.message).toBeNull();
    expect(bRead.data).toHaveLength(0);

    const aRead = await a.client.from("recommendations").select("id").eq("session_id", sessionId);
    expect(aRead.error, aRead.error?.message).toBeNull();
    expect(aRead.data?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("recommendation_picks: B cannot read A's picks by A's recommendation_id (URL-swap), A reads its own", async () => {
    const bRead = await b.client.from("recommendation_picks").select("id").eq("recommendation_id", recId);
    expect(bRead.error, bRead.error?.message).toBeNull();
    expect(bRead.data).toHaveLength(0);

    const aRead = await a.client.from("recommendation_picks").select("id").eq("recommendation_id", recId);
    expect(aRead.error, aRead.error?.message).toBeNull();
    expect(aRead.data?.length ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("watched: B reads zero, A reads its own watched row", async () => {
    const bRead = await b.client.from("watched").select("id").eq("tmdb_movie_id", TMDB_MOVIE_ID);
    expect(bRead.error, bRead.error?.message).toBeNull();
    expect(bRead.data).toHaveLength(0);

    const aRead = await a.client.from("watched").select("id").eq("tmdb_movie_id", TMDB_MOVIE_ID);
    expect(aRead.error, aRead.error?.message).toBeNull();
    expect(aRead.data?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});
