"use client";

import { ConsentExplainer } from "@/components/ConsentExplainer";
import { ErrorState, TokenExpired } from "@/components/states";
import { Button } from "@/components/ui/Button";

// Props-only view for the pre-auth CONNECT screen (issue #24). This is a
// standalone page (no AppShell — the nav assumes a connected session), rendered
// as a centered neumorphic layout on the paper surface. All data arrives as
// props and every action is a callback, so the page wrapper owns routing + the
// OAuth start. No fetch, no @/lib/api|store|mock|auth, no routing here.
export type ConnectErrorState = "none" | "access_denied" | "token_expired" | "other";

export interface ConnectViewProps {
  errorState: ConnectErrorState;
  onConnect: () => void;
  onTryDemo: () => void;
  demoLoading?: boolean;
}

export function ConnectView({ errorState, onConnect, onTryDemo, demoLoading }: ConnectViewProps) {
  // Shared recovery actions for the error states: retry the connect flow or fall
  // back to synthetic demo data (both are callbacks the wrapper wires).
  const recoveryActions = (
    <>
      <Button type="button" onClick={onConnect}>
        Try again
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={onTryDemo}
        disabled={demoLoading}
        aria-busy={demoLoading}
      >
        {demoLoading ? "Loading demo…" : "Try demo data"}
      </Button>
    </>
  );

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-paper px-6 py-16 sm:py-20">
      {errorState === "access_denied" ? (
        <ErrorState
          title="Gmail wasn't connected"
          what="Access was denied. You may have declined the consent screen, or this account may not be on PaperTrail's approved test-user list yet."
          fix="Try again, or ask a teammate to add you as a test user, or explore with synthetic demo data in the meantime."
          actions={recoveryActions}
        />
      ) : errorState === "token_expired" ? (
        <TokenExpired reconnectHref="/connect" />
      ) : errorState === "other" ? (
        <ErrorState
          title="Couldn't complete sign-in"
          what="Please try again."
          actions={recoveryActions}
        />
      ) : (
        <ConsentExplainer onConnect={onConnect} onTryDemo={onTryDemo} demoLoading={demoLoading} />
      )}
    </main>
  );
}
