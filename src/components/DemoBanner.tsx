import { InfoTip } from "@/components/ui/InfoTip";

// Honest-labelling (scope_features §6): shows on every page in demo mode so no
// synthetic number is ever mistaken for a real one. Props-only: the labels and
// the leave-demo action arrive from the shell (no @/lib/mock import).
// One compact row at every width. The long "precomputed extractions" note stays
// visible from `sm` and sits behind an info tip on phones so the strip never wraps.
export function DemoBanner({
  label,
  precomputedExtractionLabel,
  onLeaveDemo,
}: {
  label: string;
  precomputedExtractionLabel?: string;
  onLeaveDemo?: () => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-1 md:py-2">
      <span className="neu-inset inline-flex min-w-0 items-center gap-2 rounded-sm px-3 py-1 text-label font-bold text-ink-muted">
        <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
        <span className="truncate">{label}</span>
      </span>
      {precomputedExtractionLabel ? (
        <>
          <span className="hidden text-label text-ink-faint sm:inline">{precomputedExtractionLabel}</span>
          <span className="sm:hidden">
            <InfoTip label="How was this demo data read?" align="end">
              {precomputedExtractionLabel}
            </InfoTip>
          </span>
        </>
      ) : null}
      {onLeaveDemo ? (
        <button
          type="button"
          onClick={onLeaveDemo}
          className="inline-flex min-h-[44px] shrink-0 items-center rounded-sm px-3 py-1 text-label font-bold text-teal-deep transition-shadow hover:shadow-inset-sm md:min-h-[32px]"
        >
          Leave demo
        </button>
      ) : null}
    </div>
  );
}