import type { EndingSoonItem, StoreRow } from "@/components/promotionDisplay";

// Right rail of the Promotions page (xl and up, #139): what ends soonest, how many offers each store has, and the
// reminder that offers are never part of the owed total. Props-only; picking a store is a callback.
export interface PromotionsRailProps {
  ending: EndingSoonItem[];
  stores: StoreRow[];
  /** The store the list is filtered to, if any. */
  activeStore: string | null;
  onPickStore: (store: string | null) => void;
}

export function PromotionsRail({ ending, stores, activeStore, onPickStore }: PromotionsRailProps) {
  return (
    <aside aria-label="Promotion summary" className="hidden space-y-5 xl:block">
      <section aria-label="Ending soon" className="neu-raised space-y-3.5 rounded-lg p-6">
        <h2 className="font-serif text-xl leading-[26px] text-ink">Ending soon</h2>
        {ending.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing is ending soon. Offers with an end date show up here, soonest first.</p>
        ) : (
          <ul className="space-y-3.5">
            {ending.map((item) => (
              <li key={item.id} className="flex items-center gap-3.5">
                <span className="neu-inset flex h-[52px] w-12 shrink-0 flex-col items-center justify-center rounded-[14px]">
                  <span className="text-[11px] leading-3 tracking-[0.08em] text-ink-muted">{item.month}</span>
                  <span className="font-serif text-xl leading-6 text-ink">{item.day}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{item.store}</span>
                  <span className="block truncate text-xs text-ink-muted">{item.headline}</span>
                </span>
                <span className={`neu-inset flex h-6 w-[68px] shrink-0 items-center justify-center rounded-full text-[11px] leading-[14px] ${item.urgent ? "font-bold text-teal-deep" : "font-semibold text-ink-muted"}`}>
                  {item.chip}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="By store" className="neu-raised rounded-lg p-6">
        <h2 className="pb-2 font-serif text-xl leading-[26px] text-ink">By store</h2>
        {stores.length === 0 ? (
          <p className="text-sm text-ink-muted">No stores yet. Each store with an offer is counted here.</p>
        ) : (
          <ul className="space-y-1.5">
            {stores.map(({ store, active }) => {
              const selected = store === activeStore;
              return (
                <li key={store}>
                  <button
                    type="button"
                    onClick={() => onPickStore(selected ? null : store)}
                    aria-pressed={selected}
                    className={`flex h-9 w-full items-center justify-between gap-3 rounded-full px-3 text-left text-sm transition-shadow -mx-3 w-[calc(100%+1.5rem)] ${selected ? "neu-inset font-semibold text-teal-deep" : "text-ink"}`}
                  >
                    <span className="truncate">{store}</span>
                    <span className="neu-inset flex h-6 min-w-8 shrink-0 items-center justify-center rounded-full px-2 text-[11px] font-semibold leading-[14px] text-ink-muted">
                      {active > 0 ? active : "Expired"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label="Not part of your total" className="neu-raised space-y-3.5 rounded-lg p-6">
        <h2 className="font-serif text-xl leading-[26px] text-ink">Not part of your total</h2>
        <p className="neu-inset rounded px-4 py-3.5 text-sm font-semibold text-ink">Promotions are not counted in what you are owed.</p>
        <p className="text-sm text-ink-muted">
          They are offers from stores, not money you can get back. Copy a code and use it yourself. PaperTrail never sends email.
        </p>
      </section>
    </aside>
  );
}
