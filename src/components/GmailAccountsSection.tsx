import { SyncConfirmContent, SyncNoticeContent, type AppShellSync } from "@/components/ShellSyncControl";
import { Button } from "@/components/ui/Button";

// The Gmail accounts card of the Account screen (issue #115): every linked account with its state, last sync and its own
// Sync, Reconnect and Disconnect, plus "Add another Gmail account" and "Sync all". Props-only like AccountView: every
// value is real (from GET /api/account and the sync control), every action is a callback.

/** connected: readable now. expired: the mailbox is known but Google ended access. disconnected: no grant and no address. */
export type AccountRowStatus = "connected" | "expired" | "disconnected";

export interface AccountRow {
  id: string;
  /** The mailbox, or a plain stand-in such as "Disconnected account". */
  label: string;
  status: AccountRowStatus;
  /** Null = never synced. */
  lastSync: { relative: string; absolute: string } | null;
  /** This account is being synced right now (here or elsewhere). */
  syncing: boolean;
  /** Progress in plain words while `syncing`: "Reading 12 of 50", "Waiting for its turn". */
  syncDetail: string | null;
}

export interface GmailAccountsSectionProps {
  accounts: AccountRow[];
  /** Disconnect confirm: idle, asking "are you sure?", or waiting for the server; `disconnectAccountId` says for which account. */
  disconnectStep: "idle" | "confirm" | "pending";
  disconnectAccountId: string | null;
  /** Sync state shared with the header button: drives the confirm, the busy state and the result. Omit to hide Sync. */
  sync?: AppShellSync;
  onAddAccount: () => void;
  onReconnectAccount: (accountId: string) => void;
  onRequestDisconnect: (accountId: string) => void;
  onConfirmDisconnect: () => void;
  onCancelDisconnect: () => void;
}

// `dot` marks the state without colour: a filled teal dot for connected, a ring for expired, none for disconnected.
const STATUS_COPY: Record<AccountRowStatus, { chip: string; tone: string; dot: "filled" | "ring" | null; text: string | null }> = {
  connected: { chip: "Connected", tone: "text-teal-deep", dot: "filled", text: null },
  expired: {
    chip: "Expired, needs reconnect",
    tone: "text-ink",
    dot: "ring",
    text: "Google ended PaperTrail's read-only access to this account. Its purchases are still here. Reconnect to read new receipts.",
  },
  disconnected: {
    chip: "Disconnected",
    tone: "text-ink-muted",
    dot: null,
    text: "PaperTrail no longer reads this account. Its purchases are kept. Reconnect to read new receipts again.",
  },
};

const destructiveText = "!text-danger";

