import React, { useState } from "react";
import { Clapperboard, StickyNote, CheckCircle2, Plus } from "lucide-react";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";
import { MOVIE_GENRES } from "@/lib/genres";
import { MOODS, INTENSITIES, DEFAULT_INTENSITY, type Intensity } from "@/lib/session-options";
import { cn } from "@/lib/utils";

/** Runtime-limit presets (minutes). Empty value → "No limit" (null in the DB). */
const RUNTIME_PRESETS = [90, 105, 120, 150, 180] as const;

interface Props {
  sessionId?: string | null;
  mood?: string | null;
  preferredGenreIds?: number[];
  excludedGenreIds?: number[];
  runtimeLimitMinutes?: number | null;
  intensity?: Intensity;
  note?: string | null;
  serverError?: string | null;
  justSaved?: boolean;
}

export default function SessionForm({
  sessionId = null,
  mood: initialMood = "",
  preferredGenreIds = [],
  excludedGenreIds = [],
  runtimeLimitMinutes = null,
  intensity: initialIntensity = DEFAULT_INTENSITY,
  note: initialNote = "",
  serverError,
  justSaved = false,
}: Props) {
  const [mood, setMood] = useState(initialMood ?? "");
  const [intensity, setIntensity] = useState<Intensity>(initialIntensity);
  const [runtime, setRuntime] = useState(runtimeLimitMinutes ? String(runtimeLimitMinutes) : "");
  const [note, setNote] = useState(initialNote ?? "");
  const [preferred, setPreferred] = useState<Set<number>>(new Set(preferredGenreIds));
  const [excluded, setExcluded] = useState<Set<number>>(new Set(excludedGenreIds));

  const editing = Boolean(sessionId);

  // Genres are mutually exclusive between preferred and avoid: selecting one
  // side clears the other so the submitted sets stay disjoint (mirrors
  // ProfileForm; the API also rejects overlap as a backstop).
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
    <form method="POST" action="/api/sessions" className="space-y-5" noValidate>
      {/* Empty when starting a new session; carries the id when editing the latest. */}
      <input type="hidden" name="session_id" value={sessionId ?? ""} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="mood" className="mb-1 block text-sm text-blue-100/80">
            Mood
          </label>
          <select
            id="mood"
            name="mood"
            value={mood}
            onChange={(e) => {
              setMood(e.target.value);
            }}
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
          >
            <option value="">Any mood</option>
            {MOODS.map((m) => (
              <option key={m.id} value={m.id} className="bg-slate-900">
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="intensity" className="mb-1 block text-sm text-blue-100/80">
            Intensity
          </label>
          <select
            id="intensity"
            name="intensity"
            value={intensity}
            onChange={(e) => {
              setIntensity(e.target.value as Intensity);
            }}
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
          >
            {INTENSITIES.map((i) => (
              <option key={i.id} value={i.id} className="bg-slate-900">
                {i.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="runtime_limit_minutes" className="mb-1 block text-sm text-blue-100/80">
          Runtime limit
        </label>
        <select
          id="runtime_limit_minutes"
          name="runtime_limit_minutes"
          value={runtime}
          onChange={(e) => {
            setRuntime(e.target.value);
          }}
          className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-white transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
        >
          <option value="">No limit</option>
          {RUNTIME_PRESETS.map((m) => (
            <option key={m} value={m} className="bg-slate-900">
              Up to {Math.floor(m / 60)}h{m % 60 ? ` ${m % 60}m` : ""} ({m} min)
            </option>
          ))}
        </select>
      </div>

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
        <label htmlFor="note" className="mb-1 block text-sm text-blue-100/80">
          Note
        </label>
        <div className="relative">
          <span className="absolute top-3 left-3 size-4 text-white/40">
            <StickyNote className="size-4" />
          </span>
          <textarea
            id="note"
            name="note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
            }}
            placeholder="Anything else about tonight — occasion, who's watching, a craving"
            rows={3}
            className="w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 pl-10 text-white placeholder-white/40 transition-colors focus:ring-2 focus:ring-purple-400 focus:outline-none"
          />
        </div>
      </div>

      <ServerError message={serverError} />

      {justSaved && !serverError ? (
        <p className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-900/30 px-3 py-2 text-sm text-green-300">
          <CheckCircle2 className="size-4 shrink-0" />
          Session saved.
        </p>
      ) : null}

      <SubmitButton pendingText="Saving..." icon={<Clapperboard className="size-4" />}>
        {editing ? "Update session" : "Start session"}
      </SubmitButton>

      {editing ? (
        <a
          href="/sessions"
          className="flex items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm text-blue-100/80 transition-colors hover:bg-white/10"
        >
          <Plus className="size-4" />
          Start another session
        </a>
      ) : null}
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
