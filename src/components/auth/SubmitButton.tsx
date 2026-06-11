import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";

interface SubmitButtonProps {
  pendingText: string;
  icon: ReactNode;
  children: ReactNode;
  /**
   * Override for the pending state. `useFormStatus` only reports a pending
   * submission for forms driven by a React action; native `method="POST"` forms
   * (like the one-shot session form) must pass their own submitting state here.
   */
  pending?: boolean;
}

export function SubmitButton({ pendingText, icon, children, pending: pendingOverride }: SubmitButtonProps) {
  const { pending: formPending } = useFormStatus();
  const pending = pendingOverride ?? formPending;

  return (
    <Button
      type="submit"
      disabled={pending}
      className="w-full rounded-lg bg-purple-600 px-4 py-2 font-medium text-white transition-colors hover:bg-purple-500"
    >
      {pending ? (
        <span className="flex items-center gap-2">
          <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          {pendingText}
        </span>
      ) : (
        <span className="flex items-center gap-2">
          {icon}
          {children}
        </span>
      )}
    </Button>
  );
}
