import { Button } from "@/components/ui/Button";

// Shown before the first run (issue #25, criterion 1): the Gmail query, how many
// messages would be fetched, and the cap in plain language, so the user sees
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
    <div className="mx-auto max-w-ledger space-y-6">
      <header className="space-y-2">
        <p className="eyebrow">Sync now</p>
        <h1 className="font-serif text-3xl text-ink">Check your inbox for new receipts</h1>
        <p className="max-w-md text-base text-ink-muted">
          PaperTrail reads only receipt-like email, redacts it before any AI call, and never sends
          or changes a thing. Here is exactly what this run will do.
        </p>
      </header>

      <section className="neu-raised space-y-6 rounded-xl px-7 py-7">
        <div className="space-y-2">
          <p className="eyebrow">Gmail query</p>
          <code className="neu-inset block rounded-lg px-4 py-3 text-sm text-ink-muted">
            {query}
          </code>
        </div>
        <div className="flex flex-col gap-5 sm:flex-row sm:gap-10">
          <div className="space-y-1">
            <p className="eyebrow">Messages to fetch</p>
            <p className="text-sm text-ink-muted">
              <span className="font-serif text-xl tabular-nums text-ink">{messageCount}</span>{" "}
              matching messages <span className="text-ink-faint">(simulated)</span>
            </p>
          </div>
          <div className="space-y-1">
            <p className="eyebrow">First-sync cap</p>
            <p className="text-sm text-ink-muted">Last 90 days, up to 300 messages</p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={onStart}>Start sync</Button>
        <p className="text-sm text-ink-faint">Read only. Nothing is sent, moved, or deleted.</p>
      </div>

      <label className="neu-inset flex items-center gap-3 rounded-lg px-4 py-3 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={simulateNoReceipts}
          onChange={(event) => onToggleNoReceipts(event.target.checked)}
          className="h-4 w-4 rounded-sm accent-teal"
        />
        <span>
          <span className="font-semibold text-ink">Dev:</span> preview the no-receipts outcome
        </span>
      </label>
    </div>
  );
}
