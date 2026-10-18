// Pure display helpers for the Promotions view (#131). Times are shown in the viewer's own time zone.

export type ExpiryTone = "urgent" | "soon" | "normal" | "none" | "expired";

export interface ExpiryLabel {
  text: string;
  /** `urgent`: under 24 hours left. `soon`: under a week. */
  tone: ExpiryTone;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const shortDate = (date: Date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Ends tonight", "Ends in 5 hours", "3 days left", "Ends Oct 31", "Ended Oct 15", or "No end date". */
export function expiryLabel(expiresAt: string | null, now: Date): ExpiryLabel {
  if (expiresAt === null) return { text: "No end date", tone: "none" };
  const end = new Date(expiresAt);
  if (Number.isNaN(end.getTime())) return { text: "No end date", tone: "none" };
  const left = end.getTime() - now.getTime();
  if (left <= 0) return { text: `Ended ${shortDate(end)}`, tone: "expired" };
  if (left < DAY_MS) {
    if (sameLocalDay(end, now) && end.getHours() >= 20) return { text: "Ends tonight", tone: "urgent" };
    if (left < HOUR_MS) return { text: "Ends in under an hour", tone: "urgent" };
    const hours = Math.floor(left / HOUR_MS);
    return { text: `Ends in ${hours} ${hours === 1 ? "hour" : "hours"}`, tone: "urgent" };
  }
  const days = Math.ceil(left / DAY_MS);
  if (days <= 7) return { text: `${days} ${days === 1 ? "day" : "days"} left`, tone: "soon" };
  return { text: `Ends ${shortDate(end)}`, tone: "normal" };
}

/** "$10 off a $40 order" needs no help; this adds the part the headline does not say. */
export function minSpendNote(discount: { minSpend: number | null; currency: string | null } | null, headline: string): string | null {
  if (!discount || discount.minSpend === null) return null;
  const amount = discount.minSpend;
  const written = Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
  if (headline.includes(written)) return null;
  return `Minimum spend ${new Intl.NumberFormat("en-US", { style: "currency", currency: discount.currency ?? "USD" }).format(amount)}`;
}