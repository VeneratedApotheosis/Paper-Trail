import { sourceBadgeSummary, type OrderSource } from "@/components/sourceAccounts";

// Small "which mailbox" badge for a purchase (issue #115). Quiet, inset like a Chip, with a tiny envelope. The short
// label sits in the badge; the full address is in the tooltip (`title`) and the screen reader text ("From shopper@example.com").
// `full` writes the whole address (order detail, claim). Renders nothing for demo or uploaded purchases (no sources).
// It is a plain span, never interactive, so it can sit inside the clickable purchase card.
export function SourceBadge({ sources, full = false }: { sources: readonly OrderSource[] | undefined; full?: boolean }) {
  const summary = sourceBadgeSummary(sources ?? [], full);
  if (!summary) return null;
  return (
    <span
      title={summary.title}
      data-testid="source-badge"
      className="neu-inset inline-flex max-w-full items-center gap-1.5 rounded-sm px-2.5 py-0.5 text-label font-semibold text-ink-muted"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="2" />
        <path d="m2.5 4.5 5.5 4.25L13.5 4.5" />
      </svg>
      <span className="sr-only">{summary.accessibleText}</span>
      <span aria-hidden className="truncate">
        {summary.text}
      </span>
    </span>
  );
}
