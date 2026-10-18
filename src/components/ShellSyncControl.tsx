import { Button } from "@/components/ui/Button";

// Props-only "Sync emails" control for the app header (issue #112). One compact button whose label follows `state`,
// plus a popover under it for the inline confirm and for the result of a sync. The popover is absolutely positioned
// and the button has a fixed minimum width, so nothing on the page moves when the state changes. On phones the popover
// spans the header (AppShellView's <header> is the positioned parent); from `sm` up it hangs under the button. Every number shown
// arrives in props from real responses; nothing is simulated.

/** ready: Gmail connected and idle. running: a sync is in flight. connect / reconnect: Gmail is not usable. checking: account not loaded yet. */
export type AppShellSyncState = "checking" | "ready" | "running" | "connect" | "reconnect";

/** One account's line while several accounts sync (#115): `detail` is plain words such as "12 of 50" or "waiting". */
export interface AppShellSyncAccountProgress {
  accountId: string;
  label: string;
  detail: string;
}

/**
 * Live counts of a running sync (GET /api/gmail/sync/status). `total` is null until listing finishes. `accounts` is set
 * only while two or more accounts sync, one line each.
 */
export interface AppShellSyncProgress {
  stage: "listing" | "fetching" | "processing" | "promotions";
  fetched: number;
  total: number | null;
  accounts?: AppShellSyncAccountProgress[];
}

/** Inline confirm shown before a sync starts, from GET /api/gmail/preview. `accountCount` is set for two or more accounts. */
export type AppShellSyncConfirm =
  | { status: "loading" }
  | { status: "ready"; messageCount: number; windowDays: number; accountCount?: number; redaction?: "on" | "off" };

/** How one account ended in a finished sync (#115). `reconnect`: it needs Google's read-only consent again. */
export interface AppShellSyncNoticeAccount {
  accountId: string;
  label: string;
  ok: boolean;
  text: string;
  reconnect?: boolean;
}

/** Outcome of the last attempt. `reconnect` adds a Reconnect Gmail action; `accounts` lists each account's result. */
export interface AppShellSyncNotice {
  tone: "success" | "error";
  text: string;
  detail?: string;
  reconnect?: boolean;
  accounts?: AppShellSyncNoticeAccount[];
}

export interface AppShellSync {
  state: AppShellSyncState;
  /** Only meaningful while `state` is "running". */
  progress?: AppShellSyncProgress | null;
  /** e.g. "Last synced 5 minutes ago" or "Not synced yet". */
  lastSyncLabel?: string;
  confirm?: AppShellSyncConfirm | null;
  notice?: AppShellSyncNotice | null;
  /** Click in the "ready" state: asks for the inline confirm. */
  onSync: () => void;
  /** Click in the "connect" and "reconnect" states. */
  onConnect: () => void;
  /** The account the confirm, the running sync or the last attempt is for; null or omitted = every connected account (#115). */
  targetAccountId?: string | null;
  /** Starts the confirm for one account (`accountId`) or every connected one (null). Omitted in single-account previews. */
  onSyncAccount?: (accountId: string | null) => void;
  /** "Start sync" in the confirm. */
  onStartSync: () => void;
  onCancelSync: () => void;
  onDismissNotice: () => void;
}

/** The button text for each state; progress words only for stages that carry real counts. */
export function syncButtonLabel(state: AppShellSyncState, progress?: AppShellSyncProgress | null): string {
  switch (state) {
    case "checking":
    case "ready":
      return "Sync emails";
    case "connect":
      return "Connect Gmail";
    case "reconnect":
      return "Reconnect Gmail";
    case "running":
      if (!progress || progress.stage === "listing") return "Syncing";
      if (progress.stage === "processing") return "Analyzing receipts";
      if (progress.stage === "promotions") return progress.total !== null ? `Reading promotions ${progress.fetched} of ${progress.total}` : "Reading promotions";
      return progress.total !== null ? `Reading ${progress.fetched} of ${progress.total}` : "Syncing";
  }
}

export function syncConfirmText(confirm: { messageCount: number; windowDays: number; accountCount?: number; redaction?: "on" | "off" }): string {
  const across = confirm.accountCount !== undefined && confirm.accountCount > 1 ? ` across ${confirm.accountCount} Gmail accounts` : "";
  return `Read up to ${confirm.messageCount} emails from the last ${confirm.windowDays} days${across}. ${confirm.redaction === "off" ? "Receipt text is sent to Claude as is (redaction is off)." : "Receipts are redacted and sent to Claude for analysis."} Nothing is sent or changed in your mailbox.`;
}

