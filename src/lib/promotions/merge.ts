import type { Promotion } from "@/lib/contracts";

/** Two emails from the same store count as one offer when they arrive within this many days of each other. */
export const DUPLICATE_WINDOW_DAYS = 5;
const WINDOW_MS = DUPLICATE_WINDOW_DAYS * 24 * 3_600_000;

const storeKey = (promotion: Promotion) => (promotion.storeDomain ?? promotion.store).toLowerCase();
const headlineKey = (promotion: Promotion) => promotion.headline.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const received = (promotion: Promotion) => Date.parse(promotion.receivedAt) || 0;

function sameOffer(a: Promotion, b: Promotion): boolean {
  if (storeKey(a) !== storeKey(b) || Math.abs(received(a) - received(b)) > WINDOW_MS) return false;
  const codes = new Set(a.codes.map((code) => code.toLowerCase()));
  if (b.codes.some((code) => codes.has(code.toLowerCase()))) return true;
  return headlineKey(a) !== "" && headlineKey(a) === headlineKey(b);
}

function mergeGroup(group: Promotion[]): Promotion {
  const byTime = [...group].sort((a, b) => received(a) - received(b));
  const newest = byTime.at(-1)!;
  const earliest = byTime[0];
  const codes: string[] = [];
  for (const promotion of [newest, ...byTime.slice().reverse()]) {
    for (const code of promotion.codes) if (!codes.some((known) => known.toLowerCase() === code.toLowerCase())) codes.push(code);
  }
  const latestExpiry = byTime.map((promotion) => promotion.expiresAt).filter((value): value is string => value !== null).sort().at(-1) ?? null;
  return {
    ...newest,
    id: earliest.id,
    emailIds: byTime.flatMap((promotion) => promotion.emailIds),
    codes,
    expiresAt: newest.expiresAt ?? latestExpiry,
    discount: newest.discount ?? byTime.slice().reverse().find((promotion) => promotion.discount)?.discount ?? null,
    channel: newest.channel ?? byTime.slice().reverse().find((promotion) => promotion.channel)?.channel ?? null,
  };
}

/**
 * Collapses the same offer sent twice: same store (domain, else name) and, within five days, a shared promo code or the
 * same headline. The newest email supplies the details and the earliest email's id stays as the id, so the id is stable
 * when a repeat arrives later. Chains merge (A~B, B~C -> one offer).
 */
export function collapsePromotions(promotions: readonly Promotion[]): Promotion[] {
  const groups: Promotion[][] = [];
  for (const promotion of [...promotions].sort((a, b) => received(a) - received(b) || a.id.localeCompare(b.id))) {
    const matching = groups.filter((group) => group.some((member) => sameOffer(member, promotion)));
    if (matching.length === 0) { groups.push([promotion]); continue; }
    const [first, ...rest] = matching;
    first.push(promotion);
    for (const other of rest) { first.push(...other); groups.splice(groups.indexOf(other), 1); }
  }
  return groups.map((group) => (group.length === 1 ? group[0] : mergeGroup(group)));
}
