// Synthetic demo-only promotions: reward points and soon-to-expire offers for the Promotions tab. They are fed to the
// promotion rules alongside the seed marketing emails; they never enter the receipt pipeline, so the seed findings,
// gold labels and eval gate are unchanged. Everything here is fictional; dates are relative to the seed's as-of.
import type { StoredEmailText } from "@/lib/quality/types";

interface DemoPromo { id: string; name: string; domain: string; subject: string; date: string; body: string }

const DEMO_PROMOS: readonly DemoPromo[] = [
  { id: "demo-promo-brewbox-points", name: "Brewbox Rewards", domain: "brewbox.example", date: "2026-10-16T15:00:00Z",
    subject: "Your 1,250 Brew Points expire soon: double points through Oct 19",
    body: "Brewbox Rewards\n\nHi Sam, your 1,250 Brew Points expire on Oct 20. Use them on your next order, and earn double points on every order through Oct 19.\n\nUse code DOUBLEBREW for 10% off your next bag.\n\nShop: https://brewbox.example/rewards" },
  { id: "demo-promo-lumen-points", name: "Lumen Beauty", domain: "lumen-beauty.example", date: "2026-10-17T09:00:00Z",
    subject: "500 bonus points + 15% off: ends tomorrow, Oct 18",
    body: "Lumen Beauty Insider\n\nHi Sam, get 500 bonus points and 15% off your order with code GLOW15. Offer ends Oct 18.\n\nShop: https://lumen-beauty.example/insider" },
  { id: "demo-promo-voltline", name: "Voltline Electronics", domain: "voltline.example", date: "2026-10-15T18:00:00Z",
    subject: "$10 off $50: this week only",
    body: "Voltline\n\nSave $10 off a $50 order with code VOLT10. Ends Oct 19. Online only.\n\nShop: https://voltline.example/deals" },
  { id: "demo-promo-grandmart-points", name: "GrandMart Rewards", domain: "grandmart.example", date: "2026-10-14T12:00:00Z",
    subject: "Triple points weekend in store: ends Oct 18",
    body: "GrandMart Rewards\n\nEarn triple points on every in-store purchase this weekend. Ends Oct 18. 20% off produce with code FRESH20, in store only.\n\nFind a store: https://grandmart.example/stores" },
  { id: "demo-promo-freshcart", name: "FreshCart", domain: "freshcart.example", date: "2026-10-12T10:00:00Z",
    subject: "Free delivery on orders over $35",
    body: "FreshCart\n\nFree delivery on orders over $35 with code FRESHSHIP. Expires Oct 31. Online only.\n\nShop: https://freshcart.example" },
  { id: "demo-promo-oakhaven", name: "Oakhaven Home", domain: "oakhaven.example", date: "2026-10-10T16:00:00Z",
    subject: "25% off cozy season, code COZY25",
    body: "Oakhaven Home\n\nTake 25% off sitewide with code COZY25. Offer ends Oct 24.\n\nShop: https://oakhaven.example/cozy" },
];

/** Synthetic marketing emails shaped like the pipeline's stored texts, ready for `recordSyncPromotions`. */
export function demoPromotionTexts(): StoredEmailText[] {
  return DEMO_PROMOS.map(promo => ({
    emailId: promo.id, fromName: promo.name, fromDomain: promo.domain, subject: promo.subject, date: promo.date,
    text: promo.body, textHash: `demo-${promo.id}`, redactions: {},
    classification: { class: "marketing", confidence: 0.95, reason: "demo promotion" }, outcome: "skipped",
  }));
}