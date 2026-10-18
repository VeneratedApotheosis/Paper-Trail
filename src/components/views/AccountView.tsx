import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { GmailAccountsSection, type AccountRow, type AccountRowStatus } from "@/components/GmailAccountsSection";
import type { AppShellSync } from "@/components/ShellSyncControl";
import { Button, LinkButton } from "@/components/ui/Button";
import { recentSyncs } from "@/components/accountRecentSyncs";

export type { AccountRow, AccountRowStatus };

// Props-only Account screen (issue #110): which Gmail account is connected, where the current data comes from, when it
// was last synced, what is stored, and the controls (sync, reconnect, disconnect, leave demo, excluded stores, delete
// everything). Everything shown is a real value from the props; nothing is simulated. No fetch, no routing logic:
// every action is a callback, plain links only for pages (/trust, /connect).
// Layout (#142): one column on phones (Gmail, your data, delete), from xl two columns with a right rail (recent syncs, what Gmail\n// access allows, how connecting works, delete everything). Rail cards other than delete are desktop only.\n// With linked accounts (#115, `accounts` not empty) the single Gmail card becomes a list: one row per account with its own
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

type PillTone = "text-teal-deep" | "text-ink" | "text-ink-muted";

const GMAIL_COPY: Record<AccountGmailStatus, { chip: string; tone: PillTone; text: string }> = {
  connected: {
    chip: "Connected",
    tone: "text-teal-deep",
    text: "PaperTrail can read receipts from this mailbox. Access is read only: it never sends, deletes or changes your mail.",
  },
  expired: {
    chip: "Expired, needs reconnect",
    tone: "text-ink",
    text: "Google ended PaperTrail's read-only access. Your purchases are still here. Reconnect to read new receipts.",
  },
  not_connected: {
    chip: "Not connected",
    tone: "text-ink-muted",
    text: "Connect Gmail so PaperTrail can find receipts in your mailbox. Access is read only.",
  },
};

const destructiveText = "!text-danger";
const cardTitle = "font-serif text-xl text-ink xl:text-[1.375rem] xl:leading-7";
const railTitle = "font-serif text-xl text-ink";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="neu-inset flex min-h-[5.25rem] flex-col-reverse items-center justify-center gap-0.5 rounded-[18px] px-2 text-center xl:min-h-[5.75rem]">
      <dt className="text-label text-ink-muted">{label}</dt>
      <dd className="font-serif text-[1.625rem] leading-8 tabular-nums text-ink xl:text-[1.875rem] xl:leading-9">{value}</dd>
    </div>
  );
}

function RailDot() {
  return <span aria-hidden className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />;
}

const ACCESS_ALLOWS = [
  "Read receipts and order emails",
  "Card numbers and phones are redacted before any AI call",
  "Disconnect any time and access is revoked",
];