/** The confirm wording and its actions; the header popover and the Account page both show it. */
export function SyncConfirmContent({ confirm, sync }: { confirm: AppShellSyncConfirm; sync: Pick<AppShellSync, "onStartSync" | "onCancelSync"> }) {
  return (
    <>
      {confirm.status === "loading" ? (
        <p className="text-sm text-ink-muted">Checking your mailbox</p>
      ) : (
        <p className="text-sm text-ink">{syncConfirmText(confirm)}</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {confirm.status === "ready" ? (
          <Button type="button" className="px-4 py-2" onClick={sync.onStartSync}>
            Start sync
          </Button>
        ) : null}
        <Button type="button" variant="ghost" className="px-4 py-2" onClick={sync.onCancelSync}>
          Cancel
        </Button>
      </div>
    </>
  );
}

/** One line per account while several sync: mailbox on the left, its state on the right ("12 of 50", "waiting"). */
export function SyncAccountLines({ lines }: { lines: AppShellSyncAccountProgress[] }) {
  return (
    <ul className="space-y-1.5" data-testid="sync-account-lines">
      {lines.map((line) => (
        <li key={line.accountId} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0 truncate font-semibold text-ink">{line.label}</span>
          <span className="shrink-0 tabular-nums text-ink-muted">{line.detail}</span>
        </li>
      ))}
    </ul>
  );
}

/** The result of a sync: headline, detail and, for several accounts, how each one went. */
export function SyncNoticeContent({ notice, sync }: { notice: AppShellSyncNotice; sync: Pick<AppShellSync, "onConnect" | "onDismissNotice"> }) {
  return (
    <>
      <p className="text-sm font-bold text-ink">{notice.text}</p>
      {notice.detail ? <p className="mt-1 text-sm text-ink-muted">{notice.detail}</p> : null}
      {notice.accounts ? (
        <ul className="mt-3 space-y-2" data-testid="sync-notice-accounts">
          {notice.accounts.map((account) => (
            <li key={account.accountId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
              <span className="min-w-0 truncate font-semibold text-ink">{account.label}</span>
              <span className={account.ok ? "text-ink-muted" : "font-semibold text-ink"}>{account.text}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {notice.reconnect ? (
          <Button type="button" className="px-4 py-2" onClick={sync.onConnect}>
            Reconnect Gmail
          </Button>
        ) : null}
        <Button type="button" variant="ghost" className="px-4 py-2" onClick={sync.onDismissNotice}>
          Dismiss
        </Button>
      </div>
    </>
  );
}

const popover =
  "neu-raised absolute inset-x-5 top-full z-50 mt-1 rounded-lg p-5 text-left sm:inset-x-auto sm:right-0 sm:mt-3 sm:w-[22rem]";

export function ShellSyncControl({ sync }: { sync: AppShellSync }) {
  const { state, progress, lastSyncLabel, confirm, notice } = sync;
  const label = syncButtonLabel(state, progress);
  const disabled = state === "checking" || state === "running";
  const onClick = state === "ready" ? sync.onSync : state === "connect" || state === "reconnect" ? sync.onConnect : undefined;
  const surface =
    // Only "reconnect" is an action the user must take, so only it gets the accent. Connect (demo/empty) stays quiet.
    state === "running" ? "neu-inset text-ink" : state === "reconnect" ? "neu-accent" : "neu-raised-sm text-teal-deep";

  return (
    <div className="flex items-center gap-3 sm:relative">
      {lastSyncLabel ? (
        <span className="hidden text-label text-ink-faint sm:inline" data-testid="last-sync">
          {lastSyncLabel}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-busy={state === "running"}
        aria-haspopup={state === "ready" ? "dialog" : undefined}
        aria-expanded={state === "ready" ? Boolean(confirm) : undefined}
        title={lastSyncLabel}
        className={`inline-flex min-w-[10.5rem] items-center justify-center gap-2 whitespace-nowrap min-h-[44px] rounded-lg px-4 py-2 text-sm font-bold transition-[box-shadow,transform] active:scale-[0.99] disabled:cursor-not-allowed ${
          state === "running" ? "" : "disabled:opacity-60"
        } ${surface}`}
      >
        {state === "running" ? <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-teal" /> : null}
        <span role={state === "running" ? "status" : undefined}>{label}</span>
      </button>

      {confirm ? (
        <div
          role="dialog"
          aria-label="Confirm Gmail sync"
          className={popover}
        >
          <SyncConfirmContent confirm={confirm} sync={sync} />
        </div>
      ) : null}

      {!confirm && state === "running" && progress?.accounts ? (
        <div role="status" aria-label="Sync progress per account" className={popover}>
          <p className="mb-3 text-sm font-bold text-ink">Syncing {progress.accounts.length} accounts</p>
          <SyncAccountLines lines={progress.accounts} />
        </div>
      ) : null}

      {!confirm && notice ? (
        <div role={notice.tone === "error" ? "alert" : "status"} className={popover}>
          <SyncNoticeContent notice={notice} sync={sync} />
        </div>
      ) : null}
    </div>
  );
}
