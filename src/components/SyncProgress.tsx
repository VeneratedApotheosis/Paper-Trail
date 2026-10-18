import { plural } from "@/components/SyncResult";
import { SyncLayout, SyncRail, insetTile, mainCard, stepStates } from "@/components/SyncRail";

// Live state of a running Gmail sync, as reported by GET /api/gmail/sync/status. `total` is null until listing
// finishes; `fetched` counts attempted messages, including the `skipped` ones Gmail could not return or parse.
export interface SyncProgressInfo {
  stage: "listing" | "fetching" | "processing" | "promotions";
  fetched: number;
  total: number | null;
  skipped: number;
}

const STAGES = [
  { key: "listing", label: "Listing", desc: "Listing matching messages in Gmail" },
  { key: "fetching", label: "Fetching", desc: "Fetching receipt-like messages" },
  { key: "processing", label: "Processing", desc: "Classifying and extracting receipts" },
  { key: "promotions", label: "Promotions", desc: "Reading promotions" },
] as const;

type Status = "done" | "active" | "pending";

const STATUS_WORD: Record<Status, string> = { done: "Done", active: "In progress", pending: "Waiting" };

function stageNote(stage: (typeof STAGES)[number]["key"], progress: SyncProgressInfo, redactionOff: boolean): string {
  switch (stage) {
    case "listing":
      return progress.total !== null ? `${plural(progress.total, "email")} will be read.` : STAGES[0].desc;
    case "fetching":
      return progress.total !== null
        ? `${progress.fetched} of ${progress.total} opened so far.${progress.skipped > 0 ? ` ${progress.skipped} skipped.` : ""}`
        : `${progress.fetched} opened so far.`;
    case "processing":
      return redactionOff
        ? "Starts when fetching finishes. Redaction is off, so receipt text goes to the AI as is."
        : "Starts when fetching finishes. Emails are redacted before any AI sees them.";
    case "promotions":
      return "Reads promotion emails after the receipts.";
  }
}

