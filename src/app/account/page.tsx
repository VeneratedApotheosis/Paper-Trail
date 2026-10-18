"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ErrorState, LedgerSkeleton } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { AccountView } from "@/components/views/AccountView";
import { useAccount, useAction } from "@/hooks";
import { useSyncRunning } from "@/hooks/syncRun";
import { disconnectGmail, resetDemo } from "@/lib/api/client";
import { buildAccountViewData } from "./accountState";

// Thin wrapper for "/account" (issue #110): GET /api/account for the Gmail connection, data source, last sync and
// counts; Disconnect Gmail (POST /api/auth/disconnect, keeps the synced purchases) and Leave demo (DELETE /api/demo,
// then /connect). Sync emails opens the /sync flow (real preview, explicit Start); connecting or reconnecting is a
// full navigation to Google's read-only consent. Successful actions refresh the shared cache (useAction).
export default function AccountPage() {
  const router = useRouter();
  const account = useAccount();
  const syncRunningHere = useSyncRunning();
  const disconnect = useAction(disconnectGmail);
  const leaveDemo = useAction(resetDemo);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  async function handleConfirmDisconnect() {
    // Success: the refreshed account no longer offers Disconnect. Failure: the confirm closes and the error shows.
    await disconnect.run();
    setConfirmingDisconnect(false);
  }

  async function handleLeaveDemo() {
    if (await leaveDemo.run()) router.push("/connect");
  }

  if (account.error && !account.data) {
    return (
      <AppShell demo={false}>
        <ErrorState
          title="Couldn't load your account"
          what={account.error}
          fix="Check that the app server is running, then try again."
          actions={
            <Button type="button" onClick={account.refetch}>
              Try again
            </Button>
          }
        />
      </AppShell>
    );
  }

  if (!account.data) {
    return (
      <AppShell>
        <LedgerSkeleton />
      </AppShell>
    );
  }

  const disconnectStep = disconnect.pending ? "pending" : confirmingDisconnect ? "confirm" : "idle";

  return (
    <AccountView
      {...buildAccountViewData(account.data, syncRunningHere, new Date())}
      disconnectStep={disconnectStep}
      leaveDemoPending={leaveDemo.pending}
      actionError={disconnect.error ?? leaveDemo.error}
      onSync={() => router.push("/sync")}
      onConnect={() => {
        window.location.href = "/api/auth/google";
      }}
      onRequestDisconnect={() => setConfirmingDisconnect(true)}
      onConfirmDisconnect={() => void handleConfirmDisconnect()}
      onCancelDisconnect={() => setConfirmingDisconnect(false)}
      onLeaveDemo={() => void handleLeaveDemo()}
    />
  );
}
