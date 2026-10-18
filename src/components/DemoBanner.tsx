// Honest-labelling (scope_features §6): shows on every page in demo mode so no
// synthetic number is ever mistaken for a real one. Props-only: the labels and
// the leave-demo action arrive from the shell (no @/lib/mock import).
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
    <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-2">
      <span className="neu-inset inline-flex items-center gap-2 rounded-sm px-3 py-1 text-label font-bold text-ink-muted">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-teal" />
        {label}
      </span>
      {precomputedExtractionLabel ? (
        <span className="text-label text-ink-faint">{precomputedExtractionLabel}</span>
      ) : null}
      {onLeaveDemo ? (
        <button
          type="button"
          onClick={onLeaveDemo}
          className="rounded-sm px-3 py-1 text-label font-bold text-teal-deep transition-shadow hover:shadow-inset-sm"
        >
          Leave demo
        </button>
      ) : null}
    </div>
  );
}
