import { DEMO_LABEL } from "@/lib/mock/data";

// Honest-labelling (scope_features §6): shows on every page in demo mode so no
// synthetic number is ever mistaken for a real one. Shared with demo mode (#4).
export function DemoBanner({ label = DEMO_LABEL }: { label?: string }) {
  return (
    <div className="sticky top-0 z-40 border-b border-deadline/30 bg-deadline-tint/80 backdrop-blur">
      <div className="mx-auto flex max-w-ledger items-center justify-center gap-2 px-4 py-1.5 text-label text-deadline">
        <span aria-hidden>●</span>
        <span className="font-medium uppercase tracking-wide">{label}</span>
      </div>
    </div>
  );
}
