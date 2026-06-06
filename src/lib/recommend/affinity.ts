import type { Intensity } from "@/lib/session-options";

/**
 * Static maps translating a session's mood + intensity into TMDB-genre
 * affinities — the deterministic stand-in for semantic matching (FR-007). TMDB
 * discover has no mood/intensity parameter, so these signals are consumed here,
 * in the scoring step, not in the candidate query.
 *
 * Genre ids are TMDB's (see src/lib/genres.ts). Keep these in sync with the
 * MOODS / INTENSITIES vocabularies in src/lib/session-options.ts.
 */

/** Each mood maps to the TMDB genres that best express it. */
export const MOOD_GENRE_AFFINITY: Record<string, number[]> = {
  light: [35, 10751, 16, 12],
  funny: [35],
  tense: [53, 9648, 80],
  thrilling: [28, 53, 12],
  emotional: [18, 10749],
  "thought-provoking": [18, 99, 878, 9648],
  cozy: [10751, 35, 10749],
  dark: [27, 80, 53, 18],
  epic: [12, 10752, 36, 14],
  romantic: [10749],
};

/** Genres each intensity level favors / disfavors. `medium` is neutral. */
export const INTENSITY_GENRE_BIAS: Record<Intensity, { favor: number[]; disfavor: number[] }> = {
  // High intensity: leans into action/thriller/horror/war/crime, away from gentle genres.
  high: {
    favor: [28, 53, 27, 10752, 80],
    disfavor: [10751, 99, 10749],
  },
  // Medium: no bias either way.
  medium: {
    favor: [],
    disfavor: [],
  },
  // Low intensity: leans into family/comedy/romance/documentary, away from intense genres.
  low: {
    favor: [10751, 35, 10749, 99],
    disfavor: [28, 53, 27, 10752],
  },
};

/** Count of elements `a` and `b` share (treated as sets). */
function intersectionCount(a: number[], b: number[]): number {
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

/** TMDB genres associated with a session mood; `[]` for null/unknown moods. */
export function moodGenres(mood: string | null): number[] {
  if (!mood) {
    return [];
  }
  return MOOD_GENRE_AFFINITY[mood] ?? [];
}

/**
 * Net intensity bias for a candidate's genres: (# favored genres present) −
 * (# disfavored genres present). `medium` always returns 0.
 */
export function intensityBias(genreIds: number[], intensity: Intensity): number {
  const bias = INTENSITY_GENRE_BIAS[intensity];
  return intersectionCount(genreIds, bias.favor) - intersectionCount(genreIds, bias.disfavor);
}
