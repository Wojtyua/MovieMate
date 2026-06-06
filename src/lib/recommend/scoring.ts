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
  /** Per-viewer preferred-genre reward. */
  W_PREF: 2,
  /** Per-viewer excluded-genre penalty (strong, ~2× preferred). */
  W_EXCL: 4,
  /** Session preferred-genre reward. */
  W_SPREF: 2,
  /** Session excluded-genre penalty (strong, ~2× preferred). */
  W_SEXCL: 4,
  /** Mood-affinity reward. */
  W_MOOD: 2,
  /** Intensity-bias reward. */
  W_INT: 1,
  /** Quality (vote_average) reward. */
  W_QUALITY: 3,
  /** Pool-relative popularity reward (light). */
  W_POP: 1,
  /** Minimum vote count, applied at the discover query (keeps outliers out). */
  VOTE_COUNT_FLOOR: 100,
} as const;

/** A viewer's genre taste — matches the loaded `viewer_profiles` row shape. */
export interface Profile {
  preferred_genre_ids: number[];
  excluded_genre_ids: number[];
}

/** Session constraints — matches the loaded `movie_night_sessions` row shape. */
export interface SessionPrefs {
  mood: string | null;
  preferred_genre_ids: number[];
  excluded_genre_ids: number[];
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
 * Viewer affinity `A_v(c) = W_PREF·|G(c) ∩ pref| − W_EXCL·|G(c) ∩ excl|`.
 */
export function viewerAffinity(candidate: TmdbMovie, profile: Profile): number {
  const genres = candidate.genre_ids;
  return (
    WEIGHTS.W_PREF * overlap(genres, profile.preferred_genre_ids) -
    WEIGHTS.W_EXCL * overlap(genres, profile.excluded_genre_ids)
  );
}

/**
 * Session alignment
 * `S(c) = W_SPREF·|G∩s.pref| − W_SEXCL·|G∩s.excl| + W_MOOD·|G∩moodGenres| + W_INT·intensityBias`.
 */
export function sessionAlignment(candidate: TmdbMovie, session: SessionPrefs): number {
  const genres = candidate.genre_ids;
  return (
    WEIGHTS.W_SPREF * overlap(genres, session.preferred_genre_ids) -
    WEIGHTS.W_SEXCL * overlap(genres, session.excluded_genre_ids) +
    WEIGHTS.W_MOOD * overlap(genres, moodGenres(session.mood)) +
    WEIGHTS.W_INT * intensityBias(genres, session.intensity)
  );
}

/** The three ranking signals produced for one candidate. */
export interface CandidateScore {
  /** Safe ranking: both viewers + shared terms. */
  combined: number;
  /** Compromise ranking: serves the worse-off viewer best. */
  balance: number;
  /** Each viewer's standalone affinity, for inspection/debugging. */
  perViewer: [number, number];
}

/**
 * Score one candidate against both viewer profiles + the session.
 *
 * - `Q = vote_average/10`, `P = popularity / maxPopularity` (pool-relative).
 * - `shared = S(c) + W_QUALITY·Q + W_POP·P`.
 * - `combined = A_A + A_B + shared` (safe ranking).
 * - `balance = min(A_A + shared, A_B + shared)` (compromise: rewards the film
 *   that best serves the worse-off viewer — structurally distinct from combined).
 */
export function scoreCandidate(
  candidate: TmdbMovie,
  profiles: [Profile, Profile],
  session: SessionPrefs,
  maxPopularity: number,
): CandidateScore {
  const affinityA = viewerAffinity(candidate, profiles[0]);
  const affinityB = viewerAffinity(candidate, profiles[1]);

  const quality = candidate.vote_average / 10;
  const popularity = maxPopularity > 0 ? candidate.popularity / maxPopularity : 0;
  const shared = sessionAlignment(candidate, session) + WEIGHTS.W_QUALITY * quality + WEIGHTS.W_POP * popularity;

  const combined = affinityA + affinityB + shared;
  const balance = Math.min(affinityA + shared, affinityB + shared);

  return { combined, balance, perViewer: [affinityA, affinityB] };
}
