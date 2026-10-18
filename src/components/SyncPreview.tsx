import { Button, LinkButton } from "@/components/ui/Button";

// What a sync or import will read, shown before anything runs (issue #25, criterion 1). Every value comes from the
// wrapper (GET /api/gmail/preview when Gmail is connected, GET /api/prefilter otherwise); nothing is simulated.
export interface SyncPreviewInfo {
  query: string;
  description?: string;
  windowDays: number;
  estimatedMessages?: number;
  messagesToFetch?: number;
  maxMessages?: number;
  countIsEstimate?: boolean;
  /** PAPERTRAIL_REDACT (#125): decides whether the copy says receipts are redacted before the AI reads them. Omitted = on. */
  redaction?: "on" | "off";
}

export type SyncMode = "gmail" | "import";

export function SyncPreview({
  mode,
  preview,
  onStart,
  onUpload,
  onTryDemo,
}: {
  mode: SyncMode;
  preview: SyncPreviewInfo;
  onStart: () => void;
  onUpload?: (files: FileList) => void;
  onTryDemo?: () => void;
}) {
  const gmail = mode === "gmail";
  const redactionOff = preview.redaction === "off";

  return (
    <div className="mx-auto max-w-ledger space-y-6">
      <header className="space-y-2">
        <p className="eyebrow">{gmail ? "Sync now" : "Import receipts"}</p>
        <h1 className="font-serif text-3xl text-ink">
          {gmail ? "Check your inbox for new receipts" : "Import receipts or try the demo"}
        </h1>
        <p className="max-w-md text-base text-ink-muted">
          {gmail
            ? `PaperTrail reads only receipt-like email, ${redactionOff ? "sends the full receipt text to the AI (redaction is off)" : "redacts it before any AI call"}, and never sends or changes a thing. Here is exactly what this run will do.`
            : `Gmail is not connected. Import receipt emails as .eml or .mbox files, or load the synthetic demo inbox. ${redactionOff ? "Receipt text is sent to the AI as is (redaction is off)." : "Each email is redacted before any AI call."}`}
        </p>
      </header>

      <section className="neu-raised space-y-6 rounded-xl px-7 py-7">
        <div className="space-y-2">
          <p className="eyebrow">Gmail query</p>
          <code className="neu-inset block rounded-lg px-4 py-3 text-sm text-ink-muted">{preview.query}</code>
          {preview.description ? <p className="text-sm text-ink-muted">{preview.description}</p> : null}
        </div>
        <div className="flex flex-col gap-5 sm:flex-row sm:gap-10">
          {gmail && preview.messagesToFetch !== undefined ? (
            <div className="space-y-1">
              <p className="eyebrow">Messages to fetch</p>
              <p className="text-sm text-ink-muted">
                <span className="font-serif text-xl tabular-nums text-ink">{preview.messagesToFetch}</span>
                {preview.estimatedMessages !== undefined
                  ? ` of ${preview.countIsEstimate ? "about " : ""}${preview.estimatedMessages} matching`
                  : " matching"}
              </p>
            </div>
          ) : null}
          <div className="space-y-1">
            <p className="eyebrow">{gmail ? "Sync limit" : "Search window"}</p>
            <p className="text-sm text-ink-muted">
              Last {preview.windowDays} days
              {gmail && preview.maxMessages !== undefined ? `, up to ${preview.maxMessages} messages per run` : ""}
            </p>
          </div>
        </div>
      </section>

      {gmail ? (
        <div className="flex flex-wrap items-center gap-4">
          <Button type="button" onClick={onStart}>
            Start sync
          </Button>
          <p className="text-sm text-ink-faint">Read only. Nothing is sent, moved, or deleted.</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {onUpload ? <UploadButton onUpload={onUpload} /> : null}
          {onTryDemo ? (
            <Button type="button" variant="secondary" onClick={onTryDemo}>
              Try demo data
            </Button>
          ) : null}
          <LinkButton href="/connect" variant="ghost">
            Connect Gmail
          </LinkButton>
        </div>
      )}
    </div>
  );
}

const uploadButtonClass = {
  primary: "neu-accent",
  secondary: "neu-raised-sm text-teal-deep",
} as const;

// File import control: a labelled, keyboard-reachable control that hands the chosen .eml/.mbox files to the wrapper
// via onUpload. Styled to match Button; the native input is visually hidden but still focusable. The input is cleared
// after each pick so the same file can be chosen again (the wrapper copies the FileList synchronously).
export function UploadButton({
  onUpload,
  variant = "primary",
}: {
  onUpload: (files: FileList) => void;
  variant?: keyof typeof uploadButtonClass;
}) {
  return (
    <label
      className={`${uploadButtonClass[variant]} inline-flex cursor-pointer items-center justify-center gap-2 rounded-lg px-5 py-3 text-sm font-bold transition-[box-shadow,transform] active:scale-[0.99] focus-within:shadow-inset`}
    >
      Import .eml / .mbox
      <input
        type="file"
        accept=".eml,.mbox,message/rfc822"
        multiple
        className="sr-only"
        onChange={(event) => {
          const input = event.currentTarget;
          if (input.files && input.files.length > 0) onUpload(input.files);
          input.value = "";
        }}
      />
    </label>
  );
}
