import type { Promotion } from "@/lib/contracts";
import type { PromotionsViewProps } from "../PromotionsView";

/** Synthetic sample props for the Promotions view (#131): fictional stores on reserved .example domains. */
// Built from local-time dates so the labels ("Ends tonight", "4 days left") read the same in every time zone.
const local = (month: number, day: number, hour = 23, minute = 59) => new Date(2026, month - 1, day, hour, minute).toISOString();
export const PROMOTIONS_FIXTURE_NOW = local(10, 17, 15, 0);

const base = { accountId: undefined, storeDomain: null, discount: null, codes: [], expiresAt: null, channel: null, source: "rules" as const, confidence: 0.7 };

export const promotionsFixture: Promotion[] = [
  { ...base, id: "p1", emailIds: ["p1"], store: "Lumen Beauty", storeDomain: "lumenbeauty.example", receivedAt: "2026-10-17T13:00:00.000Z",
    headline: "$10 off a $40 pickup order", discount: { kind: "amount", value: 10, currency: "USD", minSpend: 40 },
    expiresAt: local(10, 17), channel: "in_store" },
  { ...base, id: "p2", emailIds: ["p2", "p5"], store: "Northwind Outfitters", storeDomain: "northwind.example", receivedAt: "2026-10-16T09:00:00.000Z",
    headline: "20% off everything", discount: { kind: "percent", value: 20, currency: null, minSpend: null },
    codes: ["FALL20", "FALLEXTRA"], expiresAt: local(10, 20), channel: "online", source: "llm", confidence: 0.92 },
  { ...base, id: "p3", emailIds: ["p3"], store: "Oakhaven Home", storeDomain: "oakhaven.example", receivedAt: "2026-10-12T09:00:00.000Z",
    headline: "Free shipping on orders over $50", discount: { kind: "free_shipping", value: null, currency: "USD", minSpend: 50 } },
  { ...base, id: "p4", emailIds: ["p4"], store: "Lumen Beauty", storeDomain: "lumenbeauty.example", receivedAt: "2026-10-01T09:00:00.000Z",
    headline: "15% off your next order", discount: { kind: "percent", value: 15, currency: null, minSpend: null },
    codes: ["WELCOME15"], expiresAt: local(10, 10), channel: "both" },
];

export const promotionsViewFixture: PromotionsViewProps = {
  promotions: promotionsFixture.slice(0, 3),
  asOf: PROMOTIONS_FIXTURE_NOW,
  showExpired: false,
  onShowExpiredChange: () => undefined,
  expiredHidden: 1,
  onCopyCode: () => undefined,
};