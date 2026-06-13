import { afterEach, describe, expect, it, vi } from "vitest";

// File-scoped env shim with a TRUTHY OpenRouter key so the AI path actually
// fires (note present + key present + the openrouter fetch resolving). The shim
// is a hoisted, static object — the key cannot be varied within one file — so
// the config-state half (key empty → client never built) lives in the sibling
// `recommend-run.unconfigured.test.ts`. `ai.ts` reads OPENROUTER_API_KEY/AI_MODEL
// at module load, so both are exported even though AI_MODEL is unused here.
vi.mock("astro:env/server", () => ({
  TMDB_READ_ACCESS_TOKEN: "test-token",
  OPENROUTER_API_KEY: "test-token",
  AI_MODEL: "",
}));

import { recommendRun, type RecommendRunSession } from "@/lib/recommend-run";
import type { Role } from "@/lib/recommend/roles";
import {
  createFakeSupabase,
  makeDiscoverMovie,
  makeNetworkStub,
  type EdgeFailure,
} from "@/lib/__fixtures__/recommend-run-doubles";

/**
 * Degradation suite for `recommendRun` at the external network edge (test-plan
 * §3 Phase 2 / Risk #2). Proves the TWO asymmetric outcomes the research oracle
 * fixed:
 * - **TMDB is the source** → its failure can only degrade to a clean
 *   `{ ok:false, "Could not reach TMDB, try again" }`, nothing persisted (no
 *   throw, no 500). "Still three picks" is physically impossible with no source.
 * - **OpenRouter is augmentation** → its failure degrades to genre-only
 *   retrieval and STILL returns three picks.
 *
 * The oracle is the PRD/research, not `recommend-run.ts`. We assert
 * count/role/distinct-id/query-shape — never `pick.score` (test-plan §7). The
 * genre-only RUNG is proven positively: on AI failure no `/search/` call fires
 * and the discover query carries `with_genres` but neither `with_cast` nor
 * `with_keywords`.
 */

const USER = { id: "user-1" };
const SOLO_ROLES: Role[] = ["safe", "crowd_pleaser", "wild_card"];

// A healthy ≥3 discover pool (mirrors the Phase 1 supply fixture) so the
// genre-only baseline can supply exactly three distinct, role-labeled picks.
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

/** Assert a result is the canonical three distinct, role-labeled picks. */
function expectThreeDistinctPicks(insertedPickRows: Record<string, unknown>[][]) {
  expect(insertedPickRows).toHaveLength(1);
  const rows = insertedPickRows[0];
  expect(rows).toHaveLength(3);
  const ids = rows.map((r) => r.tmdb_movie_id);
  expect(new Set(ids).size).toBe(3);
  for (const row of rows) {
    expect(SOLO_ROLES).toContain(row.role as Role);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recommendRun degradation — TMDB edge is the source (Risk #2a)", () => {
  // note:null ⇒ no AI; the only edge in play is TMDB discover.
  const TMDB_FAILURES: { name: string; failure: EdgeFailure }[] = [
    { name: "non-ok 503", failure: { kind: "non-ok", status: 503 } },
    { name: "throw (network error / abort / timeout)", failure: { kind: "throw" } },
    { name: "malformed JSON body", failure: { kind: "malformed" } },
  ];

  it.each(TMDB_FAILURES)(
    "a failing TMDB discover ($name) yields a clean ok:false and persists nothing",
    async ({ failure }) => {
      const { fetch } = makeNetworkStub({ discover: failure });
      vi.stubGlobal("fetch", fetch);
      const { client, insertedPickRows } = createFakeSupabase();

      const result = await recommendRun(client, USER, soloSession({ note: null }), null);

      // No throw, no 500 — a graceful error value at the library boundary.
      expect(result).toEqual({ ok: false, message: "Could not reach TMDB, try again" });
      expect(insertedPickRows).toHaveLength(0);
    },
  );
});

describe("recommendRun degradation — OpenRouter is augmentation (Risk #2b)", () => {
  it("a failing TMDB /search (AI supplied people) degrades to genre-only, still three picks", async () => {
    // AI succeeds and returns a person, so entity resolution runs — but /search
    // throws, so castIds stay empty and the ladder collapses to genre-only. The
    // source (discover) is healthy, so three picks still land.
    const { fetch, requests } = makeNetworkStub({
      discover: HEALTHY_DISCOVER,
      search: { kind: "throw" },
      openrouter: { genres: [], people: ["Some Actor"], keywords: [] },
    });
    vi.stubGlobal("fetch", fetch);
    const { client, insertedPickRows } = createFakeSupabase();

    const result = await recommendRun(client, USER, soloSession({ note: "thriller with Some Actor" }), null);

    expect(result.ok).toBe(true);
    expectThreeDistinctPicks(insertedPickRows);
    // Search failed ⇒ cast empty ⇒ no with_cast on any discover query.
    const discoverRequests = requests.filter((u) => u.includes("/discover/movie"));
    expect(discoverRequests.length).toBeGreaterThan(0);
    for (const u of discoverRequests) {
      expect(u).not.toContain("with_cast");
    }
  });

  // The full AI-edge failure matrix: every mode collapses to the genre-only rung.
  const AI_FAILURES: { name: string; failure: EdgeFailure }[] = [
    { name: "non-ok 500", failure: { kind: "non-ok", status: 500 } },
    { name: "throw (network error / abort / timeout)", failure: { kind: "throw" } },
    { name: "malformed JSON body", failure: { kind: "malformed" } },
  ];

  it.each(AI_FAILURES)(
    "a failing OpenRouter ($name) degrades to genre-only and still persists three picks",
    async ({ failure }) => {
      const { fetch, requests } = makeNetworkStub({
        discover: HEALTHY_DISCOVER,
        openrouter: failure,
      });
      vi.stubGlobal("fetch", fetch);
      const { client, insertedPickRows } = createFakeSupabase();

      const result = await recommendRun(client, USER, soloSession({ note: "something cosy" }), null);

      expect(result.ok).toBe(true);
      expectThreeDistinctPicks(insertedPickRows);

      // The AI path was ATTEMPTED (distinguishes degradation from "note was null").
      expect(requests.some((u) => u.includes("openrouter.ai"))).toBe(true);
      // ...then degraded: no entity resolution fired (AI yielded nothing).
      expect(requests.some((u) => u.includes("/search/"))).toBe(false);
      // ...and every discover query is the genre-only rung: with_genres, but
      // neither with_cast nor with_keywords.
      const discoverRequests = requests.filter((u) => u.includes("/discover/movie"));
      expect(discoverRequests.length).toBeGreaterThan(0);
      for (const u of discoverRequests) {
        expect(u).toContain("with_genres");
        expect(u).not.toContain("with_cast");
        expect(u).not.toContain("with_keywords");
      }
    },
  );
});
