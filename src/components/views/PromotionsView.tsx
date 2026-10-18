"use client";

import { useMemo, useState } from "react";
import type { Promotion } from "@/lib/contracts";
import { AppShell } from "@/components/AppShell";
import { PromotionCard, type CopyCode } from "@/components/PromotionCard";
import { ExpiredSwitch, FilterPill, PromotionSkeletons } from "@/components/PromotionsFilters";
import { PromotionsRail } from "@/components/PromotionsRail";
import { accountLabels, type SourceAccount } from "@/components/sourceAccounts";
import {
  channelCounts, countText, endingSoon, matchesChannel, splitByExpiry, storeRows, type PromotionChannelFilter,
} from "@/components/promotionDisplay";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/SearchSelect";

// Props-only view for the Promotions page (#131, redesigned in #139): offers read from marketing emails, one card per
// offer with the store, the offer, when it ends and copyable promo codes. Single column on phones; from xl a right rail
// shows what ends soonest and the offers per store. Nothing here counts toward what the user is owed. Data and the
// clipboard arrive as props/callbacks; the page wrapper owns fetching and copying.
export interface PromotionsViewProps {
  /** In display order (the API sorts by expiry, soonest first, no end date last). */
  promotions: Promotion[];
  /** ISO clock the "ends" labels are judged against (GET /api/promotions `asOf`). */
  asOf: string;
  /** Linked Gmail accounts: cards show the mailbox an offer came from, and two or more accounts add an Account filter. */
  accounts?: SourceAccount[];
  showExpired: boolean;
  onShowExpiredChange: (show: boolean) => void;
  /** Expired offers left out of `promotions`. Shown in the empty state so the user knows there is more to see. */
  expiredHidden: number;
  /** Claude is still reading offer details; the cards fill in as it finishes. */
  enriching?: boolean;
  /** The first load is still running: shows quiet placeholder cards instead of the list. */
  loading?: boolean;
  /** Copies a promo code to the clipboard. Rejecting shows a "couldn't copy" note next to the code. */
  onCopyCode: (code: string) => void | Promise<void>;
  /** Starts a mailbox sync. The empty state shows a "Sync inbox" button only when this is given. */
  onSyncInbox?: () => void;
}

const SUBTITLE = "Offers and codes found in your receipts and emails. They are not counted in what you are owed.";

