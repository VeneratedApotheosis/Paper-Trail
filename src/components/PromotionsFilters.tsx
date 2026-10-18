import type { ReactNode } from "react";

// Small controls of the Promotions page (#139): the All / Online / In store pills and the Show expired switch.
// Props-only; the view owns the state.

/** A pill that picks a filter: teal when active, soft raised otherwise. 44px tall on touch screens, 36px from md up. */
export function FilterPill({ active, onClick, count, children }: { active: boolean; onClick: () => void; count?: number; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-[44px] shrink-0 items-center rounded-full px-4 text-[13px] leading-4 font-bold transition-shadow md:min-h-9 ${
        active ? "neu-accent" : "neu-raised-sm font-semibold text-ink-muted hover:text-ink"
      }`}
    >
      {children}
      {count !== undefined ? <>&nbsp;{count}</> : null}
    </button>
  );
}

/** The "Show expired" switch: an inset track with a raised knob; the track turns teal when on. The whole row is the button. */
export function ExpiredSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex h-11 shrink-0 items-center gap-2.5 rounded-full text-[13px] leading-4 font-semibold text-ink xl:h-10"
    >
      <span>Show expired</span>
      <span
        aria-hidden
        className={`neu-inset flex h-[26px] w-11 shrink-0 items-center rounded-full p-[3px] transition-colors ${
          on ? "justify-end !bg-[linear-gradient(135deg,var(--teal-action-start),var(--teal-action-end))]" : "justify-start"
        }`}
      >
        <span className="size-5 rounded-full bg-[linear-gradient(135deg,#e4e9f1,#dbe1ea)] shadow-[3px_3px_6px_rgba(150,162,178,0.7),-2px_-2px_5px_rgba(248,251,255,0.9)]" />
      </span>
    </button>
  );
}

/** Quiet inset shapes shown while the inbox is being read (the same card layout as an offer). */
export function PromotionSkeletons() {
  const bar = "neu-inset rounded-full";
  const cards = [
    { store: "w-[130px]", domain: "w-[90px]", pill: "w-[92px]", head: "w-[250px]", note: "w-[110px]" },
    { store: "w-[110px]", domain: "w-20", pill: "w-[84px]", head: "w-[200px]", note: "w-[130px]" },
    { store: "w-[120px]", domain: "w-[84px]", pill: "w-24", head: "w-[230px]", note: "w-[100px]" },
  ];
  return (
    <div role="status" aria-live="polite" className="space-y-4 xl:space-y-5">
      <p className="text-[13px] leading-[18px] font-semibold text-ink-muted">Reading your inbox for offers</p>
      {cards.map((card, index) => (
        <div key={index} aria-hidden className="neu-raised grid gap-3 rounded-lg p-5 xl:p-6">
          <div className="flex items-center gap-3">
            <span className={`${bar} size-9 shrink-0`} />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className={`${bar} h-3 ${card.store}`} />
              <span className={`${bar} h-2.5 ${card.domain}`} />
            </span>
            <span className={`${bar} h-6 shrink-0 ${card.pill}`} />
          </div>
          <span className={`${bar} h-[22px] max-w-full ${card.head}`} />
          <span className={`${bar} h-3 ${card.note}`} />
          <div className="flex items-center gap-2.5">
            <span className={`${bar} h-11 flex-1`} />
            <span className={`${bar} h-11 w-24 shrink-0`} />
          </div>
          <div className="flex items-center gap-2">
            <span className={`${bar} h-6 w-[60px]`} />
            <span className={`${bar} h-6 w-28`} />
          </div>
        </div>
      ))}
    </div>
  );
}
