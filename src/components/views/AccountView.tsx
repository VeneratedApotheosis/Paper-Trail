import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { GmailAccountsSection, type AccountRow, type AccountRowStatus } from "@/components/GmailAccountsSection";
import type { AppShellSync } from "@/components/ShellSyncControl";
import { Button, LinkButton } from "@/components/ui/Button";
import { Chip, type ChipTone } from "@/components/ui/Chip";

export type { AccountRow, AccountRowStatus };

// Props-only Account screen (issue #110): which Gmail account is connected, where the current data comes from, when it
// was last synced, what is stored, and the controls (sync, reconnect, disconnect, leave demo, excluded stores, delete
// everything). Everything shown is a real value from the props; nothing is simulated. No fetch, no routing logic:
// every action is a callback, plain links only for pages (/trust, /connect).
// With linked accounts (#115, `accounts` not empty) the single Gmail card becomes a list: one row per account with its own
// Sync, Reconnect and Disconnect, "Add another Gmail account" and "Sync all accounts". Without them (demo, signed out,
// uploads) the single card below stays.

export type AccountGmailStatus = "connected" | "expired" | "not_connected";

/** What the ledger on screen was built from. `gmail_disconnected`: Gmail data is kept after Disconnect Gmail. */
export type AccountSourceKind = "demo" | "gmail" | "gmail_disconnected" | "upload" | "empty";

export interface AccountViewData {
  gmail: { status: AccountGmailStatus; mailbox: string | null };
  source: { kind: AccountSourceKind; label: string; detail: string };
  /** Null = never synced. */
  lastSync: { relative: string; absolute: string } | null;
  counts: { purchases: number; findings: number; needsCheck: number };
  excludedStores: number;
  /** A Gmail sync is running right now (here or elsewhere). */
  syncing: boolean;
}

export interface AccountViewProps extends AccountViewData {
  /** Linked Gmail accounts (#115); empty or omitted = the single Gmail card. */
  accounts?: AccountRow[];
  /** With `accounts`: which account the disconnect confirm in `disconnectStep` is for. */
  disconnectAccountId?: string | null;
  /** Sync controls of the account list: confirm, busy state, result (same state as the header button). */
  sync?: AppShellSync;
  /** Disconnect Gmail: idle, asking "are you sure?", or waiting for the server. */
  disconnectStep: "idle" | "confirm" | "pending";
  /** Leave demo is waiting for the server. */
  leaveDemoPending: boolean;
  /** A failed disconnect or leave-demo, in plain words. */
  actionError: string | null;
  onSync: () => void;
  /** Connect Gmail (not connected) and Reconnect Gmail (expired): both start Google's read-only consent. */
  onConnect: () => void;
  /** With linked accounts it carries the row's account id. */
  onRequestDisconnect: (accountId?: string) => void;
  onConfirmDisconnect: () => void;
  onCancelDisconnect: () => void;
  /** Only used in demo mode. */
  onLeaveDemo: () => void;
  /** "Add another Gmail account": starts Google's consent for one more mailbox. */
  onAddAccount?: () => void;
  /** Reconnect one expired or disconnected account in the list. */
  onReconnectAccount?: (accountId: string) => void;
}

const GMAIL_COPY: Record<AccountGmailStatus, { chip: string; tone: ChipTone; text: string }> = {
  connected: {
    chip: "Connected",
    tone: "saved",
    text: "PaperTrail can read receipts from this mailbox. Access is read only: it never sends, deletes or changes your mail.",
  },
  expired: {
    chip: "Expired, needs reconnect",
    tone: "review",
    text: "Google ended PaperTrail's read-only access. Your purchases are still here. Reconnect to read new receipts.",
  },
  not_connected: {
    chip: "Not connected",
    tone: "neutral",
    text: "Connect Gmail so PaperTrail can find receipts in your mailbox. Access is read only.",
  },
};

const destructiveText = "!text-danger";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="neu-inset flex flex-col-reverse rounded-lg px-4 py-4 text-center">
      <dt className="mt-1 text-label text-ink-muted">{label}</dt>
      <dd className="font-serif text-2xl tabular-nums text-ink">{value}</dd>
    </div>
  );
}

