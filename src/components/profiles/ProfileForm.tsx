import { useState } from "react";
import { Sparkles, CheckCircle2 } from "lucide-react";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { MOVIE_GENRES } from "@/lib/genres";
import { cn } from "@/lib/utils";

interface Props {
  preferredGenreIds?: number[];
  excludedGenreIds?: number[];
  serverError?: string | null;
  justSaved?: boolean;
}

export default function ProfileForm({
  preferredGenreIds = [],
  excludedGenreIds = [],
  serverError,
  justSaved = false,
}: Props) {
  const [preferred, setPreferred] = useState<Set<number>>(new Set(preferredGenreIds));
  const [excluded, setExcluded] = useState<Set<number>>(new Set(excludedGenreIds));

  // Genres are mutually exclusive between preferred and avoid: selecting one
  // side clears the other so the submitted sets stay disjoint (the API rejects
  // overlap, but keeping the UI honest avoids a pointless round-trip).
  function toggle(kind: "preferred" | "excluded", id: number) {
    if (kind === "preferred") {
      setPreferred((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setExcluded((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else {
      setExcluded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setPreferred((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  return (
    <form method="POST" action="/api/profiles" className="space-y-4" noValidate>
      <h2 className="text-lg font-semibold text-white">Remembered taste core</h2>

      <GenrePicker label="Preferred genres" kind="preferred" selected={preferred} onToggle={toggle} />
      <GenrePicker label="Avoid genres" kind="excluded" selected={excluded} onToggle={toggle} />

      {/* Hidden fields carry the selected ids as repeated form entries, matching
          formData.getAll() on the server. */}
      {[...preferred].map((id) => (
        <input key={`p-${id}`} type="hidden" name="preferred_genre_ids" value={id} />
      ))}
      {[...excluded].map((id) => (
        <input key={`e-${id}`} type="hidden" name="excluded_genre_ids" value={id} />
      ))}

      <ServerError message={serverError} />

      {justSaved && !serverError ? (
        <p className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-900/30 px-3 py-2 text-sm text-green-300">
          <CheckCircle2 className="size-4 shrink-0" />
          Taste core saved.
        </p>
      ) : null}

      <SubmitButton pendingText="Saving..." icon={<Sparkles className="size-4" />}>
        Save taste core
      </SubmitButton>
    </form>
  );
}

interface GenrePickerProps {
  label: string;
  kind: "preferred" | "excluded";
  selected: Set<number>;
  onToggle: (kind: "preferred" | "excluded", id: number) => void;
}

function GenrePicker({ label, kind, selected, onToggle }: GenrePickerProps) {
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
