import { useFormStatus } from "react-dom";

/**
 * Full-screen loading overlay that covers the multi-second retrieve+score wait.
 *
 * Must be rendered INSIDE the one-shot `<form>` so `useFormStatus()` sees the
 * in-flight submission. While pending it paints a fixed cosmic-styled overlay
 * with a spinner; it disappears on its own when the browser navigates (to the
 * picks page on success, or back to /sessions on error). Keying off
 * `useFormStatus` also makes it a double-submit guard alongside the disabled
 * SubmitButton. No props.
 */
export function Interstitial() {
  const { pending } = useFormStatus();

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
