// Validates the synthetic seed (issue #5): contracts, counts, edge-case coverage, and an independent
// re-computation of rules R1-R3 at asOf that must reproduce expected_findings.json exactly.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ExpectedFindingsFileSchema,
  GoldLabelsFileSchema,
  SeedInboxSchema,
  type ExpectedFinding,
} from "@/lib/contracts";
import {
  buildSeed,
  priceObservations,
  SEED_AS_OF,
  SEED_STORES,
  seedOrders,
  type PriceObservation,
} from "./generate-seed";
import { DAY_MS, effectivePolicy, isoDate, money, roundCents, subtotalOf, totalOf, orderSnapshot } from "../seed/templates/render";
import type { SeedItemRef, SeedOrder } from "../seed/templates/types";

const PriceFeedSchema = z.object({
  simulated: z.literal(true),
  observations: z.array(
    z.object({
      merchant: z.string().min(1),
      sku: z.string().min(1),
      name: z.string().min(1),
      price: z.number().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
      observedAt: z.string().datetime({ offset: true }),
    }),
  ),
});

const seed = buildSeed();
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const NOW = Date.parse(SEED_AS_OF);

describe("seed contracts", () => {
  it("buildSeed() output matches the shared Zod schemas", () => {
    expect(SeedInboxSchema.parse(seed.inbox).synthetic).toBe(true);
    ExpectedFindingsFileSchema.parse(seed.expectedFindings);
    GoldLabelsFileSchema.parse(seed.goldLabels);
    PriceFeedSchema.parse(seed.priceFeed);
  });

  it.skipIf(process.env.WRITE_SEED === "1")("committed seed files match the shared Zod schemas", () => {
    const read = (name: string) => JSON.parse(readFileSync(join(repoRoot, "seed", name), "utf8")) as unknown;
    expect(SeedInboxSchema.parse(read("inbox.json")).asOf).toBe("2026-10-17T19:00:00Z");
    expect(ExpectedFindingsFileSchema.parse(read("expected_findings.json")).asOf).toBe(SEED_AS_OF);
    GoldLabelsFileSchema.parse(read("gold_labels.json"));
    expect(PriceFeedSchema.parse(read("price-feed.json")).simulated).toBe(true);
  });
});

