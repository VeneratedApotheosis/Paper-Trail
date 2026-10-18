import { Button } from "@/components/ui/Button";

// Props-only "Sync emails" control for the app header (issue #112). One compact button whose label follows `state`,
// plus a popover under it for the inline confirm and for the result of a sync. The popover is absolutely positioned
// and the button has a fixed minimum width, so nothing on the page moves when the state changes. On phones the popover
// spans the header (AppShellView's <header> is the positioned parent); from `sm` up it hangs under the button. Every number shown
// arrives in props from real responses; nothing is simulated.

/** ready: Gmail connected and idle. running: a sync is in flight. connect / reconnect: Gmail is not usable. checking: account not loaded yet. */
export type AppShellSyncState = "checking" | "ready" | "running" | "connect" | "reconnect";

/** Live counts of a running sync (GET /api/gmail/sync/status). `total` is null until listing finishes. */
export interface AppShellSyncProgress {
  stage: "listing" | "fetching" | "processing";
  fetched: number;
  total: number | null;
}

/** Inline confirm shown before a sync starts, from GET /api/gmail/preview. */
export type AppShellSyncConfirm =
  | { status: "loading" }
  | { status: "ready"; messageCount: number; windowDays: number };

/** Outcome of the last attempt. `reconnect` adds a Reconnect Gmail action. */
export interface AppShellSyncNotice {
  tone: "success" | "error";
  text: string;
  detail?: string;
  reconnect?: boolean;
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
      return progress.total !== null ? `Reading ${progress.fetched} of ${progress.total}` : "Syncing";
  }
}

export function syncConfirmText(confirm: { messageCount: number; windowDays: number }): string {
  return `Read up to ${confirm.messageCount} emails from the last ${confirm.windowDays} days. Receipts are redacted and sent to Claude for analysis. Nothing is sent or changed in your mailbox.`;
}

export function ShellSyncControl({ sync }: { sync: AppShellSync }) {
  const { state, progress, lastSyncLabel, confirm, notice } = sync;
  const label = syncButtonLabel(state, progress);
  const disabled = state === "checking" || state === "running";
  const onClick = state === "ready" ? sync.onSync : state === "connect" || state === "reconnect" ? sync.onConnect : undefined;
  const surface =
    state === "running" ? "neu-inset text-ink" : state === "connect" || state === "reconnect" ? "neu-accent" : "neu-raised-sm text-teal-deep";

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
        className={`inline-flex min-w-[10.5rem] items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold transition-[box-shadow,transform] active:scale-[0.99] disabled:cursor-not-allowed ${
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
          className="neu-raised absolute inset-x-5 top-full z-50 mt-1 rounded-lg p-5 text-left sm:inset-x-auto sm:right-0 sm:mt-3 sm:w-[22rem]"
        >
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
        </div>
      ) : null}

      {!confirm && notice ? (
        <div
          role={notice.tone === "error" ? "alert" : "status"}
          className="neu-raised absolute inset-x-5 top-full z-50 mt-1 rounded-lg p-5 text-left sm:inset-x-auto sm:right-0 sm:mt-3 sm:w-[22rem]"
        >
          <p className="text-sm font-bold text-ink">{notice.text}</p>
          {notice.detail ? <p className="mt-1 text-sm text-ink-muted">{notice.detail}</p> : null}
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
        </div>
      ) : null}
    </div>
  );
}
