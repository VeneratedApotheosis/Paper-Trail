"use client";

import { useId, useState } from "react";
import { Button, LinkButton } from "@/components/ui/Button";
import { SyncLayout, SyncRail, mainCard, stepStates } from "@/components/SyncRail";

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

const LOOK_FOR = [
  "Order confirmations",
  "Shipping and delivery",
  "Returns started",
  "Returns received",
  "Refunds",
  "Price adjustments",
  "Invoices",
];

const pill = "!min-h-[48px] !rounded-full";

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
  const [showSearch, setShowSearch] = useState(false);
  const panelId = useId();

  const reading = gmail
    ? `Last ${preview.windowDays} days${preview.maxMessages !== undefined ? `, up to ${preview.maxMessages} emails` : ""}`
    : `Receipts from the last ${preview.windowDays} days`;

  const intro = gmail
    ? `PaperTrail reads receipt emails to find money you are owed. Nothing is sent from your account.${redactionOff ? " Redaction is off, so the full receipt text goes to the AI." : ""}`
    : `Gmail is not connected. Import receipt emails as .eml or .mbox files, or load the synthetic demo inbox. ${redactionOff ? "Receipt text is sent to the AI as is (redaction is off)." : "Each email is redacted before any AI call."}`;

  return (
    <SyncLayout
      mode={mode}
      title={gmail ? "Check your inbox" : "Import receipts or try the demo"}
      intro={intro}
      rail={
        <SyncRail
          states={stepStates("preview")}
          windowDays={preview.windowDays}
          maxMessages={gmail ? preview.maxMessages : undefined}
          redactionOff={redactionOff}
          stepsOnPhone
        />
      }
    >
      <section aria-label="What we will read" className={mainCard}>
        <p className="eyebrow">What we will read</p>
        <div className="space-y-2">
          <p className="font-serif text-[1.75rem] leading-[2.125rem] tracking-[-0.01em] text-ink xl:text-[2.5rem] xl:leading-[3rem]">
            {reading}
          </p>
          <p className="text-base text-ink-muted">
            We only open emails that look like orders, shipping notices, returns, refunds or invoices. Everything
            else in your inbox stays unread.
          </p>
          {gmail && preview.messagesToFetch !== undefined ? (
            <p className="text-sm text-ink-muted">
              Messages to fetch:{" "}
              <span className="font-semibold tabular-nums text-ink">{preview.messagesToFetch}</span>
              {preview.estimatedMessages !== undefined
                ? ` of ${preview.countIsEstimate ? "about " : ""}${preview.estimatedMessages} matching`
                : " matching"}
            </p>
          ) : null}
        </div>

        <div className="space-y-3">
          <button
            type="button"
            role="switch"
            aria-checked={showSearch}
            aria-controls={panelId}
            onClick={() => setShowSearch((open) => !open)}
            className="neu-inset flex min-h-[44px] w-full items-center justify-between gap-3 rounded-md px-4 py-2 text-left text-sm font-semibold text-ink xl:min-h-[52px] xl:px-5"
          >
            Show the search
            <span
              aria-hidden="true"
              className={`flex h-[1.625rem] w-11 shrink-0 items-center rounded-full px-[3px] transition-colors ${
                showSearch ? "justify-end bg-gradient-to-br from-teal to-teal-deep" : "neu-inset"
              }`}
            >
              <span className="size-5 rounded-full bg-paper shadow-[2px_2px_5px_rgba(176,188,206,0.9),-2px_-2px_5px_rgba(248,251,255,0.95)]" />
            </span>
          </button>
          <div id={panelId} hidden={!showSearch} className="neu-inset space-y-2.5 rounded-md p-4 xl:p-5">
            <p className="text-[0.75rem] leading-4 text-ink-muted">
              {preview.description ??
                `The search PaperTrail runs in Gmail. It lists emails first${
                  gmail && preview.maxMessages !== undefined ? `, then opens up to ${preview.maxMessages}` : ""
                }.`}
            </p>
            <code className="block break-words font-mono text-[0.75rem] leading-5 text-ink">{preview.query}</code>
          </div>
        </div>

        {gmail ? (
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-4">
            <Button type="button" onClick={onStart} className={`${pill} xl:w-52`}>
              Start sync
            </Button>
            <p className="text-center text-[0.75rem] leading-4 text-ink-muted xl:text-left">
              Read-only. PaperTrail never sends email.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 xl:flex-row xl:flex-wrap xl:items-center">
            {onUpload ? <UploadButton onUpload={onUpload} /> : null}
            {onTryDemo ? (
              <Button type="button" variant="secondary" onClick={onTryDemo} className={pill}>
                Try demo data
              </Button>
            ) : null}
            <LinkButton href="/connect" variant="ghost" className={pill}>
              Connect Gmail
            </LinkButton>
          </div>
        )}
      </section>

      <section aria-label="Emails we look for" className="neu-raised hidden flex-col gap-4 rounded-lg p-6 xl:flex">
        <h2 className="font-serif text-xl text-ink">Emails we look for</h2>
        <ul className="flex flex-wrap gap-2.5">
          {LOOK_FOR.map((label) => (
            <li key={label} className="neu-inset inline-flex h-6 items-center rounded-full px-3 text-[0.6875rem] font-semibold text-ink-muted">
              {label}
            </li>
          ))}
        </ul>
        <p className="text-sm text-ink-muted">
          Newsletters, personal mail and anything that does not look like a receipt are skipped.
        </p>
      </section>
    </SyncLayout>
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
      className={`${uploadButtonClass[variant]} inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-bold transition-[box-shadow,transform] active:scale-[0.99] focus-within:shadow-inset`}
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
