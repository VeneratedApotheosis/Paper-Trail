import { Button } from "@/components/ui/Button";

// Shown before the first run (issue #25, criterion 1): the Gmail query, how many
// messages would be fetched, and the cap in plain language — so the user sees
// exactly what will happen before anything is read. Numbers are simulated.
export function SyncPreview({
  query,
  messageCount,
  simulateNoReceipts,
  onToggleNoReceipts,
  onStart,
}: {
  query: string;
  messageCount: number;
  simulateNoReceipts: boolean;
  onToggleNoReceipts: (next: boolean) => void;
  onStart: () => void;
}) {
  return (
    <div className="mx-auto max-w-ledger space-y-8">
      <header className="space-y-2">
        <p className="text-label uppercase tracking-wide text-ink-faint">Sync now</p>
        <h1 className="font-serif text-3xl text-ink">Check your inbox for new receipts</h1>
        <p className="max-w-md text-base text-ink-muted">
          PaperTrail reads only receipt-like email, redacts it before anything else,
          and never sends or changes a thing. Here&apos;s exactly what this run will do.
        </p>
      </header>

      <section className="rounded-lg border border-rule bg-paper-raised">
        <dl className="divide-y divide-rule">
          <div className="flex flex-col gap-1 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <dt className="text-sm font-medium text-ink">Gmail query</dt>
            <dd className="text-sm text-ink-muted">
              <code className="rounded-sm bg-paper-sunk px-1.5 py-0.5 text-ink-muted">{query}</code>
            </dd>
          </div>
          <div className="flex flex-col gap-1 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <dt className="text-sm font-medium text-ink">Messages to fetch</dt>
            <dd className="text-sm text-ink-muted">
              <span className="font-medium tabular-nums text-ink">{messageCount}</span> matching
              messages <span className="text-ink-faint">(simulated)</span>
            </dd>
          </div>
          <div className="flex flex-col gap-1 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
            <dt className="text-sm font-medium text-ink">First-sync cap</dt>
            <dd className="text-sm text-ink-muted">Last 90 days, up to 300 messages</dd>
          </div>
        </dl>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={onStart}>Start sync</Button>
        <p className="text-sm text-ink-faint">Read-only — nothing is sent, moved, or deleted.</p>
      </div>

      <label className="flex items-center gap-2 border-t border-rule pt-6 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={simulateNoReceipts}
          onChange={(event) => onToggleNoReceipts(event.target.checked)}
          className="h-4 w-4 rounded-sm border-rule accent-ink"
        />
        <span>
          <span className="font-medium text-ink">Dev:</span> preview the no-receipts outcome
        </span>
      </label>
    </div>
  );
}
