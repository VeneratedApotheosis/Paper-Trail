import { UploadButton, type SyncMode } from "@/components/SyncPreview";
import { EmptyState } from "@/components/states";
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

function headline(result: SyncResultInfo): string {
  if (result.findings > 0) return `Found ${plural(result.findings, "thing")} worth a look`;
  if (result.orders > 0) return `Added ${plural(result.orders, "order")} to your ledger`;
  return `${plural(result.needsReview, "receipt")} need${result.needsReview === 1 ? "s" : ""} a quick check`;
}

// The run produced something the ledger shows (orders or needs-review items). The wrapper usually opens the ledger
// right away; the button covers a slow navigation.
export function SyncResult({
  mode,
  result,
  onOpenLedger,
}: {
  mode: SyncMode;
  result: SyncResultInfo;
  onOpenLedger: () => void;
}) {
  const review = result.needsReview > 0 ? `, ${result.needsReview} to review` : "";
  return (
    <div className="mx-auto max-w-ledger">
      <div className="neu-raised rounded-xl px-8 py-12 text-center">
        <p className="eyebrow">{mode === "gmail" ? "Sync complete" : "Import complete"}</p>
        <h1 className="mt-2 font-serif text-2xl text-ink">{headline(result)}</h1>
        <p className="mx-auto mt-3 max-w-md text-base text-ink-muted">
          {scannedSentence(mode, result)}. Found {plural(result.orders, "order")}{review}.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button type="button" onClick={onOpenLedger}>
            Open what you&apos;re owed
          </Button>
        </div>
      </div>
    </div>
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
