"use client";

import { useRouter } from "next/navigation";
import { SyncView, type SyncErrorInfo, type SyncMode } from "@/components/views/SyncView";
import { useSession } from "@/hooks";
import { AnonymousSync } from "./AnonymousSync";
import { GmailSync } from "./GmailSync";
import { sessionErrorCopy, tokenExpiredCopy } from "./syncOutcome";

/** Picks the /sync flow from the Gmail session: connected -> Gmail sync, expired -> reconnect, otherwise import/demo. */
export function SyncClient() {
  const session = useSession();
  const router = useRouter();

  // Before a flow is picked nothing can start, so Start and Try again both re-check the session.
  function sessionState(mode: SyncMode, error: SyncErrorInfo | null) {
    return (
      <SyncView
        mode={mode}
        preview={null}
        phase={error ? "error" : "loading"}
        error={error}
        onStart={session.refetch}
        onRetry={session.refetch}
        onOpenLedger={() => router.push("/")}
        onReconnect={() => router.push("/connect")}
      />
    );
  }

  if (session.loading) return sessionState("import", null);
  if (session.error || !session.data) return sessionState("import", sessionErrorCopy(session.error));
  if (session.data.connected) return <GmailSync />;
  if (session.data.error === "token_expired") return sessionState("gmail", tokenExpiredCopy);
  return <AnonymousSync />;
}
