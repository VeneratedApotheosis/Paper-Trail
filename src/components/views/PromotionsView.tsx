"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Promotion } from "@/lib/contracts";
import { AppShell } from "@/components/AppShell";
import { SourceBadge } from "@/components/SourceBadge";
import { accountLabels, orderSources, type SourceAccount } from "@/components/sourceAccounts";
import { expiryLabel, minSpendNote } from "@/components/promotionExpiry";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { Chip, type ChipTone } from "@/components/ui/Chip";
import { InfoTip } from "@/components/ui/InfoTip";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/SearchSelect";

// Props-only view for the Promotions page (#131): offers read from marketing emails, one card per offer with the store,
// the offer, when it ends and copyable promo codes. Nothing here counts toward what the user is owed. Data and the
// clipboard arrive as props/callbacks; the page wrapper owns fetching and copying.
export interface PromotionsViewProps {
  /** In display order (the API sorts by expiry, soonest first). */
  promotions: Promotion[];
  /** ISO clock the "ends" labels are judged against (GET /api/promotions `asOf`). */
  asOf: string;
  /** Linked Gmail accounts: cards show the mailbox an offer came from, and two or more accounts add an Account filter. */
  accounts?: SourceAccount[];
  showExpired: boolean;
  onShowExpiredChange: (show: boolean) => void;
  /** Expired offers left out of `promotions`; shown on the toggle. */
  expiredHidden: number;
  /** Claude is still reading offer details; the cards fill in as it finishes. */
  enriching?: boolean;
  /** Copies a promo code to the clipboard. Rejecting shows a "couldn't copy" note next to the code. */
  onCopyCode: (code: string) => void | Promise<void>;
}