function StatusPill({ status }: { status: AccountRowStatus }) {
  const copy = STATUS_COPY[status];
  return (
    <span
      className={`neu-inset inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 text-[0.6875rem] font-semibold leading-[0.875rem] ${copy.tone}`}
    >
      {copy.dot === "filled" ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal" /> : null}
      {copy.dot === "ring" ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full border-[1.5px] border-solid border-ink" /> : null}
      {copy.chip}
    </span>
  );
}

// Per-account buttons sit in fixed-width lanes from xl so Sync, Disconnect and Reconnect line up row to row.
const laneWide = "flex-1 xl:w-[9.875rem] xl:flex-none";
const laneNarrow = "flex-1 xl:w-[7.5rem] xl:flex-none";

export function GmailAccountsSection({
  accounts,
  disconnectStep,
  disconnectAccountId,
  sync,
  onAddAccount,
  onReconnectAccount,
  onRequestDisconnect,
  onConfirmDisconnect,
  onCancelDisconnect,
}: GmailAccountsSectionProps) {
  const connected = accounts.filter((account) => account.status === "connected").length;
  const canSync = sync?.onSyncAccount !== undefined;
  // One sync at a time: busy while one runs, while its confirm is open or while the account is still loading.
  const busy = sync !== undefined && (sync.state === "running" || sync.state === "checking" || Boolean(sync.confirm));
  const syncingAll = busy && sync?.state === "running" && (sync.targetAccountId ?? null) === null;
  const confirmForAll = sync?.confirm && (sync.targetAccountId ?? null) === null ? sync.confirm : null;

  return (
    <section aria-labelledby="gmail-heading" className="neu-raised rounded-lg p-5 xl:p-6">
      <h2 id="gmail-heading" className="font-serif text-xl text-ink xl:text-[1.375rem] xl:leading-7">
        Gmail accounts
      </h2>
      <p className="mt-4 max-w-prose font-sans text-sm text-ink-muted">
        PaperTrail can read receipts from the connected mailboxes below. Access is read only: it never sends, deletes or
        changes your mail. Every purchase shows which account it came from.
      </p>

      <ul className="mt-4 space-y-4" aria-label="Linked Gmail accounts">
        {accounts.map((row) => {
          const copy = STATUS_COPY[row.status];
          const confirming = disconnectStep !== "idle" && disconnectAccountId === row.id;
          const confirmHere = sync?.confirm && sync.targetAccountId === row.id ? sync.confirm : null;
          return (
            <li key={row.id} data-testid="account-row" className="neu-inset rounded-[18px] p-4 xl:p-5">
              <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:gap-4">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="min-w-0 break-all font-sans text-[0.9375rem] font-semibold leading-5 text-ink" data-testid="account-label">
                    {row.label}
                  </span>
                  <div className="flex flex-col items-start gap-2.5 xl:flex-row xl:items-center xl:gap-3">
                    <StatusPill status={row.status} />
                    <p className="font-sans text-sm text-ink-muted" data-testid="account-last-sync">
                      {row.lastSync ? (
                        <span title={row.lastSync.absolute}>Last synced {row.lastSync.relative}</span>
                      ) : (
                        "Never synced"
                      )}
                    </p>
                  </div>
                  {row.syncing ? (
                    <p role="status" className="font-sans text-sm font-semibold text-teal-deep" data-testid="account-sync-detail">
                      {row.syncDetail ?? "Syncing"}
                    </p>
                  ) : null}
                  {copy.text ? <p className="max-w-prose font-sans text-sm text-ink-muted">{copy.text}</p> : null}
                </div>

                {confirming ? null : (
                  <div className="flex gap-3 pt-1.5 xl:shrink-0 xl:justify-end xl:pt-0">
                    {row.status === "connected" && canSync ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className={laneWide}
                        aria-label={`Sync this account: ${row.label}`}
                        onClick={() => sync?.onSyncAccount?.(row.id)}
                        disabled={busy}
                      >
                        {row.syncing ? "Syncing" : "Sync this account"}
                      </Button>
                    ) : null}
                    {row.status === "connected" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className={laneNarrow}
                        aria-label={`Disconnect ${row.label}`}
                        onClick={() => onRequestDisconnect(row.id)}
                      >
                        Disconnect
                      </Button>
                    ) : (
                      <Button type="button" className={laneWide} aria-label={`Reconnect ${row.label}`} onClick={() => onReconnectAccount(row.id)}>
                        Reconnect
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {confirming ? (
                <div className="neu-raised-sm mt-4 rounded-lg p-4" role="group" aria-label={`Confirm disconnecting ${row.label}`}>
                  <p className="font-sans text-sm font-semibold text-ink">Disconnect {row.label}?</p>
                  <p className="mt-2 max-w-prose font-sans text-sm text-ink-muted">
                    PaperTrail stops reading this mailbox and ends its access at Google. Its purchases and findings are
                    kept here. You can add the account again any time.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      className={destructiveText}
                      onClick={onConfirmDisconnect}
                      disabled={disconnectStep === "pending"}
                    >
                      {disconnectStep === "pending" ? "Disconnecting" : "Disconnect"}
                    </Button>
                    <Button type="button" variant="ghost" onClick={onCancelDisconnect} disabled={disconnectStep === "pending"}>
                      Keep connected
                    </Button>
                  </div>
                </div>
              ) : null}

              {confirmHere ? (
                <div className="neu-raised-sm mt-4 rounded-lg p-4" role="group" aria-label={`Confirm syncing ${row.label}`}>
                  {sync ? <SyncConfirmContent confirm={confirmHere} sync={sync} /> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-col gap-3 xl:flex-row">
        {connected >= 2 && canSync ? (
          <Button type="button" onClick={() => sync?.onSyncAccount?.(null)} disabled={busy}>
            {syncingAll ? "Syncing all accounts" : "Sync all accounts"}
          </Button>
        ) : null}
        <Button type="button" variant="secondary" onClick={onAddAccount}>
          Add another Gmail account
        </Button>
      </div>

      {sync && confirmForAll ? (
        <div className="neu-raised-sm mt-5 rounded-lg p-4" role="group" aria-label="Confirm syncing all accounts">
          <SyncConfirmContent confirm={confirmForAll} sync={sync} />
        </div>
      ) : null}

      {sync && !sync.confirm && sync.notice ? (
        <div role={sync.notice.tone === "error" ? "alert" : "status"} className="neu-raised-sm mt-5 rounded-lg p-4">
          <SyncNoticeContent notice={sync.notice} sync={sync} />
        </div>
      ) : null}
    </section>
  );
}
