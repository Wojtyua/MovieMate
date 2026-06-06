/**
 * Canonical vocabularies for movie-night session preferences (S-02).
 *
 * Stored statically rather than fetched at runtime: the lists are small and
 * stable, and keeping them local means /sessions never depends on any external
 * call. These are local-scoring signals (FR-007), NOT TMDB hard filters — TMDB
 * discover has no mood/intensity parameter, so S-03 consumes these in the
 * scoring step, not the candidate query.
 *
 * `mood` ids are the values stored in the `movie_night_sessions.mood` text
 * column and are validated here rather than by a DB enum, so the vocabulary can
 * grow without a migration. `intensity` ids MUST match the DB CHECK
 * (`intensity in ('low','medium','high')`) in the movie_night_sessions migration.
 */
export interface SessionOption<Id extends string = string> {
  id: Id;
  label: string;
}

export const MOODS: readonly SessionOption[] = [
  { id: "light", label: "Light" },
  { id: "funny", label: "Funny" },
  { id: "tense", label: "Tense" },
  { id: "thrilling", label: "Thrilling" },
  { id: "emotional", label: "Emotional" },
  { id: "thought-provoking", label: "Thought-provoking" },
  { id: "cozy", label: "Cozy" },
  { id: "dark", label: "Dark" },
  { id: "epic", label: "Epic" },
  { id: "romantic", label: "Romantic" },
];

export type Intensity = "low" | "medium" | "high";

export const INTENSITIES: readonly SessionOption<Intensity>[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

/** Default intensity — mirrors the `movie_night_sessions.intensity` column default. */
export const DEFAULT_INTENSITY: Intensity = "medium";

const MOOD_IDS = new Set(MOODS.map((m) => m.id));
const INTENSITY_IDS = new Set(INTENSITIES.map((i) => i.id));

/** True when `id` is one of the known session moods. */
export function isKnownMood(id: string): boolean {
  return MOOD_IDS.has(id);
}

/** True when `id` is one of the known intensities (low/medium/high). */
export function isKnownIntensity(id: string): id is Intensity {
  return INTENSITY_IDS.has(id);
}
