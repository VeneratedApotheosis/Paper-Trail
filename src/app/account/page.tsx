"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { ErrorState, LedgerSkeleton } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { AccountView } from "@/components/views/AccountView";
import { useAccount, useAction } from "@/hooks";
import { addAccountHref, connectHref } from "@/hooks/accountLinks";
import { useGmailSyncControl } from "@/hooks/gmailSyncControl";
import { useSyncRunning } from "@/hooks/syncRun";
import { disconnectGmail, resetDemo } from "@/lib/api/client";
import { buildAccountRows, buildAccountViewData } from "./accountState";

// Thin wrapper for "/account" (issues #110, #115): GET /api/account for the linked Gmail accounts, data source, last sync
// and counts; Disconnect (POST /api/auth/disconnect, one account or, without linked accounts, Gmail as a whole; the
// synced purchases are kept) and Leave demo (DELETE /api/demo, then /connect). With linked accounts each row syncs on
// its own (inline confirm with the real preview, explicit Start, same sync control as the header button) and "Add
// another Gmail account" / Reconnect are full navigations to Google's read-only consent. Without them, Sync emails opens
// the /sync flow. Successful actions refresh the shared cache (useAction, runGmailSync).
export default function AccountPage() {
  const router = useRouter();
  const account = useAccount();
  const syncRunningHere = useSyncRunning();
  const navigate = useCallback((href: string) => router.push(href), [router]);
  const sync = useGmailSyncControl(account.data, navigate);
  const disconnect = useAction(disconnectGmail);
  const leaveDemo = useAction(resetDemo);
  // The open disconnect confirm: for one linked account, or (accountId null) for Gmail as a whole.
  const [disconnectTarget, setDisconnectTarget] = useState<{ accountId: string | null } | null>(null);

  async function handleConfirmDisconnect() {
    // Success: the refreshed account shows the new state. Failure: the confirm closes and the error shows.
    const accountId = disconnectTarget?.accountId ?? null;
    await disconnect.run(accountId === null ? {} : { accountId });
    setDisconnectTarget(null);
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

  const disconnectStep = disconnect.pending ? "pending" : disconnectTarget ? "confirm" : "idle";
  const goToGoogle = (href: string) => {
    window.location.href = href;
  };

  return (
    <AccountView
      {...buildAccountViewData(account.data, syncRunningHere, new Date())}
      accounts={buildAccountRows(account.data.accounts, sync, new Date())}
      sync={sync}
      disconnectStep={disconnectStep}
      disconnectAccountId={disconnectTarget?.accountId ?? null}
      leaveDemoPending={leaveDemo.pending}
      actionError={disconnect.error ?? leaveDemo.error}
      onSync={() => router.push("/sync")}
      onConnect={() => goToGoogle(connectHref(account.data))}
      onAddAccount={() => goToGoogle(addAccountHref())}
      onReconnectAccount={() => goToGoogle(connectHref(account.data))}
      onRequestDisconnect={(accountId) => setDisconnectTarget({ accountId: accountId ?? null })}
      onConfirmDisconnect={() => void handleConfirmDisconnect()}
      onCancelDisconnect={() => setDisconnectTarget(null)}
      onLeaveDemo={() => void handleLeaveDemo()}
    />
  );
}
