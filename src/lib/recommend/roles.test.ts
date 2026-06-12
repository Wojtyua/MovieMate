import { describe, expect, it } from "vitest";
import { recommend, type Pick, type Role } from "@/lib/recommend/roles";
import type { SessionPrefs, Taste } from "@/lib/recommend/scoring";
import {
  ACTION,
  ADVENTURE,
  COMEDY,
  duplicateIdPool,
  healthyPool,
  narrowGenrePool,
  oneFilmPool,
  twoFilmPool,
} from "@/lib/recommend/__fixtures__/movies";

/**
 * Pure-layer shape contract for `recommend()` (test-plan §3 Phase 1):
 * R5 (malformed pick set on the solo↔duo branch) + the shape-half of R1
 * (a healthy pool must not be drained below three by dedup/role logic).
 *
 * Oracle source: PRD/research, never roles.ts. Roles and disjointness are the
 * assertions; exact `pick.score` floats are deliberately never asserted
 * (test-plan §7) — each pool is ordered so the intended winner is forced.
 */

// Single taste (solo) and two tastes (duo). Genre-free session: mood null +
// medium intensity zero the session-alignment term so a pool's ordering alone
// decides the winners.
const SOLO: [Taste] = [{ preferred_genre_ids: [ACTION], excluded_genre_ids: [] }];
const DUO: [Taste, Taste] = [
  { preferred_genre_ids: [ACTION], excluded_genre_ids: [] },
  { preferred_genre_ids: [COMEDY], excluded_genre_ids: [] },
];
const SESSION: SessionPrefs = { mood: null, intensity: "medium" };

interface Cardinality {
  name: string;
  tastes: [Taste] | [Taste, Taste];
  /** Role the middle pick must carry for this cardinality (FR-009). */
  middleRole: Role;
  /** The full role vocabulary this cardinality is allowed to emit. */
  allowed: Role[];
}

const CARDINALITIES: Cardinality[] = [
  { name: "solo", tastes: SOLO, middleRole: "crowd_pleaser", allowed: ["safe", "crowd_pleaser", "wild_card"] },
  { name: "duo", tastes: DUO, middleRole: "compromise", allowed: ["safe", "compromise", "wild_card"] },
];

const pickFor = (picks: Pick[], role: Role): Pick | undefined => picks.find((p) => p.role === role);

const requirePick = (picks: Pick[], role: Role): Pick => {
  const pick = pickFor(picks, role);
  if (!pick) {
    throw new Error(`expected a ${role} pick, got roles: ${picks.map((p) => p.role).join(", ")}`);
  }
  return pick;
};

