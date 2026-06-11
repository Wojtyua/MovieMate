/**
 * Canonical TMDB movie-genre list (id ↔ name).
 *
 * Stored statically rather than fetched from TMDB at runtime: the list is small
 * and stable, and keeping it local means /profiles never depends on TMDB
 * availability or spends a workerd subrequest. IDs MUST match TMDB's official
 * movie genre IDs so S-03's discover query (FR-005) needs no translation.
 *
 * Source: TMDB GET /genre/movie/list (movie genres).
 */
export interface MovieGenre {
  id: number;
  name: string;
}

export const MOVIE_GENRES: readonly MovieGenre[] = [
  { id: 28, name: "Action" },
  { id: 12, name: "Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 14, name: "Fantasy" },
  { id: 36, name: "History" },
  { id: 27, name: "Horror" },
  { id: 10402, name: "Music" },
  { id: 9648, name: "Mystery" },
  { id: 10749, name: "Romance" },
  { id: 878, name: "Science Fiction" },
  { id: 10770, name: "TV Movie" },
  { id: 53, name: "Thriller" },
  { id: 10752, name: "War" },
  { id: 37, name: "Western" },
];

const GENRE_IDS = new Set(MOVIE_GENRES.map((g) => g.id));

/** True when `id` is one of TMDB's known movie genre IDs. */
export function isKnownGenreId(id: number): boolean {
  return GENRE_IDS.has(id);
}

const GENRE_ID_BY_NAME = new Map(MOVIE_GENRES.map((g) => [g.name.toLowerCase(), g.id]));

/**
 * Case-insensitive exact-match lookup of a genre name → its TMDB id, for mapping
 * AI-emitted genre strings to the canonical 19. Returns `undefined` on no match
 * (caller drops unmatched strings). No synonym/alias table by design — the note
 * extractor prompts the model with the exact allowed names.
 */
export function genreIdByName(name: string): number | undefined {
  return GENRE_ID_BY_NAME.get(name.trim().toLowerCase());
}
