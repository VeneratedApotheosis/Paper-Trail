import { plural } from "@/components/SyncResult";

// Live state of a running Gmail sync, as reported by GET /api/gmail/sync/status. `total` is null until listing
// finishes; `fetched` counts attempted messages, including the `skipped` ones Gmail could not return or parse.
export interface SyncProgressInfo {
  stage: "listing" | "fetching" | "processing";
  fetched: number;
  total: number | null;
  skipped: number;
}

const STAGES = [
  { key: "listing", label: "List", desc: "Listing matching messages in Gmail" },
  { key: "fetching", label: "Fetch", desc: "Fetching receipt-like messages" },
  { key: "processing", label: "Process", desc: "Classifying and extracting receipts" },
] as const;

// Shown while a sync runs (issue #25). Fully controlled: it renders only the counts it is given and never advances on
// its own. With no progress yet (status not polled, or the server has none) it shows a plain "syncing" state.
// Processing has no count from the server, so its bar is not drawn.
export function SyncProgress({ progress }: { progress: SyncProgressInfo | null }) {
  const stageIndex = progress ? STAGES.findIndex((stage) => stage.key === progress.stage) : -1;
  const fetchPct =
    progress?.stage === "fetching" && progress.total !== null && progress.total > 0
      ? Math.min(100, Math.round((progress.fetched / progress.total) * 100))
      : null;

  return (
    <div className="mx-auto max-w-ledger space-y-6">
      <header className="space-y-2 text-center">
        <p className="eyebrow">Syncing</p>
        <h1 className="font-serif text-2xl text-ink">Reading your receipts</h1>
      </header>

      <div className="neu-raised rounded-xl px-7 py-9" role="status">
        <div className="text-center">
          {progress && progress.stage !== "listing" ? (
            <>
              <p className="font-serif text-3xl tabular-nums text-money">
                {progress.total !== null ? `${progress.fetched} / ${progress.total}` : progress.fetched}
              </p>
              <p className="mt-1 text-sm text-ink-muted">messages fetched</p>
            </>
          ) : null}
          <p className="mt-3 text-base text-ink">{progress ? STAGES[stageIndex].desc : "Starting the sync"}</p>
          {progress && progress.skipped > 0 ? (
            <p className="mt-1 text-sm text-ink-faint">{plural(progress.skipped, "message")} skipped</p>
          ) : null}
        </div>

        {fetchPct !== null ? (
          <div
            className="neu-inset mt-6 h-3 overflow-hidden rounded-full"
            role="progressbar"
            aria-label="Messages fetched"
            aria-valuenow={fetchPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-gradient-to-r from-teal-bright to-teal transition-[width]"
              style={{ width: `${fetchPct}%` }}
            />
          </div>
        ) : null}

        {progress ? (
          <div className="mt-7 flex flex-wrap justify-center gap-3">
            {STAGES.map((stage, index) => {
              const status = index < stageIndex ? "done" : index === stageIndex ? "active" : "pending";
              const pillClass =
                status === "done"
                  ? "neu-raised-sm text-teal-deep"
                  : status === "active"
                    ? "neu-inset text-ink"
                    : "text-ink-faint";
              return (
                <span
                  key={stage.key}
                  aria-current={status === "active" ? "step" : undefined}
                  className={`rounded-lg px-4 py-2 text-xs font-semibold ${pillClass}`}
                >
                  {stage.label}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>

      <p className="text-center text-sm text-ink-faint">
        Read only. This can take a few minutes; keep this tab open.
      </p>
    </div>
  );
}