describe("recommend() — shape invariants (parameterized over solo/duo)", () => {
  it.each(CARDINALITIES)("$name: a healthy ≥3 pool yields at most three picks", ({ tastes }) => {
    const { picks } = recommend(tastes, SESSION, healthyPool());
    expect(picks.length).toBeLessThanOrEqual(3);
  });

  it.each(CARDINALITIES)("$name: all picks have distinct movie ids", ({ tastes }) => {
    const { picks } = recommend(tastes, SESSION, healthyPool());
    const ids = picks.map((p) => p.movie.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(CARDINALITIES)("$name: every role is drawn from the cardinality's vocabulary", ({ tastes, allowed }) => {
    const { picks } = recommend(tastes, SESSION, healthyPool());
    for (const pick of picks) {
      expect(allowed).toContain(pick.role);
    }
  });

  it.each(CARDINALITIES)("$name: the wild card's genres are disjoint from the safe pick's", ({ tastes }) => {
    const { picks } = recommend(tastes, SESSION, healthyPool());
    const safe = requirePick(picks, "safe");
    const wild = requirePick(picks, "wild_card");
    const safeGenres = new Set(safe.movie.genre_ids);
    expect(wild.movie.genre_ids.some((g) => safeGenres.has(g))).toBe(false);
  });
});

describe("recommend() — role-by-cardinality (R5)", () => {
  it("a solo run never emits a `compromise` pick", () => {
    const { picks } = recommend(SOLO, SESSION, healthyPool());
    expect(picks.map((p) => p.role)).not.toContain("compromise");
  });

  it("the SAME pool yields a `crowd_pleaser` middle for solo but a `compromise` middle for duo", () => {
    const solo = recommend(SOLO, SESSION, healthyPool()).picks;
    const duo = recommend(DUO, SESSION, healthyPool()).picks;
    // The non-safe, non-wild middle slot is the only role that switches on
    // cardinality (FR-009): solo = crowd_pleaser, duo = compromise.
    expect(pickFor(solo, "crowd_pleaser")).toBeDefined();
    expect(pickFor(solo, "compromise")).toBeUndefined();
    expect(pickFor(duo, "compromise")).toBeDefined();
    expect(pickFor(duo, "crowd_pleaser")).toBeUndefined();
  });

  it.each(CARDINALITIES)("$name: the middle pick carries the `$middleRole` role", ({ tastes, middleRole }) => {
    const { picks } = recommend(tastes, SESSION, healthyPool());
    expect(pickFor(picks, middleRole)).toBeDefined();
  });
});

describe("recommend() — wild-card genre rule", () => {
  it("prefers a fully genre-disjoint candidate when one exists", () => {
    // healthyPool's id 3 ([COMEDY]) is disjoint from safe's [ACTION, ADVENTURE].
    const { picks } = recommend(SOLO, SESSION, healthyPool());
    const wild = pickFor(picks, "wild_card");
    expect(wild?.movie.id).toBe(3);
  });

  it("falls back to the minimum-Jaccard-overlap candidate when none is fully disjoint", () => {
    // No candidate is disjoint from the id-1 safe pick (all share ACTION). The
    // wild card must still exist and be the lower-overlap id 3 (1/3) over the
    // higher-overlap id 4 (2/3) — a third pick is never abandoned for narrowness.
    const { picks } = recommend(SOLO, SESSION, narrowGenrePool());
    expect(picks).toHaveLength(3);
    const safe = requirePick(picks, "safe");
    const wild = requirePick(picks, "wild_card");
    expect(wild.movie.id).toBe(3);
    expect(wild.movie.id).not.toBe(safe.movie.id);
  });
});

describe("recommend() — min(N,3) supply boundary (no fabrication)", () => {
  // These assert the PURE layer never manufactures a third pick from a thin
  // pool. This is the shape contract documenting *no fabrication* — NOT a
  // tolerated sub-three defect. The retrieval ladder (Phase 3) is what widens a
  // pool toward ≥3; below three even at the genre-only baseline is the genuine
  // "thin universe" face of R1, not a drain to guard against here.
  it("a 2-film pool yields exactly two picks (safe + middle), no wild card", () => {
    const { picks } = recommend(SOLO, SESSION, twoFilmPool());
    expect(picks).toHaveLength(2);
    expect(pickFor(picks, "safe")).toBeDefined();
    expect(pickFor(picks, "wild_card")).toBeUndefined();
  });

  it("a 1-film pool yields exactly one pick (safe only)", () => {
    const { picks } = recommend(SOLO, SESSION, oneFilmPool());
    expect(picks).toHaveLength(1);
    expect(picks[0].role).toBe("safe");
  });

  it("an empty pool yields no picks", () => {
    expect(recommend(SOLO, SESSION, [])).toEqual({ picks: [] });
  });
});

describe("recommend() — dedup by id before role assignment", () => {
  it("collapses duplicate ids (keeping first-seen) so they cannot become two picks", () => {
    // duplicateIdPool has id 1 twice (first [ACTION, ADVENTURE], then [COMEDY])
    // plus id 2 → 2 distinct films, so 2 picks, not 3.
    const { picks } = recommend(SOLO, SESSION, duplicateIdPool());
    const ids = picks.map((p) => p.movie.id);
    expect(picks).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
    // The surviving id-1 pick is the first-seen entry, not the [COMEDY] dup.
    const safe = pickFor(picks, "safe");
    expect(safe?.movie.id).toBe(1);
    expect(safe?.movie.genre_ids).toEqual([ACTION, ADVENTURE]);
  });
});
