import { DEMO_LABEL } from "@/lib/mock/data";

// Honest-labelling (scope_features §6): shows on every page in demo mode so no
// synthetic number is ever mistaken for a real one. Shared with demo mode (#4).
export function DemoBanner({ label = DEMO_LABEL }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-2">
      <span className="neu-inset inline-flex items-center gap-2 rounded-sm px-3 py-1 text-label font-bold text-ink-muted">
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-teal" />
        {label}
      </span>
    </div>
  );
}
