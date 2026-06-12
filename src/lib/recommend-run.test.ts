import { afterEach, describe, expect, it, vi } from "vitest";

// Scope the env shim to this integration file so the Phase 2 unit suite stays
// infra-free. `createTmdbClient()` reads TMDB_READ_ACCESS_TOKEN from
// astro:env/server (a virtual Astro module Vitest cannot resolve); without a
// truthy token the client is null and recommendRun short-circuits before the
// ladder. ai.ts pulls OPENROUTER_API_KEY/AI_MODEL from the same module at load,
// so they are exported too (the no-note path never reads them).
vi.mock("astro:env/server", () => ({
  TMDB_READ_ACCESS_TOKEN: "test-token",
  OPENROUTER_API_KEY: "",
  AI_MODEL: "",
}));

import { recommendRun, type RecommendRunSession } from "@/lib/recommend-run";
import type { Role } from "@/lib/recommend/roles";
import { createFakeSupabase, makeDiscoverMovie, makeFetchStub } from "@/lib/__fixtures__/recommend-run-doubles";

/**
 * Supply-layer integration suite for `recommendRun` on the genre-only (no-note)
 * path (test-plan §3 Phase 1, supply-half of R1). Stubs only the network edge
 * (`fetch`) + the env token; supplies a hand-rolled fake Supabase. No internal
 * `@/lib/recommend*` module is mocked. Asserts role/shape/exclusion/count —
 * never exact float scores (test-plan §7).
 */

const USER = { id: "user-1" };

// Solo, no-note session: the ladder collapses to a single genre-only rung.
function soloSession(overrides: Partial<RecommendRunSession> = {}): RecommendRunSession {
  return {
    id: "sess-1",
    mood: null,
    intensity: "medium",
    preferred_genre_ids: [28],
    excluded_genre_ids: [],
    runtime_limit_minutes: null,
    note: null,
    ...overrides,
  };
}

const SOLO_ROLES: Role[] = ["safe", "crowd_pleaser", "wild_card"];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recommendRun — supply guarantees (no-note path)", () => {
  it("a healthy ≥3 pool persists exactly three role-labeled, distinct picks", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchStub({
        1: [
          makeDiscoverMovie({ id: 1, genre_ids: [28, 12], vote_average: 8, vote_count: 1000, popularity: 100 }),
          makeDiscoverMovie({ id: 2, genre_ids: [28], vote_average: 7, vote_count: 500, popularity: 80 }),
        ],
        2: [
          makeDiscoverMovie({ id: 3, genre_ids: [35], vote_average: 6, vote_count: 300, popularity: 50 }),
          makeDiscoverMovie({ id: 4, genre_ids: [18], vote_average: 5, vote_count: 200, popularity: 40 }),
        ],
        3: [makeDiscoverMovie({ id: 5, genre_ids: [27], vote_average: 4, vote_count: 150, popularity: 30 })],
      }),
    );
    const { client, insertedPickRows } = createFakeSupabase();

    const result = await recommendRun(client, USER, soloSession(), null);

    expect(result).toEqual({
      ok: true,
      recommendationId: "rec-1",
      redirectTo: "/sessions/sess-1/recommendations",
    });
    expect(insertedPickRows).toHaveLength(1);
    const rows = insertedPickRows[0];
    expect(rows).toHaveLength(3);
    const ids = rows.map((r) => r.tmdb_movie_id);
    expect(new Set(ids).size).toBe(3);
    for (const row of rows) {
      expect(SOLO_ROLES).toContain(row.role as Role);
    }
  });

  it("dedups a movie repeated across discover pages (not double-counted)", async () => {
    vi.stubGlobal(
      "fetch",
      makeFetchStub({
        1: [
          makeDiscoverMovie({ id: 1, genre_ids: [28, 12], vote_average: 8, vote_count: 1000, popularity: 100 }),
          makeDiscoverMovie({ id: 2, genre_ids: [28], vote_average: 7, vote_count: 500, popularity: 80 }),
        ],
        // id 1 repeats here — the deduped pool must not let it become two picks.
        2: [
          makeDiscoverMovie({ id: 1, genre_ids: [28, 12], vote_average: 8, vote_count: 1000, popularity: 100 }),
          makeDiscoverMovie({ id: 3, genre_ids: [35], vote_average: 6, vote_count: 300, popularity: 50 }),
        ],
        3: [makeDiscoverMovie({ id: 4, genre_ids: [18], vote_average: 5, vote_count: 200, popularity: 40 })],
      }),
    );
    const { client, insertedPickRows } = createFakeSupabase();

    const result = await recommendRun(client, USER, soloSession(), null);

    expect(result.ok).toBe(true);
    const ids = insertedPickRows[0].map((r) => r.tmdb_movie_id);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
  });

  it("excludes a watched film from the persisted picks even when it tops the pool", async () => {
    // id 1 would be the safe pick (best genre match + top quality/popularity);
    // marking it watched must keep it out of every persisted pick.
    vi.stubGlobal(
      "fetch",
      makeFetchStub({
        1: [
          makeDiscoverMovie({ id: 1, genre_ids: [28, 12], vote_average: 9, vote_count: 5000, popularity: 200 }),
          makeDiscoverMovie({ id: 2, genre_ids: [28], vote_average: 7, vote_count: 500, popularity: 80 }),
        ],
        2: [
          makeDiscoverMovie({ id: 3, genre_ids: [35], vote_average: 6, vote_count: 300, popularity: 50 }),
          makeDiscoverMovie({ id: 4, genre_ids: [18], vote_average: 5, vote_count: 200, popularity: 40 }),
        ],
        3: [],
      }),
    );
    const { client, insertedPickRows } = createFakeSupabase({ watchedRows: [{ tmdb_movie_id: 1 }] });

    const result = await recommendRun(client, USER, soloSession(), null);

    expect(result.ok).toBe(true);
    const ids = insertedPickRows[0].map((r) => r.tmdb_movie_id);
    expect(ids).not.toContain(1);
    expect(ids).toHaveLength(3);
  });
});

describe("recommendRun — supply boundary (two faces of R1)", () => {
  it("a genuinely thin universe of 2 films persists 2 picks with ok:true (no fabricated third)", async () => {
    // The *physics* face of R1: the genre-only baseline can only supply two
    // films, so two picks is correct — not a drain to guard against.
    vi.stubGlobal(
      "fetch",
      makeFetchStub({
        1: [
          makeDiscoverMovie({ id: 1, genre_ids: [28, 12], vote_average: 8, vote_count: 1000, popularity: 100 }),
          makeDiscoverMovie({ id: 2, genre_ids: [28], vote_average: 7, vote_count: 500, popularity: 80 }),
        ],
      }),
    );
    const { client, insertedPickRows } = createFakeSupabase();

    const result = await recommendRun(client, USER, soloSession(), null);

    expect(result.ok).toBe(true);
    expect(insertedPickRows[0]).toHaveLength(2);
  });

  it("a zero-candidate universe returns ok:false with the TMDB-reach message and persists nothing", async () => {
    vi.stubGlobal("fetch", makeFetchStub({}));
    const { client, insertedPickRows } = createFakeSupabase();

    const result = await recommendRun(client, USER, soloSession(), null);

    expect(result).toEqual({ ok: false, message: "Could not reach TMDB, try again" });
    expect(insertedPickRows).toHaveLength(0);
  });
});
