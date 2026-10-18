import type { Promotion } from "@/lib/contracts";
import { expiryLabel } from "@/components/promotionExpiry";

// Pure display helpers for the Promotions view (#139): which offers count as expired, per-filter counts, the right-rail
// lists and the short lines on each card. Nothing here touches money owed; promotions are never part of that total.

const DAY_MS = 24 * 3_600_000;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export type PromotionChannelFilter = "all" | "online" | "in_store";

export function isExpired(promotion: Promotion, now: Date): boolean {
  return expiryLabel(promotion.expiresAt, now).tone === "expired";
}

/** Active offers keep the given (soonest expiry first) order; expired offers are listed after them. */
export function splitByExpiry(promotions: readonly Promotion[], now: Date): { active: Promotion[]; expired: Promotion[] } {
  const active: Promotion[] = [];
  const expired: Promotion[] = [];
  for (const promotion of promotions) (isExpired(promotion, now) ? expired : active).push(promotion);
  return { active, expired };
}

export function matchesChannel(promotion: Promotion, channel: PromotionChannelFilter): boolean {
  if (channel === "online") return promotion.channel === "online" || promotion.channel === "both";
  if (channel === "in_store") return promotion.channel === "in_store" || promotion.channel === "both";
  return true;
}

/** Numbers on the All / Online / In store pills. An offer for both channels counts for each. */
export function channelCounts(promotions: readonly Promotion[]): Record<PromotionChannelFilter, number> {
  return {
    all: promotions.length,
    online: promotions.filter((promotion) => matchesChannel(promotion, "online")).length,
    in_store: promotions.filter((promotion) => matchesChannel(promotion, "in_store")).length,
  };
}

/** "Minimum spend $40" or "No minimum spend". Nothing when the offer has no parsed discount (we do not know). */
export function minSpendLine(discount: Promotion["discount"]): string | null {
  if (!discount) return null;
  if (discount.minSpend === null) return "No minimum spend";
  const amount = discount.minSpend;
  const written = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: discount.currency ?? "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  }).format(amount);
  return `Minimum spend ${written}`;
}

/** What to show where a promo code would be, when the offer has none. */
export function noCodeLine(promotion: Promotion, expired: boolean): string {
  if (promotion.discount?.kind === "free_shipping") return expired ? "No code was needed" : "No code needed. Applied at checkout.";
  return "No code found in the email";
}

export interface EndingSoonItem {
  id: string;
  store: string;
  headline: string;
  /** "OCT" and the day number for the date tile. */
  month: string;
  day: number;
  /** "Tonight", "Today", "1 day", "3 days". */
  chip: string;
  urgent: boolean;
}

/** The next few active offers that have an end date, soonest first. */
export function endingSoon(promotions: readonly Promotion[], now: Date, limit = 4): EndingSoonItem[] {
  return promotions
    .filter((promotion) => promotion.expiresAt !== null && !isExpired(promotion, now))
    .sort((a, b) => new Date(a.expiresAt!).getTime() - new Date(b.expiresAt!).getTime())
    .slice(0, limit)
    .map((promotion) => {
      const end = new Date(promotion.expiresAt!);
      const label = expiryLabel(promotion.expiresAt, now);
      const days = Math.ceil((end.getTime() - now.getTime()) / DAY_MS);
      const chip = label.tone === "urgent" ? (label.text === "Ends tonight" ? "Tonight" : "Today") : `${days} ${days === 1 ? "day" : "days"}`;
      return {
        id: promotion.id, store: promotion.store, headline: promotion.headline,
        month: MONTHS[end.getMonth()], day: end.getDate(), chip, urgent: label.tone === "urgent",
      };
    });
}

export interface StoreRow {
  store: string;
  /** Active offers from this store; 0 means every offer we have from it has ended. */
  active: number;
}

/** One row per store: stores with active offers first (A to Z), then stores with only expired offers. */
export function storeRows(promotions: readonly Promotion[], now: Date): StoreRow[] {
  const counts = new Map<string, number>();
  for (const promotion of promotions) {
    counts.set(promotion.store, (counts.get(promotion.store) ?? 0) + (isExpired(promotion, now) ? 0 : 1));
  }
  return [...counts]
    .map(([store, active]) => ({ store, active }))
    .sort((a, b) => Number(b.active > 0) - Number(a.active > 0) || a.store.localeCompare(b.store));
}

/** Header count: "5 active", "1 of 5 active", "7 shown", "1 of 7 shown". */
export function countText(shown: number, total: number, showingExpired: boolean, long: boolean): string {
  const noun = long ? (showingExpired ? "offers shown" : "active offers") : showingExpired ? "shown" : "active";
  return shown === total ? `${total} ${noun}` : `${shown} of ${total} ${noun}`;
}
