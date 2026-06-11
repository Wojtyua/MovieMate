import { useState } from "react";
import { Check, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MOVIE_GENRES } from "@/lib/genres";
import type { Role } from "@/lib/recommend";

export interface Pick {
  role: Role;
  tmdb_movie_id: number;
  title: string;
  poster_path: string | null;
  overview: string | null;
  genre_ids: number[];
  release_date: string | null;
  vote_average: number | null;
}

interface Props {
  picks: Pick[];
}

// Display order: safe → middle (compromise | crowd_pleaser) → wild_card. The
// middle slot shares rank 1 across both taxonomies — duo compromises, solo
// crowd-pleases. (Mirrors the server-side sort this island replaces.)
const ROLE_RANK: Record<Role, number> = { safe: 0, compromise: 1, crowd_pleaser: 1, wild_card: 2 };
const ROLE_LABEL: Record<Role, string> = {
  safe: "Safe pick",
  compromise: "Compromise",
  crowd_pleaser: "Crowd-pleaser",
  wild_card: "Wild card",
};
const GENRE_NAMES = new Map(MOVIE_GENRES.map((g) => [g.id, g.name]));
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";

const releaseYear = (date: string | null) => (date && date.length >= 4 ? date.slice(0, 4) : null);
const genreNames = (ids: number[]) =>
  ids.map((gid) => GENRE_NAMES.get(gid)).filter((name): name is string => Boolean(name));

/**
 * The picks grid as an interactive island (S-05). "Mark watched" closes the
 * decision: it POSTs the TMDB id to /api/watched (the account dedup set,
 * FR-011/FR-012), then highlights the chosen card and dims the others. Marking
 * is one-way (no unwatch); the most recent mark owns the highlight. This is the
 * repo's first fetch-from-React mutation — kept deliberately minimal.
 */
export default function PicksGrid({ picks }: Props) {
  const sorted = [...picks].sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role]);
  const [markedId, setMarkedId] = useState<number | null>(null);
  const [pendingId, setPendingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function markWatched(tmdbMovieId: number) {
    setPendingId(tmdbMovieId);
    setError(null);
    try {
      const res = await fetch("/api/watched", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdb_movie_id: tmdbMovieId }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (res.ok && data?.ok) {
        setMarkedId(tmdbMovieId);
      } else {
        setError("Couldn't mark this as watched — please try again.");
      }
    } catch {
      setError("Couldn't reach the server — please try again.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <>
      {error ? (
        <p className="mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">{error}</p>
      ) : null}
      <div className="grid gap-6 md:grid-cols-3">
        {sorted.map((pick) => {
          const isMarked = markedId === pick.tmdb_movie_id;
          const isDimmed = markedId !== null && !isMarked;
          const isPending = pendingId === pick.tmdb_movie_id;
          return (
            <article
              key={pick.tmdb_movie_id}
              className={`flex flex-col overflow-hidden rounded-2xl border bg-white/10 text-white backdrop-blur-xl transition-all ${
                isMarked ? "border-purple-400 ring-2 ring-purple-400/60" : "border-white/10"
              } ${isDimmed ? "opacity-50" : "opacity-100"}`}
            >
              <div className="flex items-center justify-between px-5 pt-5">
                <span className="rounded-full border border-purple-300/40 bg-purple-300/10 px-3 py-1 text-xs font-semibold tracking-wide text-purple-200 uppercase">
                  {ROLE_LABEL[pick.role]}
                </span>
                {pick.vote_average != null && pick.vote_average > 0 ? (
                  <span className="text-sm text-blue-100/70">★ {pick.vote_average.toFixed(1)}</span>
                ) : null}
              </div>
              <div className="px-5 py-4">
                {pick.poster_path ? (
                  <img
                    src={`${POSTER_BASE}${pick.poster_path}`}
                    alt={`Poster for ${pick.title}`}
                    width="500"
                    height="750"
                    loading="lazy"
                    className="aspect-[2/3] w-full rounded-xl object-cover"
                  />
                ) : (
                  <div className="flex aspect-[2/3] w-full items-center justify-center rounded-xl border border-white/10 bg-white/5 text-sm text-blue-100/40">
                    No poster
                  </div>
                )}
              </div>
              <div className="mt-auto px-5 pb-5">
                <h2 className="text-lg font-semibold">
                  {pick.title}
                  {releaseYear(pick.release_date) ? (
                    <span className="font-normal text-blue-100/60"> ({releaseYear(pick.release_date)})</span>
                  ) : null}
                </h2>
                {genreNames(pick.genre_ids).length > 0 ? (
                  <p className="mt-1 text-sm text-blue-100/60">{genreNames(pick.genre_ids).join(" · ")}</p>
                ) : null}
                <Button
                  type="button"
                  disabled={isMarked || isPending}
                  onClick={() => {
                    void markWatched(pick.tmdb_movie_id);
                  }}
                  className={`mt-4 w-full rounded-lg px-4 py-2 font-medium text-white transition-colors ${
                    isMarked ? "bg-purple-700/60" : "bg-purple-600 hover:bg-purple-500"
                  }`}
                >
                  {isMarked ? (
                    <span className="flex items-center gap-2">
                      <Check className="size-4" /> Watched
                    </span>
                  ) : isPending ? (
                    <span className="flex items-center gap-2">
                      <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Marking…
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <Eye className="size-4" /> Mark watched
                    </span>
                  )}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