describe("seed inbox", () => {
  const emails = seed.inbox.emails;
  const labels = seed.goldLabels.labels;

  it("has 45+ emails with unique ids, sorted by date", () => {
    expect(emails.length).toBeGreaterThanOrEqual(45);
    expect(new Set(emails.map((email) => email.id)).size).toBe(emails.length);
    const dates = emails.map((email) => email.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("covers 8 fictional stores, one per required category, all on .example domains", () => {
    expect(new Set(SEED_STORES.map((store) => store.category))).toEqual(
      new Set(["marketplace", "big_box", "electronics", "apparel", "beauty", "furniture", "grocery", "dtc_subscription"]),
    );
    const orderMerchants = new Set(
      labels.filter((label) => label.class === "order").map((label) => label.fields.merchant),
    );
    expect([...orderMerchants].sort()).toEqual(SEED_STORES.map((store) => store.name).sort());
    for (const store of SEED_STORES) expect(store.domain.endsWith(".example")).toBe(true);
  });

  it("uses only .example email addresses and URLs", () => {
    for (const email of emails) {
      const haystack = `${email.from} ${email.to ?? ""} ${email.text}`;
      for (const [, domain] of haystack.matchAll(/@([a-z0-9.-]+)/gi)) expect(domain).toMatch(/\.example$/);
      for (const [, host] of haystack.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) expect(host).toMatch(/\.example$/);
    }
  });

  it("includes fake PII for redaction tests: Luhn-valid test card numbers, 555-01xx phones, street addresses", () => {
    const panPattern = /\b(?:\d{4} ){3}\d{4}\b/g;
    const pans = emails.flatMap((email) => [...email.text.matchAll(panPattern)].map((match) => match[0]));
    expect(pans.length).toBeGreaterThanOrEqual(3);
    for (const pan of pans) expect(luhnValid(pan.replace(/ /g, ""))).toBe(true);
    const phones = emails.flatMap((email) => [...email.text.matchAll(/\(\d{3}\) 555-(\d{4})/g)].map((m) => m[1]));
    expect(phones.length).toBeGreaterThan(0);
    for (const line of phones) expect(line).toMatch(/^01\d\d$/);
    expect(emails.filter((email) => email.text.includes("742 Larkspur Avenue")).length).toBeGreaterThan(10);
  });

  it("has exactly one gold label per email and 15 holdout emails", () => {
    expect(labels.map((label) => label.emailId)).toEqual(emails.map((email) => email.id));
    expect(labels.filter((label) => label.holdout).length).toBe(15);
  });

  it("tags every required edge case", () => {
    const tags = new Set(labels.flatMap((label) => label.tags));
    for (const tag of [
      "partial_return",
      "split_shipment",
      "store_credit",
      "short_refund",
      "multi_currency",
      "forwarded",
      "non_english",
      "phishing_lookalike",
      "marketing_not_order",
      "duplicate_order",
      "updated_order",
      "final_sale",
      "cancel_before_ship",
    ]) {
      expect(tags, tag).toContain(tag);
    }
  });

  it("never labels the phishing lookalike or promos as orders", () => {
    const risky = labels.filter((label) => label.tags.includes("phishing_lookalike") || label.tags.includes("marketing_not_order"));
    expect(risky.length).toBeGreaterThanOrEqual(3);
    for (const label of risky) expect(["marketing", "not_receipt"]).toContain(label.class);
    const phish = emails.find((email) => email.from.includes("n0rthwind-support.example"));
    expect(phish).toBeDefined();
  });

  it("has an in-inbox promo that mentions a purchased SKU's dropped price", () => {
    const promo = emails.find((email) => email.id === "northwind-promo-fall-markdowns");
    expect(promo?.text).toContain("NW-JKT-RDG");
    expect(promo?.text).toContain("$149.00");
  });

  it("prints gold totals and policy sentences in the order emails", () => {
    const byId = new Map(emails.map((email) => [email.id, email]));
    for (const label of labels.filter((candidate) => candidate.class === "order")) {
      const email = byId.get(label.emailId);
      const fields = label.fields;
      expect(email?.text).toContain(fields.orderRef ?? "missing");
      expect(email?.text).toContain(money(fields.totals?.total ?? -1, fields.currency ?? "USD"));
      if (fields.refundSlaDays) {
        expect(email?.text).toContain(`Refunds are issued within ${fields.refundSlaDays} days of receiving your return.`);
      }
      if (fields.priceAdjustDays) {
        expect(email?.text).toContain(`Price adjustments within ${fields.priceAdjustDays} days of purchase.`);
      }
    }
  });
});

describe("seed orders", () => {
  it("have consistent totals and line items with SKUs", () => {
    for (const order of seedOrders) {
      expect(order.items.length).toBeGreaterThan(0);
      for (const item of order.items) expect(item.sku).toMatch(/^[A-Z]{2}-/);
      const snapshot = orderSnapshot(order);
      expect(totalOf(snapshot)).toBe(roundCents(subtotalOf(order.items) - order.discount + order.shipping + order.tax));
    }
  });
});

describe("expected findings", () => {
  const findings = seed.expectedFindings.findings;

  it("has exactly 4 refund_overdue, 2 refund_short, 5 return_deadline, 3 price_drop", () => {
    const count = (kind: string) => findings.filter((finding) => finding.kind === kind).length;
    expect(count("refund_overdue")).toBe(4);
    expect(count("refund_short")).toBe(2);
    expect(count("return_deadline")).toBe(5);
    expect(count("price_drop")).toBe(3);
    expect(findings.length).toBe(14);
  });

  it("references emails that exist in the inbox", () => {
    const ids = new Set(seed.inbox.emails.map((email) => email.id));
    for (const finding of findings) for (const id of finding.messageIds) expect(ids, id).toContain(id);
  });

  it("is reproduced exactly by an independent implementation of rules R1-R3 at asOf", () => {
    const computed = seedOrders.flatMap((order) => [...ruleR1(order), ...ruleR2(order), ...ruleR3(order, priceObservations)]);
    const key = (finding: Pick<ExpectedFinding, "kind" | "orderRef" | "lineItem">) =>
      `${finding.kind}|${finding.orderRef}|${finding.lineItem ?? ""}`;
    expect(computed.map(key).sort()).toEqual(findings.map(key).sort());
    for (const finding of findings) {
      const match = computed.find((candidate) => key(candidate) === key(finding));
      expect(match?.amountAtStake, key(finding)).toBeCloseTo(finding.amountAtStake, 2);
      expect(match?.dueDate, key(finding)).toBe(finding.dueDate);
      expect(match?.merchant, key(finding)).toBe(finding.merchant);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Independent oracle of the rule semantics agreed for issue #5 (days = 24h UTC periods).
// ---------------------------------------------------------------------------------------------

type OracleFinding = Pick<ExpectedFinding, "kind" | "merchant" | "orderRef" | "lineItem" | "amountAtStake" | "dueDate">;

function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function coversWholeOrder(order: SeedOrder, refs: SeedItemRef[] | undefined): boolean {
  if (!refs) return true;
  return order.items.every((item) => refs.some((ref) => ref.sku === item.sku && ref.qty >= item.qty));
}

function ruleR1(order: SeedOrder): OracleFinding[] {
  const sorted = [...order.emails].sort((a, b) => a.at.localeCompare(b.at));
  const strong = sorted.find((email) => email.kind === "return_received");
  const weak = sorted.find((email) => email.kind === "return_started" || email.kind === "return_dropped");
  const trigger = strong ?? weak;
  if (!trigger) return [];
  const policy = effectivePolicy(order);
  const triggerAt = Date.parse(trigger.at);
  const slaDays = policy.refundSlaDays ?? (strong ? 10 : 14);
  const expectedBy = triggerAt + slaDays * DAY_MS;
  const subtotal = subtotalOf(order.items);
  const expected = coversWholeOrder(order, trigger.items)
    ? totalOf(orderSnapshot(order))
    : (() => {
        const returnedSubtotal = trigger.items!.reduce(
          (sum, ref) => sum + ref.qty * order.items.find((item) => item.sku === ref.sku)!.unitPrice,
          0,
        );
        return roundCents(returnedSubtotal + (order.tax * returnedSubtotal) / subtotal);
      })();
  const match = sorted.find(
    (email) => (email.kind === "refund" || email.kind === "store_credit") && Date.parse(email.at) >= triggerAt,
  );
  const base = { merchant: order.store.name, orderRef: order.orderRef };
  if (!match) {
    return NOW > expectedBy
      ? [{ ...base, kind: "refund_overdue", amountAtStake: expected, dueDate: isoDate(new Date(expectedBy).toISOString()) }]
      : [];
  }
  if (match.kind === "refund") {
    const refunded = match.amount ?? 0;
    if (refunded < expected - Math.max(0.5, 0.02 * expected)) {
      return [{ ...base, kind: "refund_short", amountAtStake: roundCents(expected - refunded) }];
    }
  }
  return [];
}

function ruleR2(order: SeedOrder): OracleFinding[] {
  const policy = effectivePolicy(order);
  const hasReturn = order.emails.some((email) =>
    ["return_started", "return_dropped", "return_received"].includes(email.kind),
  );
  if (hasReturn || policy.finalSaleText) return [];
  const windowDays = policy.returnWindowDays ?? 30;
  const delivered = order.emails.filter((email) => email.kind === "delivered").map((email) => email.at);
  // Split shipments: every delivered date is tried so a control order cannot fire under any anchor choice.
  const anchors = policy.windowAnchor === "delivery" && delivered.length > 0 ? delivered : [order.placedAt];
  const firing = anchors
    .map((anchor) => Date.parse(anchor) + windowDays * DAY_MS)
    .filter((deadline) => deadline - NOW >= 0 && deadline - NOW <= 7 * DAY_MS);
  if (firing.length === 0) return [];
  return [
    {
      kind: "return_deadline",
      merchant: order.store.name,
      orderRef: order.orderRef,
      amountAtStake: totalOf(orderSnapshot(order)),
      dueDate: isoDate(new Date(firing[0]).toISOString()),
    },
  ];
}

function ruleR3(order: SeedOrder, feed: PriceObservation[]): OracleFinding[] {
  const policy = effectivePolicy(order);
  const windowEnd = Date.parse(order.placedAt) + (policy.priceAdjustDays ?? 14) * DAY_MS;
  if (NOW > windowEnd) return [];
  return order.items.flatMap((item): OracleFinding[] => {
    const latest = feed
      .filter((o) => o.merchant === order.store.name && o.sku === item.sku && Date.parse(o.observedAt) <= NOW)
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
      .at(-1);
    if (!latest) return [];
    const drop = roundCents((item.unitPrice - latest.price) * item.qty);
    if (drop < Math.max(5, 0.05 * item.unitPrice * item.qty)) return [];
    return [
      {
        kind: "price_drop",
        merchant: order.store.name,
        orderRef: order.orderRef,
        lineItem: item.name,
        amountAtStake: drop,
        dueDate: isoDate(new Date(windowEnd).toISOString()),
      },
    ];
  });
}
