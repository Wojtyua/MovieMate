import React from "react";
import { MOVIE_GENRES } from "@/lib/genres";
import { cn } from "@/lib/utils";

interface GenrePickerProps {
  label: string;
  kind: "preferred" | "excluded";
  selected: Set<number>;
  onToggle: (kind: "preferred" | "excluded", id: number) => void;
}

export function GenrePicker({ label, kind, selected, onToggle }: GenrePickerProps) {
  const activeClass =
    kind === "preferred"
      ? "border-purple-400 bg-purple-500/30 text-white"
      : "border-red-400/60 bg-red-500/20 text-red-100";

  return (
    <div>
      <span className="mb-1 block text-sm text-blue-100/80">{label}</span>
      <div className="flex flex-wrap gap-2">
        {MOVIE_GENRES.map((genre) => {
          const active = selected.has(genre.id);
          return (
            <button
              key={genre.id}
              type="button"
              aria-pressed={active}
              onClick={() => {
                onToggle(kind, genre.id);
              }}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                active ? activeClass : "border-white/20 bg-white/5 text-blue-100/70 hover:bg-white/10",
              )}
            >
              {genre.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
