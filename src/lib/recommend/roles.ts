import type { TmdbMovie } from "@/lib/tmdb-discover";
import { scoreCandidate, type Taste, type SessionPrefs, type CandidateScore } from "@/lib/recommend/scoring";

/**
 * Role labels (FR-009). Matches the DB CHECK on recommendation_picks.role.
 *
 * The middle pick branches on taste cardinality: a duo session compromises
 * (`compromise`), a solo session surfaces a broadly loved `crowd_pleaser`.
 * Safe and wild-card bookend both role sets.
 */
export type Role = "safe" | "compromise" | "wild_card" | "crowd_pleaser";

/** One role-labeled pick with the movie it landed on and the score that earned it. */
export interface Pick {
  role: Role;
  movie: TmdbMovie;
  score: number;
}

/** The (up to three) picks of one recommendation run. */
export interface RecommendationResult {
  picks: Pick[];
}

interface Scored {
  movie: TmdbMovie;
  score: CandidateScore;
}

/** Dedup candidates by TMDB id, preserving first-seen order. */
function dedupeById(candidates: TmdbMovie[]): TmdbMovie[] {
  const byId = new Map<number, TmdbMovie>();
  for (const movie of candidates) {
    if (!byId.has(movie.id)) {
      byId.set(movie.id, movie);
    }
  }
  return [...byId.values()];
}

/**
 * Element maximizing `key`. Ties are broken by `tieKey` (higher wins) when
 * provided. Returns `null` for an empty list.
 */
function argmax(items: Scored[], key: (s: Scored) => number, tieKey?: (s: Scored) => number): Scored | null {
  let best: Scored | null = null;
  let bestKey = -Infinity;
  let bestTie = -Infinity;
  for (const item of items) {
    const k = key(item);
    const t = tieKey ? tieKey(item) : 0;
    if (k > bestKey || (k === bestKey && t > bestTie)) {
      best = item;
      bestKey = k;
      bestTie = t;
    }
  }
  return best;
}

/** Jaccard overlap of two genre-id sets: |A∩B| / |A∪B| (0 when both empty). */
function jaccard(a: number[], b: number[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const value of setA) {
    if (setB.has(value)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Select three meaningfully distinct, role-labeled picks (US-01, FR-008/FR-009)
 * from one-or-two tastes:
 *
 * - **safe**       = argmax `combined`.
 * - **middle pick** branches on taste cardinality:
 *   - duo (2 tastes): **compromise** = argmax `balance` (best serves the
 *     worse-off taste). Preserved intact for S-03.
 *   - solo (1 taste): **crowd_pleaser** = argmax `crowd` (a broadly loved film —
 *     quality + popularity, guarded against the taste's excluded genres;
 *     tie-break toward `combined`). The solo role set is safe / crowd_pleaser /
 *     wild_card (FR-009).
 * - **wild card**  = argmax `combined` among remaining candidates whose `genre_ids`
 *   set is FULLY disjoint from the safe pick's (the robust "differs in genre"
 *   enforcement — TMDB genre_ids are categorical, not relevance-ranked, so a
 *   first-id comparison would be unsound). Ties break toward novelty (lower
 *   popularity). If no candidate is fully disjoint (thin/narrow-genre pool), fall
 *   back to the minimum-Jaccard-overlap candidate.
 *
 * All three picks have distinct movie ids. With fewer than 3 distinct candidates,
 * returns as many roles as can be filled (safe, then middle) — never fabricates.
 */
export function recommend(
  tastes: [Taste] | [Taste, Taste],
  session: SessionPrefs,
  candidates: TmdbMovie[],
): RecommendationResult {
  const pool = dedupeById(candidates);
  if (pool.length === 0) {
    return { picks: [] };
  }

  const maxPopularity = pool.reduce((max, c) => Math.max(max, c.popularity), 0);
  const scored: Scored[] = pool.map((movie) => ({
    movie,
    score: scoreCandidate(movie, tastes, session, maxPopularity),
  }));

  const picks: Pick[] = [];
  const usedIds = new Set<number>();

  // safe — best overall across all tastes.
  const safe = argmax(scored, (s) => s.score.combined);
  if (!safe) {
    return { picks: [] };
  }
  picks.push({ role: "safe", movie: safe.movie, score: safe.score.combined });
  usedIds.add(safe.movie.id);

  // middle pick — duo compromises (argmax balance); solo surfaces a crowd-pleaser
  // (argmax crowd, tie-break combined). Distinct from safe.
  const afterSafe = scored.filter((s) => !usedIds.has(s.movie.id));
  if (tastes.length === 2) {
    const compromise = argmax(afterSafe, (s) => s.score.balance);
    if (compromise) {
      picks.push({ role: "compromise", movie: compromise.movie, score: compromise.score.balance });
      usedIds.add(compromise.movie.id);
    }
  } else {
    const crowd = argmax(
      afterSafe,
      (s) => s.score.crowd,
      (s) => s.score.combined,
    );
    if (crowd) {
      picks.push({ role: "crowd_pleaser", movie: crowd.movie, score: crowd.score.crowd });
      usedIds.add(crowd.movie.id);
    }
  }

  // wild card — provably differs in genre from the safe pick.
  const afterCompromise = scored.filter((s) => !usedIds.has(s.movie.id));
  if (afterCompromise.length > 0) {
    const safeGenres = new Set(safe.movie.genre_ids);
    const disjoint = afterCompromise.filter((s) => s.movie.genre_ids.every((g) => !safeGenres.has(g)));

    let wild: Scored | null;
    if (disjoint.length > 0) {
      // Max combined; tie-break toward novelty (lower popularity → higher -popularity).
      wild = argmax(
        disjoint,
        (s) => s.score.combined,
        (s) => -s.movie.popularity,
      );
    } else {
      // Thin/narrow-genre pool: minimize genre overlap with safe (max negative Jaccard).
      wild = argmax(
        afterCompromise,
        (s) => -jaccard(s.movie.genre_ids, safe.movie.genre_ids),
        (s) => s.score.combined,
      );
    }
    if (wild) {
      picks.push({ role: "wild_card", movie: wild.movie, score: wild.score.combined });
      usedIds.add(wild.movie.id);
    }
  }

  return { picks };
}