export function PromotionsView({
  promotions, asOf, accounts, showExpired, onShowExpiredChange, expiredHidden, enriching = false, loading = false, onCopyCode, onSyncInbox,
}: PromotionsViewProps) {
  const [store, setStore] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [channel, setChannel] = useState<PromotionChannelFilter>("all");
  const now = useMemo(() => new Date(asOf), [asOf]);
  const linkedAccounts = useMemo(() => accounts ?? [], [accounts]);

  const storeOptions = useMemo<SearchSelectOption[]>(() => {
    const counts = new Map<string, number>();
    for (const promotion of promotions) counts.set(promotion.store, (counts.get(promotion.store) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ value: name, label: name, count }));
  }, [promotions]);
  const accountOptions = useMemo<SearchSelectOption[]>(() => {
    if (linkedAccounts.length < 2) return [];
    const labels = accountLabels(linkedAccounts);
    return linkedAccounts.map((linked) => ({
      value: linked.id, label: labels.get(linked.id)!, count: promotions.filter((promotion) => promotion.accountId === linked.id).length,
    }));
  }, [promotions, linkedAccounts]);
  // A refreshed list may drop the chosen store or account; fall back to "all" instead of an empty page.
  const activeStore = storeOptions.some((option) => option.value === store) ? store : null;
  const activeAccount = accountOptions.some((option) => option.value === account) ? account : null;

  // The channel pills count what the store and account filters leave, so each number is what that pill would show.
  const scoped = promotions.filter((promotion) => (
    (activeStore === null || promotion.store === activeStore) && (activeAccount === null || promotion.accountId === activeAccount)
  ));
  const counts = channelCounts(scoped);
  const visible = scoped.filter((promotion) => matchesChannel(promotion, channel));
  const { active, expired } = splitByExpiry(visible, now);
  const filtered = activeStore !== null || activeAccount !== null || channel !== "all";
  const scopeNote = [activeStore, accountOptions.find((option) => option.value === activeAccount)?.label].filter(Boolean).join(", ");

  const ending = useMemo(() => endingSoon(promotions, now), [promotions, now]);
  const stores = useMemo(() => storeRows(promotions, now), [promotions, now]);

  function clearFilters() {
    setStore(null);
    setAccount(null);
    setChannel("all");
  }
  const noCount = loading;
  const shortCount = loading ? "Loading" : countText(visible.length, promotions.length, showExpired, false);
  const longCount = countText(visible.length, promotions.length, showExpired, true);

  return (
    <AppShell>
      {/* data-layout="wide" lets the shell use the full desktop width (#133); below xl it is one column. */}
      <div data-layout="wide" className="mx-auto max-w-ledger xl:max-w-none">
        <header className="mb-4 space-y-1.5 xl:mb-6">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="font-serif text-[34px] leading-[38px] text-ink xl:text-[40px] xl:leading-[44px]">Promotions</h1>
            <span className="text-[13px] leading-[18px] font-semibold text-ink-muted xl:hidden">{shortCount}</span>
          </div>
          <p className="max-w-prose text-[13px] leading-5 text-ink-muted xl:text-[15px] xl:leading-6">{SUBTITLE}</p>
          {enriching && !loading ? <p role="status" className="text-[13px] leading-5 text-ink-muted">Claude is still reading some of the details.</p> : null}
        </header>

        <div className="space-y-6 xl:grid xl:grid-cols-[minmax(0,1fr)_22.5rem] xl:items-start xl:gap-8 xl:space-y-0">
          <div className="min-w-0 space-y-6">
            <div className="hidden items-baseline justify-between gap-4 xl:flex">
              <h2 className="font-serif text-2xl leading-[30px] text-ink">{loading ? "Reading your inbox" : longCount}</h2>
              {scopeNote ? (
                <p className="flex items-baseline gap-3 text-xs text-ink-muted">
                  <span>Showing {scopeNote} only</span>
                  <button type="button" onClick={clearFilters} className="text-[13px] font-bold text-teal-deep">Clear filter</button>
                </p>
              ) : (
                <p className="text-xs text-ink-muted">Sorted by soonest expiry. No end date last.</p>
              )}
            </div>

            <div className="space-y-3 xl:flex xl:flex-wrap xl:items-end xl:gap-4 xl:space-y-0">
              <div role="group" aria-label="Filter by channel" className="-mx-1.5 flex flex-wrap items-center gap-2 px-1.5 py-1 xl:mx-0 xl:py-0">
                <FilterPill active={channel === "all"} onClick={() => setChannel("all")} count={noCount ? undefined : counts.all}>All</FilterPill>
                <FilterPill active={channel === "online"} onClick={() => setChannel("online")} count={noCount ? undefined : counts.online}>Online</FilterPill>
                <FilterPill active={channel === "in_store"} onClick={() => setChannel("in_store")} count={noCount ? undefined : counts.in_store}>In store</FilterPill>
              </div>
              <div className="flex items-end gap-3 xl:ml-auto xl:gap-4">
                <div className="min-w-0 flex-1 xl:flex-none xl:[&_button[aria-haspopup=listbox]]:w-52">
                  <SearchSelect label="Store" options={storeOptions} value={activeStore} onChange={setStore} allLabel="All stores"
                    allCount={noCount ? undefined : promotions.length} searchPlaceholder="Search stores" emptyText="No stores match" />
                </div>
                <ExpiredSwitch on={showExpired} onChange={onShowExpiredChange} />
              </div>
              {accountOptions.length > 0 ? (
                <div className="min-w-0 xl:w-full">
                  <SearchSelect label="Account" options={accountOptions} value={activeAccount} onChange={setAccount} allLabel="All accounts"
                    allCount={promotions.length} searchPlaceholder="Search accounts" emptyText="No accounts match" />
                </div>
              ) : null}
            </div>

            {scopeNote ? (
              <div className="flex min-h-11 items-center justify-between gap-3 xl:hidden">
                <p className="text-[13px] leading-[18px] text-ink-muted">Showing offers from {scopeNote}</p>
                <button type="button" onClick={clearFilters} className="inline-flex h-11 items-center px-1 text-[13px] leading-4 font-bold text-teal-deep">
                  Clear filter
                </button>
              </div>
            ) : null}

            {loading ? (
              <PromotionSkeletons />
            ) : visible.length === 0 ? (
              <EmptyPromotions
                noneAtAll={promotions.length === 0}
                expiredHidden={expiredHidden}
                onShowExpired={() => onShowExpiredChange(true)}
                onSyncInbox={onSyncInbox}
                onClearFilters={clearFilters}
                filtered={filtered}
              />
            ) : (
              <div className="space-y-6">
                {active.length > 0 ? <CardList promotions={active} now={now} accounts={linkedAccounts} onCopyCode={onCopyCode} label="Active offers" /> : null}
                {expired.length > 0 ? (
                  <section aria-label="Expired offers" className="space-y-4 xl:space-y-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="font-serif text-[22px] leading-7 text-ink xl:text-2xl xl:leading-[30px]">Expired</h2>
                      <p className="text-xs text-ink-muted">
                        {expired.length} ended {expired.length === 1 ? "offer" : "offers"}<span className="hidden xl:inline">, kept for reference</span>
                      </p>
                    </div>
                    <CardList promotions={expired} now={now} accounts={linkedAccounts} onCopyCode={onCopyCode} label="Expired offers list" />
                  </section>
                ) : null}
              </div>
            )}
          </div>

          <PromotionsRail ending={ending} stores={stores} activeStore={activeStore} onPickStore={setStore} />
        </div>
      </div>
    </AppShell>
  );
}