type ChannelFilter = "all" | "online" | "in_store";
const CHANNEL_LABELS: Record<NonNullable<Promotion["channel"]>, string> = { online: "Online", in_store: "In store", both: "Online and in store" };
const EXPIRY_CHIP_TONE: Record<ReturnType<typeof expiryLabel>["tone"], ChipTone> = {
  urgent: "owed", soon: "deadline", normal: "neutral", none: "neutral", expired: "neutral",
};
const receivedDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function PromotionsView({ promotions, asOf, accounts, showExpired, onShowExpiredChange, expiredHidden, enriching = false, onCopyCode }: PromotionsViewProps) {
  const [store, setStore] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelFilter>("all");
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

  const visible = promotions.filter((promotion) => {
    if (activeStore !== null && promotion.store !== activeStore) return false;
    if (activeAccount !== null && promotion.accountId !== activeAccount) return false;
    if (channel === "online") return promotion.channel === "online" || promotion.channel === "both";
    if (channel === "in_store") return promotion.channel === "in_store" || promotion.channel === "both";
    return true;
  });

  return (
    <AppShell>
      <div className="mb-2 flex flex-wrap items-baseline gap-3">
        <h1 className="font-serif text-3xl text-ink">Promotions</h1>
        <span className="text-sm text-ink-faint">{visible.length} {visible.length === 1 ? "offer" : "offers"}</span>
        <InfoTip label="About promotions" align="start">
          Offers we read from marketing emails: the store, the offer, when it ends and any promo code. They are never counted in what you&apos;re owed.
        </InfoTip>
      </div>
      <p className="mb-6 max-w-prose text-sm text-ink-muted">
        Sorted by when each offer ends. {enriching ? "Claude is still reading some of the details." : ""}
      </p>

      {promotions.length === 0 && !showExpired && expiredHidden === 0 ? (
        <EmptyState title="No active promotions">
          Offers from marketing emails appear here after a sync or an upload, with their promo codes and end dates.
        </EmptyState>
      ) : (
        <>
          <div className="mb-7 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Filter by channel" className="flex flex-wrap gap-2">
                <FilterPill active={channel === "all"} onClick={() => setChannel("all")}>All</FilterPill>
                <FilterPill active={channel === "online"} onClick={() => setChannel("online")}>Online</FilterPill>
                <FilterPill active={channel === "in_store"} onClick={() => setChannel("in_store")}>In store</FilterPill>
              </div>
              {expiredHidden > 0 || showExpired ? (
                <FilterPill active={showExpired} onClick={() => onShowExpiredChange(!showExpired)}>
                  {showExpired ? "Hide expired" : `Show expired (${expiredHidden})`}
                </FilterPill>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-3">
              <SearchSelect label="Store" options={storeOptions} value={activeStore} onChange={setStore} allLabel="All stores"
                allCount={promotions.length} searchPlaceholder="Search stores" emptyText="No stores match" />
              {accountOptions.length > 0 ? (
                <SearchSelect label="Account" options={accountOptions} value={activeAccount} onChange={setAccount} allLabel="All accounts"
                  allCount={promotions.length} searchPlaceholder="Search accounts" emptyText="No accounts match" />
              ) : null}
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState title={promotions.length === 0 ? "No active promotions" : "No matching promotions"}>
              {promotions.length === 0 ? "Every offer we found has ended. Show expired offers to see them." : "No offers match these filters. Try clearing the store, account or channel filter."}
            </EmptyState>
          ) : (
            <ul className="space-y-4">
              {visible.map((promotion) => (
                <li key={promotion.id}>
                  <PromotionCard promotion={promotion} now={now} accounts={linkedAccounts} onCopyCode={onCopyCode} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </AppShell>
  );
}

function PromotionCard({ promotion, now, accounts, onCopyCode }: { promotion: Promotion; now: Date; accounts: SourceAccount[]; onCopyCode: PromotionsViewProps["onCopyCode"] }) {
  const expiry = expiryLabel(promotion.expiresAt, now);
  const note = minSpendNote(promotion.discount, promotion.headline);
  return (
    <article className={`neu-raised rounded-lg p-6 ${expiry.tone === "expired" ? "opacity-70" : ""}`} aria-label={`${promotion.store}: ${promotion.headline}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm font-semibold text-ink-muted">{promotion.store}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={EXPIRY_CHIP_TONE[expiry.tone]}>{expiry.text}</Chip>
          {promotion.channel ? <Chip tone="neutral">{CHANNEL_LABELS[promotion.channel]}</Chip> : null}
        </div>
      </div>
      <h2 className="mt-2 font-serif text-xl text-ink">{promotion.headline}</h2>
      {note ? <p className="mt-1 text-sm text-ink-muted">{note}</p> : null}

      {promotion.codes.length > 0 ? (
        <ul aria-label="Promo codes" className="mt-4 flex flex-wrap gap-3">
          {promotion.codes.map((code) => (
            <li key={code}><CodeChip code={code} onCopy={onCopyCode} /></li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-faint">
        <span>Received {receivedDate(promotion.receivedAt)}{promotion.emailIds.length > 1 ? ` (and ${promotion.emailIds.length - 1} more like it)` : ""}</span>
        <span>{promotion.source === "llm" ? "Details read by Claude" : "Details read by rules"}</span>
        <SourceBadge sources={orderSources(promotion.accountId ? [promotion.accountId] : undefined, accounts)} />
      </div>
    </article>
  );
}

type CopyState = "idle" | "copied" | "failed";

function CodeChip({ code, onCopy }: { code: string; onCopy: PromotionsViewProps["onCopyCode"] }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  async function copy() {
    try {
      await onCopy(code);
      setState("copied");
    } catch {
      setState("failed");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2500);
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code className="neu-inset rounded-sm px-3 py-2 font-mono text-sm font-bold tracking-wide text-ink">{code}</code>
      <Button type="button" variant="secondary" className="px-3 py-2" onClick={copy} aria-label={`Copy code ${code}`}>
        {state === "copied" ? "Copied" : "Copy"}
      </Button>
      <span role="status" className="text-xs text-ink-muted">{state === "failed" ? "Couldn't copy. Select the code and copy it." : ""}</span>
    </span>
  );
}

// A pill that drives a filter choice: teal accent when active, soft raised otherwise (same look as the Purchases filters).
function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-[44px] items-center rounded-sm px-4 py-1.5 text-sm font-bold transition-shadow md:min-h-[36px] ${
        active ? "neu-accent" : "neu-raised-sm text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}