// Shown while a sync runs (issue #25). Fully controlled: it renders only the counts it is given and never advances on
// its own. With no progress yet (status not polled, or the server has none) it shows a plain "syncing" state.
// Processing has no count from the server, so its bar is not drawn. `maxMessages`, `windowDays` and `redactionOff`
// come from the loaded preview and are left out when it has none.
export function SyncProgress({
  progress,
  maxMessages,
  windowDays,
  redactionOff = false,
}: {
  progress: SyncProgressInfo | null;
  maxMessages?: number;
  windowDays?: number;
  redactionOff?: boolean;
}) {
  const stageIndex = progress ? STAGES.findIndex((stage) => stage.key === progress.stage) : -1;
  const fetchPct =
    progress?.stage === "fetching" && progress.total !== null && progress.total > 0
      ? Math.min(100, Math.round((progress.fetched / progress.total) * 100))
      : null;
  const statusOf = (index: number): Status => (index < stageIndex ? "done" : index === stageIndex ? "active" : "pending");

  return (
    <SyncLayout
      mode="gmail"
      title="Syncing your inbox"
      intro={`Reading receipt emails${windowDays ? ` from the last ${windowDays} days` : ""}. Keep this page open while it works.`}
      rail={
        <SyncRail
          states={stepStates("syncing", progress?.stage)}
          windowDays={windowDays}
          maxMessages={maxMessages}
          redactionOff={redactionOff}
          stepsOnPhone={false}
        />
      }
    >
      <div className={mainCard} role="status">
        {progress ? (
          <ol className="flex gap-2 xl:gap-3">
            {STAGES.map((stage, index) => {
              const status = statusOf(index);
              const cls =
                status === "done"
                  ? "neu-inset text-teal-deep"
                  : status === "active"
                    ? "neu-accent !shadow-none"
                    : "neu-inset text-ink-muted";
              return (
                <li
                  key={stage.key}
                  aria-current={status === "active" ? "step" : undefined}
                  className={`flex min-h-[2.125rem] flex-1 items-center justify-center gap-1.5 rounded-full px-1 text-[0.75rem] font-bold leading-4 xl:min-h-9 xl:text-[0.8125rem] ${cls}`}
                >
                  {status === "done" ? (
                    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="hidden shrink-0 sm:block">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  ) : null}
                  {stage.label}
                  <span className="sr-only">: {STATUS_WORD[status]}</span>
                </li>
              );
            })}
          </ol>
        ) : null}

        <div className="space-y-1">
          {progress && progress.stage !== "listing" ? (
            <p className="flex flex-wrap items-end gap-x-2 gap-y-0 xl:gap-x-3">
              <span className="font-serif text-[3.5rem] font-semibold leading-[3.75rem] tracking-[-0.02em] tabular-nums text-ink xl:text-[5rem] xl:leading-[5.25rem]">
                {progress.fetched}
              </span>
              <span className="font-serif text-2xl leading-9 text-ink-muted xl:text-[1.75rem] xl:leading-[3rem]">
                {progress.total !== null ? `of ${progress.total} emails fetched` : "emails fetched"}
              </span>
            </p>
          ) : null}
          <p className="text-base text-ink-muted">{progress ? STAGES[stageIndex].desc : "Starting the sync"}</p>
        </div>

        {fetchPct !== null ? (
          <div
            className="neu-inset flex h-[1.125rem] items-center rounded-full p-[3px] xl:h-5"
            role="progressbar"
            aria-label="Messages fetched"
            aria-valuenow={fetchPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-3 rounded-full bg-gradient-to-r from-teal-bright to-teal transition-[width] xl:h-3.5"
              style={{ width: `${fetchPct}%` }}
            />
          </div>
        ) : null}

        {progress ? (
          <div className="flex flex-col gap-3 xl:flex-row xl:gap-4">
            <div className={`${insetTile} hidden flex-1 flex-col gap-1 xl:flex`}>
              <p className="font-serif text-[2.5rem] font-semibold leading-[2.75rem] tabular-nums text-ink">{progress.fetched}</p>
              <p className="text-sm font-semibold text-ink">Fetched</p>
              <p className="text-[0.75rem] leading-4 text-ink-muted">Opened so far</p>
            </div>
            <div className={`${insetTile} flex flex-1 items-center gap-4 xl:flex-col xl:items-start xl:gap-1`}>
              <p className="font-serif text-[2rem] font-semibold leading-9 tabular-nums text-ink xl:text-[2.5rem] xl:leading-[2.75rem]">{progress.skipped}</p>
              <div className="flex flex-col gap-0.5 xl:gap-1">
                <p className="text-sm font-semibold text-ink">Skipped</p>
                <p className="text-[0.75rem] leading-4 text-ink-muted">Gmail could not return or read them.</p>
              </div>
            </div>
            {maxMessages !== undefined ? (
              <div className={`${insetTile} hidden flex-1 flex-col gap-1 xl:flex`}>
                <p className="font-serif text-[2.5rem] font-semibold leading-[2.75rem] tabular-nums text-ink">{maxMessages}</p>
                <p className="text-sm font-semibold text-ink">Limit</p>
                <p className="text-[0.75rem] leading-4 text-ink-muted">Emails per sync</p>
              </div>
            ) : null}
          </div>
        ) : null}

        <p className="text-center text-[0.75rem] leading-4 text-ink-muted xl:text-left">
          Read-only. PaperTrail never sends email. This can take a few minutes; keep this tab open.
        </p>
      </div>

      {progress ? (
        <section aria-label="Stage by stage" className="neu-raised hidden flex-col gap-1 rounded-lg p-6 xl:flex">
          <h2 className="pb-2 font-serif text-xl text-ink">Stage by stage</h2>
          <ul>
            {STAGES.map((stage, index) => {
              const status = statusOf(index);
              return (
                <li key={stage.key} className="flex items-center gap-4 border-t border-rule py-3.5 last:pb-0">
                  <p className={`w-24 shrink-0 text-sm font-bold ${status === "pending" ? "text-ink-muted" : "text-ink"}`}>{stage.label}</p>
                  <p className="min-w-0 flex-1 text-sm text-ink-muted">{stageNote(stage.key, progress, redactionOff)}</p>
                  <span className={`neu-inset inline-flex h-6 w-24 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold ${status === "pending" ? "text-ink-muted" : "text-teal-deep"}`}>
                    {STATUS_WORD[status]}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </SyncLayout>
  );
}