const CONNECT_STEPS = [
  "Sign in with Google and approve read only access.",
  "PaperTrail turns receipts into purchases and finds money you can get back.",
  "You approve each claim and send it yourself.",
];

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
  const syncs = recentSyncs({ accounts, mailbox: gmail.mailbox, lastSync });
  // How connecting works: only before any mailbox was ever linked (demo, uploads, empty).
  const showConnectSteps = accounts.length === 0 && gmail.status === "not_connected" && source.kind !== "gmail_disconnected";

  return (
    <AppShell>
      {/* data-layout="wide" lets the shell use the full desktop width (#133); below xl it is one column. */}
      <div data-layout="wide" className="mx-auto max-w-ledger xl:max-w-none">
        <header className="mb-6 space-y-3 xl:mb-8 xl:space-y-2">
          <h1 className="font-serif text-[2.125rem] leading-[2.375rem] text-ink xl:text-[2.5rem] xl:leading-[2.75rem]">Your account</h1>
          <p className="max-w-prose font-sans text-sm text-ink-muted xl:text-[0.9375rem] xl:leading-6">
            Where your purchases come from, when they were last updated, and the controls for your mailbox and data.
          </p>
        </header>

        {actionError ? (
          <p role="alert" className="anim-fade neu-inset mb-6 rounded-lg px-5 py-4 text-sm text-ink">
            {actionError}
          </p>
        ) : null}

        <div className="space-y-5 xl:grid xl:grid-cols-[minmax(0,1fr)_22.5rem] xl:items-start xl:gap-8 xl:space-y-0">
          <div className="min-w-0 space-y-5">
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
              <section aria-labelledby="gmail-heading" className="neu-raised rounded-lg p-5 xl:p-6">
                <div className="flex flex-col items-start gap-4 xl:flex-row xl:items-center xl:justify-between">
                  <h2 id="gmail-heading" className={`${cardTitle} xl:text-2xl xl:leading-[1.875rem]`}>
                    Gmail
                  </h2>
                  <div className="flex flex-wrap items-center gap-3">
                    {gmail.status === "connected" && gmail.mailbox ? (
                      <span className="font-sans text-base font-semibold text-ink" data-testid="mailbox">
                        {gmail.mailbox}
                      </span>
                    ) : null}
                    <span
                      className={`neu-inset inline-flex h-6 items-center whitespace-nowrap rounded-full px-3 text-[0.6875rem] font-semibold leading-[0.875rem] ${copy.tone}`}
                    >
                      {copy.chip}
                    </span>
                  </div>
                </div>
                <p className="mt-4 max-w-[35rem] font-sans text-sm text-ink-muted">{copy.text}</p>

                {disconnectStep === "idle" ? (
                  <div className="mt-4 flex flex-wrap gap-3">
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
                  <div className="neu-inset mt-4 rounded-xl p-5" role="group" aria-label="Confirm disconnecting Gmail">
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

            <section aria-labelledby="data-heading" className="neu-raised rounded-lg p-5 xl:p-6">
              <h2 id="data-heading" className={cardTitle}>
                Your data
              </h2>
              <dl className="mt-4 flex items-start justify-between gap-4 font-sans xl:justify-start xl:gap-12">
                <div className="min-w-0">
                  <dt className="text-label text-ink-muted">Current data source</dt>
                  <dd className="mt-0.5 text-[0.9375rem] font-semibold leading-5 text-ink" data-testid="source">
                    {source.label}
                  </dd>
                  <dd className="mt-0.5 text-sm text-ink-muted">{source.detail}</dd>
                </div>
                <div className="shrink-0 text-right xl:text-left">
                  <dt className="text-label text-ink-muted">Last sync</dt>
                  <dd className="mt-0.5 text-[0.9375rem] font-semibold leading-5 text-ink" data-testid="last-sync">
                    {lastSync ? lastSync.relative : "Never synced"}
                  </dd>
                  {lastSync ? <dd className="mt-0.5 hidden text-sm text-ink-muted xl:block">{lastSync.absolute}</dd> : null}
                </div>
              </dl>

              <dl className="mt-4 grid grid-cols-3 gap-2.5 xl:gap-4" aria-label="What is stored">
                <Stat label="Purchases" value={counts.purchases} />
                <Stat label="Findings" value={counts.findings} />
                <Stat label="Need a check" value={counts.needsCheck} />
              </dl>

              <div className="mt-4 flex flex-col items-start gap-3 xl:flex-row xl:items-center xl:justify-between xl:gap-4">
                <p className="font-sans text-sm text-ink-muted" data-testid="excluded-stores">
                  {excludedStores === 0
                    ? "No stores excluded."
                    : `${excludedStores} ${excludedStores === 1 ? "store is" : "stores are"} excluded from scanning.`}
                </p>
                <LinkButton href="/trust" variant="secondary" className="shrink-0">
                  Manage excluded stores
                </LinkButton>
              </div>

              {showLeaveDemo ? (
                <div className="mt-4 flex flex-col items-start gap-3 xl:flex-row xl:items-center xl:justify-between xl:gap-4">
                  <p className="max-w-prose font-sans text-sm text-ink-muted">
                    You are looking at synthetic demo purchases. Leaving the demo clears them.
                  </p>
                  <Button type="button" variant="secondary" className="shrink-0" onClick={onLeaveDemo} disabled={leaveDemoPending}>
                    {leaveDemoPending ? "Leaving demo" : "Leave demo"}
                  </Button>
                </div>
              ) : null}
            </section>
          </div>

          <aside aria-label="About your account" className="mt-5 space-y-5 xl:mt-0">
            {syncs.length > 0 ? (
              <section aria-labelledby="syncs-heading" className="neu-raised hidden rounded-lg p-6 xl:block">
                <h2 id="syncs-heading" className={railTitle}>
                  Recent syncs
                </h2>
                <ul className="mt-3.5 space-y-3.5">
                  {syncs.map((entry) => (
                    <li key={entry.key} className="border-t border-rule pt-3">
                      <p className="font-sans text-label text-ink-muted">{entry.when}</p>
                      <p className="mt-0.5 break-words font-sans text-sm text-ink">{entry.text}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="access-heading" className="neu-raised hidden rounded-lg p-6 xl:block">
              <h2 id="access-heading" className={railTitle}>
                What Gmail access allows
              </h2>
              <ul className="mt-3.5 space-y-3 font-sans text-sm text-ink">
                {ACCESS_ALLOWS.map((line) => (
                  <li key={line} className="flex items-start gap-2.5">
                    <RailDot />
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </section>

            {showConnectSteps ? (
              <section aria-labelledby="steps-heading" className="neu-raised hidden rounded-lg p-6 xl:block">
                <h2 id="steps-heading" className={railTitle}>
                  When you connect your inbox
                </h2>
                <ol className="mt-3.5 space-y-3 font-sans text-sm text-ink">
                  {CONNECT_STEPS.map((line, index) => (
                    <li key={line} className="flex gap-3">
                      <span aria-hidden className="font-serif font-semibold text-teal-deep">
                        {index + 1}
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {/* Phones: plain centred text and a text link; from xl a raised card with the pill button. */}
            <section
              aria-labelledby="delete-heading"
              className="flex flex-col items-center gap-2 px-3 pt-2 text-center xl:neu-raised xl:items-start xl:gap-3.5 xl:rounded-lg xl:p-6 xl:text-left"
            >
              <h2 id="delete-heading" className="sr-only text-danger xl:not-sr-only xl:font-serif xl:text-xl">
                Delete everything
              </h2>
              <p className="max-w-prose font-sans text-sm text-ink-muted">
                Erase every stored purchase, finding and audit entry and revoke Gmail access. You confirm on the{" "}
                <Link href="/trust" className="font-semibold text-teal-deep">
                  Trust page
                </Link>
                .
              </p>
              <LinkButton
                href="/trust"
                variant="ghost"
                className={`${destructiveText} xl:neu-raised-sm`}
              >
                Delete everything
              </LinkButton>
            </section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}