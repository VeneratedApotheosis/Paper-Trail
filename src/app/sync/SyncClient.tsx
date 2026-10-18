"use client";

// Interim: SyncView renders simulated data; switch back to SyncView once it takes real preview/progress/result props (#101).
// Until then /sync composes only the shared state components (EmptyState, ErrorState, TokenExpired, Button) with real
// API data, so no simulated count, stage, or rate-limit backoff is ever shown.

import { AppShell } from "@/components/AppShell";
import { ErrorState, HeroSkeleton, TokenExpired } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { useSession } from "@/hooks";
import { AnonymousSync } from "./AnonymousSync";
import { GmailSync } from "./GmailSync";

/** Picks the /sync flow from the Gmail session: connected -> Gmail sync, expired -> reconnect, otherwise import/demo. */
export function SyncClient() {
  const session = useSession();

  if (session.loading) {
    return (
      <AppShell>
        <HeroSkeleton />
      </AppShell>
    );
  }
  if (session.error || !session.data) {
    return (
      <AppShell>
        <ErrorState
          title="Couldn't check your Gmail connection"
          what={session.error}
          fix="Check that the app server is running, then try again."
          actions={
            <Button type="button" onClick={session.refetch}>
              Try again
            </Button>
          }
        />
      </AppShell>
    );
  }
  if (session.data.connected) return <GmailSync />;
  if (session.data.error === "token_expired") {
    return (
      <AppShell demo={false}>
        <TokenExpired />
      </AppShell>
    );
  }
  return <AnonymousSync />;
}
