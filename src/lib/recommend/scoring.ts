import type { Intensity } from "@/lib/session-options";
import type { TmdbMovie } from "@/lib/tmdb-discover";
import { moodGenres, intensityBias } from "@/lib/recommend/affinity";

/**
 * Deterministic per-candidate scoring (FR-007) — the load-bearing piece S-03
 * depends on. Pure integer/float set math over `genre_ids`; no I/O, no env.
 *
 * Weights live in one tunable block. Excluded-genre weights are deliberately
 * ~2× the preferred weights (FR-006: excluded genres are a STRONG penalty, not
 * a hard query filter).
 */
export const WEIGHTS = {
  /** Per-taste preferred-genre reward. */
  W_PREF: 2,
  /** Per-taste excluded-genre penalty (strong, ~2× preferred). */
  W_EXCL: 4,
  /** Mood-affinity reward. */
  W_MOOD: 2,
  /** Intensity-bias reward. */
  W_INT: 1,
  /** Quality (vote_average) reward. */
  W_QUALITY: 3,
  /** Pool-relative popularity reward (light). */
  W_POP: 1,
  /** Crowd-pleaser popularity reward (heavier than W_POP — popularity is the
   *  point of the solo middle role). */
  W_CROWD: 3,
  /** Minimum vote count, applied at the discover query (keeps outliers out). */
  VOTE_COUNT_FLOOR: 100,
} as const;

/** One genre taste — matches the loaded `viewer_profiles` / session row shape. */
export interface Taste {
  preferred_genre_ids: number[];
  excluded_genre_ids: number[];
}

/** Session constraints — matches the loaded `movie_night_sessions` row shape.
 *  Genre fields are NOT here: tonight's session genres are a {@link Taste}, not
 *  a parallel scoring block (frame D2 — no double-scoring). */
export interface SessionPrefs {
  mood: string | null;
  intensity: Intensity;
}

/** Count of elements `a` and `b` share (treated as sets). */
function overlap(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) {
    return 0;
  }
  const set = new Set(a);
  let count = 0;
  for (const value of b) {
    if (set.has(value)) {
      count++;
    }
  }
  return count;
}

/**
 * Taste affinity `A_t(c) = W_PREF·|G(c) ∩ pref| − W_EXCL·|G(c) ∩ excl|`.
 */
export function tasteAffinity(candidate: TmdbMovie, taste: Taste): number {
  const genres = candidate.genre_ids;
  return (
    WEIGHTS.W_PREF * overlap(genres, taste.preferred_genre_ids) -
    WEIGHTS.W_EXCL * overlap(genres, taste.excluded_genre_ids)
  );
}

/**
 * Session alignment (genre-free): `S(c) = W_MOOD·|G∩moodGenres| + W_INT·intensityBias`.
 * Genre taste lives in {@link Taste}, not here (frame D2 — no double-scoring).
 */
export function sessionAlignment(candidate: TmdbMovie, session: SessionPrefs): number {
  const genres = candidate.genre_ids;
  return (
    WEIGHTS.W_MOOD * overlap(genres, moodGenres(session.mood)) +
    WEIGHTS.W_INT * intensityBias(genres, session.intensity)
  );
}

/** The ranking signals produced for one candidate. */
export interface CandidateScore {
  /** Safe ranking: every taste's affinity + shared terms. */
  combined: number;
  /** Compromise ranking: serves the worst-off taste best (= combined when solo). */
  balance: number;
  /** Crowd-pleaser ranking (solo middle role): quality + popularity − excluded overlap. */
  crowd: number;
  /** Each taste's standalone affinity, for inspection/debugging. */
  perTaste: number[];
}

/**
 * Score one candidate against one-or-two tastes + the session.
 *
 * - `Q = vote_average/10`, `P = popularity / maxPopularity` (pool-relative).
 * - `shared = S(c) + W_QUALITY·Q + W_POP·P`.
 * - `combined = Σ A_t + shared` (safe ranking).
 * - `balance = min_t(A_t + shared)` (compromise: rewards the film that best
 *   serves the worst-off taste — for one taste, `balance === combined`).
 * - `crowd = W_QUALITY·Q + W_CROWD·P − W_EXCL·|G(c) ∩ excluded(all tastes)|`
 *   (crowd-pleaser: a broadly loved film, guarded against avoided genres).
 */
export function scoreCandidate(
  candidate: TmdbMovie,
  tastes: [Taste] | [Taste, Taste],
  session: SessionPrefs,
  maxPopularity: number,
): CandidateScore {
  const perTaste = tastes.map((taste) => tasteAffinity(candidate, taste));

  const quality = candidate.vote_average / 10;
  const popularity = maxPopularity > 0 ? candidate.popularity / maxPopularity : 0;
  const shared = sessionAlignment(candidate, session) + WEIGHTS.W_QUALITY * quality + WEIGHTS.W_POP * popularity;

  const combined = perTaste.reduce((sum, a) => sum + a, 0) + shared;
  const balance = Math.min(...perTaste.map((a) => a + shared));

  // Crowd-pleaser: reward quality + popularity, but subtract the excluded-genre
  // penalty across all present tastes so an avoided genre can't win this slot.
  const excludedOverlap = tastes.reduce(
    (count, taste) => count + overlap(candidate.genre_ids, taste.excluded_genre_ids),
    0,
  );
  const crowd = WEIGHTS.W_QUALITY * quality + WEIGHTS.W_CROWD * popularity - WEIGHTS.W_EXCL * excludedOverlap;

  return { combined, balance, crowd, perTaste };
}
