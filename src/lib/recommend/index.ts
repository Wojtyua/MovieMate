/**
 * Pure scoring + role/diversity engine for S-03 scored recommendations.
 *
 * Side-effect-free: inputs (two profiles, session prefs, TMDB candidates) in,
 * up to three role-labeled picks out. No I/O, no env, no TMDB/Supabase — the
 * API endpoint (src/pages/api/recommendations.ts) is the only place that
 * composes this with retrieval + persistence.
 */
export { recommend, type Role, type Pick, type RecommendationResult } from "@/lib/recommend/roles";
export { WEIGHTS, type Profile, type SessionPrefs } from "@/lib/recommend/scoring";
export { MOOD_GENRE_AFFINITY, INTENSITY_GENRE_BIAS, moodGenres, intensityBias } from "@/lib/recommend/affinity";
