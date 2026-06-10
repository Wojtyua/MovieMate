import React, { useState } from "react";
import { UserPlus, X } from "lucide-react";
import { GenrePicker } from "./GenrePicker";

/**
 * Optional, ephemeral second viewer captured on-device for tonight only.
 *
 * Renders inside the one-shot SessionForm (it has no <form> of its own).
 * When enabled it emits hidden `second_preferred_genre_ids` /
 * `second_excluded_genre_ids` inputs as repeated fields — the same pattern the
 * server reads via formData.getAll(). The second taste is NEVER persisted: it
 * rides only the POST to /api/recommendations and touches no table. Collapsing
 * the toggle clears the captured genres so nothing stale rides along.
 */
export function SecondViewer() {
  const [enabled, setEnabled] = useState(false);
  const [preferred, setPreferred] = useState<Set<number>>(new Set());
  const [excluded, setExcluded] = useState<Set<number>>(new Set());

  // Genres are mutually exclusive between preferred and avoid: selecting one
  // side clears the other so the submitted sets stay disjoint (mirrors
  // SessionForm; the API also sanitizes self-overlap as a backstop).
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

  // Collapsing clears the captured taste so a later re-open starts blank and no
  // stale genres are submitted (clears-on-off).
  function disable() {
    setEnabled(false);
    setPreferred(new Set());
    setExcluded(new Set());
  }

  if (!enabled) {
    return (
      <button
        type="button"
        onClick={() => {
          setEnabled(true);
        }}
        className="flex items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-4 py-2 text-sm text-blue-100/80 transition-colors hover:bg-white/10"
      >
        <UserPlus className="size-4" />
        Add a second viewer
      </button>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-purple-100">Second viewer (tonight only)</span>
        <button
          type="button"
          onClick={disable}
          className="flex items-center gap-1 rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-xs text-blue-100/80 transition-colors hover:bg-white/10"
        >
          <X className="size-3.5" />
          Remove
        </button>
      </div>
      <p className="text-xs text-blue-100/60">Captured on-device for tonight — never saved.</p>

      <GenrePicker label="Their preferred genres" kind="preferred" selected={preferred} onToggle={toggle} />
      <GenrePicker label="Their avoid genres" kind="excluded" selected={excluded} onToggle={toggle} />

      {/* Hidden fields carry the selected ids as repeated form entries, matching
          formData.getAll("second_*") on the server. */}
      {[...preferred].map((id) => (
        <input key={`sp-${id}`} type="hidden" name="second_preferred_genre_ids" value={id} />
      ))}
      {[...excluded].map((id) => (
        <input key={`se-${id}`} type="hidden" name="second_excluded_genre_ids" value={id} />
      ))}
    </div>
  );
}
