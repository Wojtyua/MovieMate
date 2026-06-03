import React, { useState } from "react";
import { User, StickyNote, CheckCircle2 } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { MOVIE_GENRES } from "@/lib/genres";
import { cn } from "@/lib/utils";

interface Props {
  slot: 1 | 2;
  displayName?: string;
  preferredGenreIds?: number[];
  excludedGenreIds?: number[];
  note?: string;
  serverError?: string | null;
  justSaved?: boolean;
}

export default function ProfileForm({
  slot,
  displayName: initialName = "",
  preferredGenreIds = [],
  excludedGenreIds = [],
  note: initialNote = "",
  serverError,
  justSaved = false,
}: Props) {
  const [displayName, setDisplayName] = useState(initialName);
  const [note, setNote] = useState(initialNote);
  const [preferred, setPreferred] = useState<Set<number>>(new Set(preferredGenreIds));
  const [excluded, setExcluded] = useState<Set<number>>(new Set(excludedGenreIds));
  const [nameError, setNameError] = useState<string | undefined>();

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

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!displayName.trim()) {
      setNameError("Name is required");
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/profiles" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <input type="hidden" name="slot" value={slot} />

      <h2 className="text-lg font-semibold text-white">Profile {slot}</h2>

      <FormField
        id={`display_name_${slot}`}
        name="display_name"
        label="Name"
        value={displayName}
        onChange={(v) => {
          setDisplayName(v);
          if (nameError) setNameError(undefined);
        }}
        placeholder="e.g. Wojtek"
        error={nameError}
        icon={<User className="size-4" />}
      />

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

      <div>
        <label htmlFor={`note_${slot}`} className="mb-1 block text-sm text-blue-100/80">
          Note
        </label>
        <div className="relative">
          <span className="absolute top-3 left-3 size-4 text-white/40">
            <StickyNote className="size-4" />
          </span>
          <textarea
            id={`note_${slot}`}
            name="note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            placeholder="Favorite films, actors, anything that captures their taste"
            rows={3}
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 pl-10 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
          />
        </div>
      </div>

      <ServerError message={serverError} />

      {justSaved && !serverError ? (
        <p className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-900/30 px-3 py-2 text-sm text-green-300">
          <CheckCircle2 className="size-4 shrink-0" />
          Profile {slot} saved.
        </p>
      ) : null}

      <SubmitButton pendingText="Saving..." icon={<User className="size-4" />}>
        Save profile {slot}
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
