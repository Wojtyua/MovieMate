import { afterEach, describe, expect, it, vi } from "vitest";

// Sibling of `recommend-run.degradation.test.ts`, split purely by the env shim:
// here OPENROUTER_API_KEY is EMPTY, so `createAiClient()` returns null and the
// AI path is never built — even with a note present. The shim is a hoisted,
// static object, so this config-state case cannot coexist with the truthy-key
// file. TMDB_READ_ACCESS_TOKEN stays truthy so retrieval still runs.
vi.mock("astro:env/server", () => ({
  TMDB_READ_ACCESS_TOKEN: "test-token",
  OPENROUTER_API_KEY: "",
  AI_MODEL: "",
}));

import { recommendRun, type RecommendRunSession } from "@/lib/recommend-run";
import type { Role } from "@/lib/recommend/roles";
import { createFakeSupabase, makeDiscoverMovie, makeNetworkStub } from "@/lib/__fixtures__/recommend-run-doubles";

/**
 * The config-state half of "OpenRouter fails" (test-plan §3 Phase 2 / Risk #2):
 * a note is present, but OpenRouter is UNCONFIGURED. `createAiClient()` returns
 * null, so retrieval degrades to genre-only and still returns three picks — and
 * no OpenRouter request is ever made (the client was never built).
 */

const USER = { id: "user-1" };
const SOLO_ROLES: Role[] = ["safe", "crowd_pleaser", "wild_card"];

const HEALTHY_DISCOVER = {
  1: [
    makeDiscoverMovie({ id: 1, genre_ids: [28, 12], vote_average: 8, vote_count: 1000, popularity: 100 }),
    makeDiscoverMovie({ id: 2, genre_ids: [28], vote_average: 7, vote_count: 500, popularity: 80 }),
  ],
  2: [
    makeDiscoverMovie({ id: 3, genre_ids: [35], vote_average: 6, vote_count: 300, popularity: 50 }),
    makeDiscoverMovie({ id: 4, genre_ids: [18], vote_average: 5, vote_count: 200, popularity: 40 }),
  ],
  3: [makeDiscoverMovie({ id: 5, genre_ids: [27], vote_average: 4, vote_count: 150, popularity: 30 })],
};

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recommendRun degradation — OpenRouter unconfigured (Risk #2b, config state)", () => {
  it("a note present but no AI key degrades to genre-only with three picks, no OpenRouter call", async () => {
    const { fetch, requests } = makeNetworkStub({ discover: HEALTHY_DISCOVER });
    vi.stubGlobal("fetch", fetch);
    const { client, insertedPickRows } = createFakeSupabase();

    const result = await recommendRun(client, USER, soloSession({ note: "anything goes" }), null);

    expect(result.ok).toBe(true);
    expect(insertedPickRows).toHaveLength(1);
    const rows = insertedPickRows[0];
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.tmdb_movie_id)).size).toBe(3);
    for (const row of rows) {
      expect(SOLO_ROLES).toContain(row.role as Role);
    }

    // The client was never built ⇒ no AI request, and no entity resolution.
    expect(requests.some((u) => u.includes("openrouter.ai"))).toBe(false);
    expect(requests.some((u) => u.includes("/search/"))).toBe(false);
  });
});
