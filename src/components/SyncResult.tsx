import { UploadButton, type SyncMode } from "@/components/SyncPreview";
import { EmptyState } from "@/components/states";
import { SyncLayout, SyncRail, insetTile, mainCard, stepStates } from "@/components/SyncRail";
import { Button } from "@/components/ui/Button";

// Counts from a finished Gmail sync (POST /api/gmail/sync) or file import (POST /api/upload). `scanned` is messages
// fetched (Gmail) or emails read (import); `files` is set for imports; `capped` means Gmail had more matches than
// one run fetches (`maxMessages`).
export interface SyncResultInfo {
  scanned: number;
  files?: number;
  parseErrors: number;
  capped?: boolean;
  maxMessages?: number;
  orders: number;
  needsReview: number;
  findings: number;
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** "Fetched 50 messages (stopped at the 50-message limit)" or "Read 3 emails from 2 files (1 could not be parsed)". */
function scannedSentence(mode: SyncMode, result: SyncResultInfo): string {
  const notes: string[] = [];
  if (mode === "gmail" && result.capped) notes.push(`stopped at the ${result.maxMessages ?? result.scanned}-message limit`);
  if (result.parseErrors > 0) notes.push(`${result.parseErrors} could not be parsed`);
  const aside = notes.length > 0 ? ` (${notes.join("; ")})` : "";
  if (mode === "import") {
    const files = result.files !== undefined ? ` from ${plural(result.files, "file")}` : "";
    return `Read ${plural(result.scanned, "email")}${files}${aside}`;
  }
  return `Fetched ${plural(result.scanned, "message")}${aside}`;
}

function Tile({ value, label, note }: { value: number; label: string; note: string }) {
  return (
    <div className={`${insetTile} flex flex-1 flex-col gap-1`}>
      <p className="font-serif text-[2.5rem] font-semibold leading-[2.75rem] tabular-nums text-ink xl:text-[3.5rem] xl:leading-[3.75rem] xl:tracking-[-0.02em]">{value}</p>
      <p className="text-sm font-semibold text-ink">{label}</p>
      <p className="hidden text-[0.75rem] leading-4 text-ink-muted xl:block">{note}</p>
    </div>
  );
}

// The run produced something the ledger shows (orders or needs-review items). The wrapper usually opens the ledger
// right away; the button covers a slow navigation. Every number is a count from the finished run; "Review the N items"
// shows only when the wrapper gives `onOpenReview`.
export function SyncResult({
  mode,
  result,
  onOpenLedger,
  onOpenReview,
  windowDays,
}: {
  mode: SyncMode;
  result: SyncResultInfo;
  onOpenLedger: () => void;
  onOpenReview?: () => void;
  windowDays?: number;
}) {
  const gmail = mode === "gmail";
  const capped = gmail && result.capped;
  const intro = gmail
    ? `Here is what PaperTrail found in ${windowDays ? `the last ${windowDays} days of ` : ""}your inbox.`
    : `${scannedSentence(mode, result)}.`;

  return (
    <SyncLayout
      mode={mode}
      title={gmail ? "Sync finished" : "Import finished"}
      intro={intro}
      rail={
        <SyncRail
          states={stepStates("result")}
          windowDays={windowDays}
          maxMessages={gmail ? result.maxMessages : undefined}
          redactionOff={false}
          stepsOnPhone={false}
        />
      }
    >
      <section aria-label="What we found" className={mainCard}>
        <p className="eyebrow">What we found</p>
        <div className="flex flex-col gap-3 xl:gap-4">
          <div className="flex gap-3 xl:gap-4">
            <Tile value={result.scanned} label={gmail ? "Emails scanned" : "Emails read"} note="Read in this sync" />
            <Tile value={result.orders} label="Purchases found" note="Added to Purchases" />
          </div>
          <div className="flex gap-3 xl:gap-4">
            <Tile value={result.needsReview} label="Need a quick check" note="Not in what you are owed" />
            <Tile value={result.findings} label="Findings" note="Money you can get back" />
          </div>
        </div>
        {result.needsReview > 0 ? (
          <p className="text-sm text-ink-muted">
            The {result.needsReview} {result.needsReview === 1 ? "item that needs" : "items that need"} a quick check{" "}
            {result.needsReview === 1 ? "is" : "are"} not counted in what you are owed.
          </p>
        ) : null}
        {capped || result.parseErrors > 0 ? (
          <div className="flex flex-col items-start gap-2">
            {capped ? (
              <>
                <span className="neu-inset inline-flex h-6 items-center rounded-full px-3 text-[0.6875rem] font-semibold text-ink-muted">
                  Capped at {result.maxMessages ?? result.scanned} emails
                </span>
                <p className="text-sm text-ink">More emails matched than the limit, so the oldest ones were not read.</p>
              </>
            ) : null}
            {result.parseErrors > 0 ? (
              <p className="text-sm text-ink">{plural(result.parseErrors, "email")} could not be parsed.</p>
            ) : null}
          </div>
        ) : null}
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-4">
          <Button type="button" onClick={onOpenLedger} className="!min-h-[48px] !rounded-full xl:min-w-52">
            Open Owed to you
          </Button>
          {onOpenReview && result.needsReview > 0 ? (
            <Button type="button" variant="secondary" onClick={onOpenReview} className="!min-h-[48px] !rounded-full xl:min-w-48">
              Review the {result.needsReview} {result.needsReview === 1 ? "item" : "items"}
            </Button>
          ) : null}
        </div>
      </section>
    </SyncLayout>
  );
}
// Nothing looked like a purchase. An invitation to act, not a dead end: imports offer another file or the demo;
// Gmail goes back to the preview. Without a result (dev toggle) it shows the wording only, no counts.
export function SyncNoReceipts({
  mode,
  result,
  query,
  onRetry,
  onUpload,
  onTryDemo,
}: {
  mode: SyncMode;
  result?: SyncResultInfo | null;
  query?: string;
  onRetry: () => void;
  onUpload?: (files: FileList) => void;
  onTryDemo?: () => void;
}) {
  const detail = result
    ? `${scannedSentence(mode, result)}, but none looked like a purchase.`
    : "None of the messages looked like a purchase.";
  const actions =
    mode === "import" ? (
      <>
        {onUpload ? <UploadButton onUpload={onUpload} /> : null}
        {onTryDemo ? (
          <Button type="button" variant="secondary" onClick={onTryDemo}>
            Try demo data
          </Button>
        ) : null}
      </>
    ) : (
      <Button type="button" variant="secondary" onClick={onRetry}>
        Back to sync
      </Button>
    );

  return (
    <EmptyState
      title={mode === "gmail" ? "No receipts found in this inbox" : "No receipts found in these files"}
      query={mode === "gmail" ? query : undefined}
      actions={actions}
    >
      {detail}
    </EmptyState>
  );
}