export function AccountView({
  gmail,
  source,
  lastSync,
  counts,
  excludedStores,
  syncing,
  accounts = [],
  disconnectAccountId = null,
  sync,
  disconnectStep,
  leaveDemoPending,
  actionError,
  onSync,
  onConnect,
  onRequestDisconnect,
  onConfirmDisconnect,
  onCancelDisconnect,
  onLeaveDemo,
  onAddAccount,
  onReconnectAccount,
}: AccountViewProps) {
  const copy = GMAIL_COPY[gmail.status];
  const showLeaveDemo = source.kind === "demo";

  return (
    <AppShell>
      <header className="mb-8">
        <p className="eyebrow">Account</p>
        <h1 className="mt-2 font-serif text-3xl text-ink">Your account</h1>
        <p className="mt-2 max-w-prose font-sans text-base text-ink-muted">
          Where your purchases come from, when they were last updated, and the controls for your mailbox and data.
        </p>
      </header>

      {actionError ? (
        <p role="alert" className="neu-inset mb-6 rounded-lg px-5 py-4 text-sm text-ink">
          {actionError}
        </p>
      ) : null}

      {accounts.length > 0 ? (
        <GmailAccountsSection
          accounts={accounts}
          disconnectStep={disconnectStep}
          disconnectAccountId={disconnectAccountId}
          sync={sync}
          onAddAccount={onAddAccount ?? onConnect}
          onReconnectAccount={onReconnectAccount ?? onConnect}
          onRequestDisconnect={onRequestDisconnect}
          onConfirmDisconnect={onConfirmDisconnect}
          onCancelDisconnect={onCancelDisconnect}
        />
      ) : (
        <section aria-labelledby="gmail-heading" className="neu-raised rounded-xl p-6">
          <p className="eyebrow">Gmail</p>
          <h2 id="gmail-heading" className="sr-only">
            Gmail connection
          </h2>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Chip tone={copy.tone}>{copy.chip}</Chip>
            {gmail.status === "connected" && gmail.mailbox ? (
              <span className="font-sans text-base font-semibold text-ink" data-testid="mailbox">
                {gmail.mailbox}
              </span>
            ) : null}
          </div>
          <p className="mt-3 max-w-prose font-sans text-sm text-ink-muted">{copy.text}</p>

          {disconnectStep === "idle" ? (
            <div className="mt-5 flex flex-wrap gap-3">
              {gmail.status === "connected" ? (
                <>
                  <Button type="button" onClick={onSync} disabled={syncing}>
                    {syncing ? "Syncing" : "Sync emails"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => onRequestDisconnect()}>
                    Disconnect Gmail
                  </Button>
                </>
              ) : null}
              {gmail.status === "expired" ? (
                <Button type="button" onClick={onConnect}>
                  Reconnect Gmail
                </Button>
              ) : null}
              {gmail.status === "not_connected" ? (
                <Button type="button" onClick={onConnect}>
                  Connect Gmail
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="neu-inset mt-5 rounded-xl p-5" role="group" aria-label="Confirm disconnecting Gmail">
              <p className="font-sans text-sm font-semibold text-ink">Disconnect Gmail?</p>
              <p className="mt-2 max-w-prose font-sans text-sm text-ink-muted">
                PaperTrail stops reading your mailbox and ends its access at Google. Your purchases and findings are kept
                here. You can connect Gmail again any time.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className={destructiveText}
                  onClick={onConfirmDisconnect}
                  disabled={disconnectStep === "pending"}
                >
                  {disconnectStep === "pending" ? "Disconnecting" : "Disconnect Gmail"}
                </Button>
                <Button type="button" variant="ghost" onClick={onCancelDisconnect} disabled={disconnectStep === "pending"}>
                  Keep connected
                </Button>
              </div>
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="data-heading" className="neu-raised mt-6 rounded-xl p-6">
        <p className="eyebrow">Your data</p>
        <h2 id="data-heading" className="sr-only">
          Your data
        </h2>
        <dl className="mt-4 space-y-4 font-sans text-sm">
          <div>
            <dt className="text-ink-muted">Current data source</dt>
            <dd className="mt-1 text-base font-semibold text-ink" data-testid="source">
              {source.label}
            </dd>
            <dd className="mt-1 text-ink-muted">{source.detail}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Last sync</dt>
            <dd className="mt-1 text-base font-semibold text-ink" data-testid="last-sync">
              {lastSync ? lastSync.relative : "Never synced"}
            </dd>
            {lastSync ? <dd className="mt-1 text-ink-muted">{lastSync.absolute}</dd> : null}
          </div>
        </dl>

        <dl className="mt-5 grid gap-4 sm:grid-cols-3" aria-label="What is stored">
          <Stat label="Purchases" value={counts.purchases} />
          <Stat label="Findings" value={counts.findings} />
          <Stat label="Need a check" value={counts.needsCheck} />
        </dl>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="font-sans text-sm text-ink-muted" data-testid="excluded-stores">
            {excludedStores === 0
              ? "No stores excluded."
              : `${excludedStores} ${excludedStores === 1 ? "store is" : "stores are"} excluded from scanning.`}
          </p>
          <LinkButton href="/trust" variant="secondary">
            Manage excluded stores
          </LinkButton>
        </div>

        {showLeaveDemo ? (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-prose font-sans text-sm text-ink-muted">
              You are looking at synthetic demo purchases. Leaving the demo clears them.
            </p>
            <Button type="button" variant="secondary" onClick={onLeaveDemo} disabled={leaveDemoPending}>
              {leaveDemoPending ? "Leaving demo" : "Leave demo"}
            </Button>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="delete-heading" className="neu-raised mt-6 rounded-xl p-6">
        <p className="eyebrow">Delete everything</p>
        <h2 id="delete-heading" className="sr-only">
          Delete everything
        </h2>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-prose font-sans text-sm text-ink-muted">
            Erase every stored purchase, finding and audit entry and revoke Gmail access. You confirm on the{" "}
            <Link href="/trust" className="font-semibold text-teal-deep">
              Trust page
            </Link>
            .
          </p>
          <LinkButton href="/trust" variant="secondary" className={destructiveText}>
            Delete everything
          </LinkButton>
        </div>
      </section>
    </AppShell>
  );
}
