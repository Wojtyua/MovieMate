import { describe, expect, it } from "vitest";
import { moodGenres } from "@/lib/recommend/affinity";

// Phase 1 harness smoke test: proves the Vitest runner, the `@/*` alias, and TS
// resolution all work before the real R1/R5 suites land. It imports a pure
// helper through the alias and checks a deterministic table lookup. Phase 2
// expands the pure-layer coverage in roles.test.ts.
describe("affinity (harness smoke test)", () => {
  it("resolves the `@/*` alias and reads a known mood->genre mapping", () => {
    expect(moodGenres("funny")).toEqual([35]);
  });

  it("returns an empty list for a null mood", () => {
    expect(moodGenres(null)).toEqual([]);
  });
});
