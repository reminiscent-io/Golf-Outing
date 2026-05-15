import { useState, type ReactNode } from "react";
import { useAuthSession } from "@/lib/auth";
import { SignInModal } from "@/components/sign-in-modal";

type Props = {
  children: ReactNode;
  /**
   * When true, the modal is mandatory: closing it stays gated. When false, the
   * user can dismiss the modal and return to the trigger.
   */
  mandatory?: boolean;
  /** Render this when not signed in; clicking it opens the modal. */
  trigger?: (open: () => void) => ReactNode;
  /** Optional title for the modal. */
  modalTitle?: string;
};

/**
 * Gate any UI behind sign-in. Two modes:
 *  - With `trigger`: renders the trigger when signed out (modal opens on click).
 *  - Without `trigger`: opens the modal immediately when signed out and hides children.
 */
export function RequireSignIn({ children, mandatory = false, trigger, modalTitle }: Props) {
  const session = useAuthSession();
  const [open, setOpen] = useState(false);

  if (session) {
    return <>{children}</>;
  }

  // No session.
  if (trigger) {
    return (
      <>
        {trigger(() => setOpen(true))}
        <SignInModal
          open={open}
          onClose={mandatory ? undefined : () => setOpen(false)}
          onSignedIn={() => setOpen(false)}
          title={modalTitle}
        />
      </>
    );
  }

  // No trigger — auto-open the modal.
  return (
    <SignInModal
      open
      onClose={mandatory ? undefined : () => setOpen(false)}
      onSignedIn={() => setOpen(false)}
      title={modalTitle}
    />
  );
}
