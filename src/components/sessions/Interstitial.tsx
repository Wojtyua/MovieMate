import { useFormStatus } from "react-dom";

/**
 * Full-screen loading overlay that covers the multi-second retrieve+score wait.
 *
 * Native `method="POST"` forms don't drive `useFormStatus()` (that hook only
 * tracks React-action submissions), so the form passes its own submitting state
 * via the `pending` prop; `useFormStatus` is kept as a fallback for any
 * React-action caller. While pending it paints a fixed cosmic-styled overlay
 * with a spinner; it disappears on its own when the browser navigates (to the
 * picks page on success, or back to /sessions on error).
 */
export function Interstitial({ pending: pendingOverride }: { pending?: boolean }) {
  const { pending: formPending } = useFormStatus();
  const pending = pendingOverride ?? formPending;

  if (!pending) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-slate-950/80 backdrop-blur-xl"
    >
      <span className="size-12 animate-spin rounded-full border-4 border-white/20 border-t-purple-400" />
      <p className="bg-gradient-to-r from-blue-200 to-purple-200 bg-clip-text text-lg font-semibold text-transparent">
        Finding tonight&apos;s picks…
      </p>
    </div>
  );
}
