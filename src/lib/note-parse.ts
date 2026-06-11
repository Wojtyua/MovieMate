import type { AiClient } from "@/lib/ai";
import { MOVIE_GENRES, genreIdByName } from "@/lib/genres";

/** Resolved-locally genre ids plus people/keyword strings the resolver consumes. */
export interface ParsedNote {
  genreIds: number[];
  people: string[];
  keywords: string[];
}

/** Bound prompt cost / abuse; the note has no UI length cap. */
const MAX_NOTE_CHARS = 500;

/** Entity caps protect the workerd subrequest budget and limit over-narrowing. */
const MAX_GENRE_IDS = 3;
const MAX_PEOPLE = 2;
const MAX_KEYWORDS = 3;

const ALLOWED_GENRE_NAMES = MOVIE_GENRES.map((g) => g.name);

const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["genres", "people", "keywords"],
  properties: {
    genres: { type: "array", items: { type: "string" } },
    people: { type: "array", items: { type: "string" } },
    keywords: { type: "array", items: { type: "string" } },
  },
};

interface NoteExtraction {
  genres: string[];
  people: string[];
  keywords: string[];
}

const EMPTY: ParsedNote = { genreIds: [], people: [], keywords: [] };

/**
 * Turn a raw free-text note into resolved-locally genre ids plus people/keyword
 * strings for downstream TMDB resolution. Truncates the note, prompts the model
 * for strict structured extraction (genres drawn from the canonical 19 names),
 * maps genre strings → ids locally, and caps each entity list.
 *
 * Fails soft to an empty result on an empty note, an AI timeout/error, or any
 * unparseable output — never throws — so the caller's guard stays trivial and
 * the pipeline degrades to genre-only retrieval.
 */
export async function parseNote(ai: AiClient, note: string): Promise<ParsedNote> {
  const trimmed = note.trim().slice(0, MAX_NOTE_CHARS);
  if (!trimmed) {
    return EMPTY;
  }

  const messages = [
    {
      role: "system",
      content:
        "You extract movie-search parameters from a viewer's free-text note. " +
        "Return genres, people (actors or directors named in the note), and " +
        "keywords (themes/topics). Genres MUST be chosen only from this exact " +
        `list, copied verbatim: ${ALLOWED_GENRE_NAMES.join(", ")}. Use an empty ` +
        "array for any field the note does not mention. Do not invent entries.",
    },
    { role: "user", content: trimmed },
  ];

  const result = await ai.extract<NoteExtraction>(messages, EXTRACTION_SCHEMA, { timeoutMs: 2500 });
  if (!result) {
    return EMPTY;
  }

  // `extract` casts the parsed JSON with `as T` and does not validate shape, and
  // an `AI_MODEL` override could point at a model that ignores strict mode — so
  // coerce defensively to string arrays here. This keeps the never-throws
  // contract structural (a malformed response yields EMPTY, never a TypeError).
  const genres = asStringArray(result.genres);
  const people = asStringArray(result.people);
  const keywords = asStringArray(result.keywords);

  const genreIds = dedupe(
    genres.map((name) => genreIdByName(name)).filter((id): id is number => id !== undefined),
  ).slice(0, MAX_GENRE_IDS);

  return {
    genreIds,
    people: people.slice(0, MAX_PEOPLE),
    keywords: keywords.slice(0, MAX_KEYWORDS),
  };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}