function CardList({ promotions, now, accounts, onCopyCode, label }: { promotions: Promotion[]; now: Date; accounts: SourceAccount[]; onCopyCode: CopyCode; label: string }) {
  return (
    <ul aria-label={label} className="anim-stagger space-y-4 xl:space-y-5">
      {promotions.map((promotion) => (
        <li key={promotion.id}>
          <PromotionCard promotion={promotion} now={now} accounts={accounts} onCopyCode={onCopyCode} />
        </li>
      ))}
    </ul>
  );
}

function EmptyPromotions({ noneAtAll, expiredHidden, onShowExpired, onSyncInbox, onClearFilters, filtered }: {
  noneAtAll: boolean; expiredHidden: number; onShowExpired: () => void; onSyncInbox?: () => void; onClearFilters: () => void; filtered: boolean;
}) {
  const raised = "neu-raised-sm inline-flex h-11 items-center justify-center rounded-full px-6 text-[13px] leading-4 font-bold text-teal-deep";
  // On phones the expired link is a plain text button under the accent button; from xl it is a raised pill beside it.
  const textLink = "inline-flex h-11 items-center justify-center rounded-full px-3 text-[13px] leading-4 font-bold text-teal-deep xl:neu-raised-sm xl:px-6";
  return (
    <div className="space-y-4">
      <div className="neu-raised flex flex-col items-center gap-4 rounded-lg px-6 py-8 text-center xl:px-12 xl:py-14">
        <span aria-hidden className="neu-inset flex size-[72px] items-center justify-center rounded-full xl:size-20">
          <svg viewBox="0 0 24 24" className="size-[30px] text-teal-deep xl:size-[34px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round">
            <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7a1 1 0 0 1 .7.3l7.8 7.8a1 1 0 0 1 0 1.4l-7.1 7.1a1 1 0 0 1-1.4 0l-7.8-7.8a1 1 0 0 1-.3-.7z" />
            <circle cx="8.2" cy="8.2" r="1.4" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <h2 className="font-serif text-2xl leading-[30px] text-ink xl:text-[28px] xl:leading-[34px]">
          {noneAtAll ? "No active promotions" : "No matching promotions"}
        </h2>
        <p className="max-w-[26rem] text-[15px] leading-[22px] text-balance text-ink-muted xl:leading-6">
          {noneAtAll
            ? `When a store emails you a code or a deal, it shows up here. Sync your inbox to look again${expiredHidden > 0 ? ", or turn on Show expired to see offers that have ended." : "."}`
            : "No offers match these filters. Try clearing the store, account or channel filter."}
        </p>
        <div className="flex w-full flex-col items-stretch gap-3 pt-1 xl:w-auto xl:flex-row xl:items-center xl:pt-2">
          {noneAtAll && onSyncInbox ? (
            <button type="button" onClick={onSyncInbox} className="neu-accent inline-flex h-12 items-center justify-center rounded-full px-7 text-sm font-bold xl:h-11 xl:text-[13px]">
              Sync inbox
            </button>
          ) : null}
          {noneAtAll && expiredHidden > 0 ? (
            <button type="button" onClick={onShowExpired} className={textLink}>Show expired offers</button>
          ) : null}
          {!noneAtAll && filtered ? <button type="button" onClick={onClearFilters} className={raised}>Clear filters</button> : null}
        </div>
      </div>
      <p className="px-3 text-center text-xs leading-[18px] text-ink-muted xl:hidden">
        Offers are read from your inbox. PaperTrail never sends email, and promotions are not counted in what you are owed.
      </p>
    </div>
  );
}
