// End-to-end over the synthetic seed: gold labels -> extractions -> matchOrders -> runRules at asOf must reproduce
// seed/expected_findings.json exactly (issue #8; expectations from issue #5).
import { describe, expect, it } from "vitest";
import {
  ExpectedFindingsFileSchema,
  GoldLabelsFileSchema,
  NormalizedOrderSchema,
  SeedInboxSchema,
  type ExpectedFinding,
  type Finding,
  type NormalizedOrder,
} from "@/lib/contracts";
import { matchOrders } from "@/lib/orders/matcher";
import { PriceFeedSchema } from "@/lib/prices/feed";
import { defaultRules, runRules } from "@/lib/rules";
import expectedJson from "../../../seed/expected_findings.json";
import goldJson from "../../../seed/gold_labels.json";
import inboxJson from "../../../seed/inbox.json";
import priceFeedJson from "../../../seed/price-feed.json";
import { extractionFromGoldLabel } from "./gold";

const inbox = SeedInboxSchema.parse(inboxJson);
const gold = GoldLabelsFileSchema.parse(goldJson);
const expected = ExpectedFindingsFileSchema.parse(expectedJson);
const priceFeed = PriceFeedSchema.parse(priceFeedJson);

const labelsById = new Map(gold.labels.map((label) => [label.emailId, label]));
const inputs = inbox.emails.map((email) => {
  const label = labelsById.get(email.id);
  if (!label) throw new Error(`No gold label for ${email.id}`);
  return { email, extraction: extractionFromGoldLabel(email, label) };
});
const orders = matchOrders(inputs);
const findings = runRules(orders, defaultRules, { now: new Date(inbox.asOf), priceFeed });
const orderById = new Map(orders.map((order) => [order.id, order]));

function describeFinding(finding: Finding): string {
  const order = orderById.get(finding.orderId);
  const item = order?.lineItems.find((candidate) => candidate.id === finding.lineItemId);
  return `${finding.kind}|${order?.merchant.name}|${order?.orderRef}|${item?.name ?? ""}`;
}

function matches(finding: Finding, want: ExpectedFinding): boolean {
  const order = orderById.get(finding.orderId);
  if (!order || finding.kind !== want.kind) return false;
  if (order.merchant.name !== want.merchant || order.orderRef !== want.orderRef) return false;
  if (want.lineItem !== undefined) {
    const item = order.lineItems.find((candidate) => candidate.id === finding.lineItemId);
    if (item?.name !== want.lineItem) return false;
  }
  return true;
}

function orderByRef(orderRef: string): NormalizedOrder | undefined {
  return orders.find((order) => order.orderRef === orderRef);
}

describe("seed pipeline (gold extractions -> matchOrders -> runRules)", () => {
  it("builds one valid order per seed order and none from marketing or phishing", () => {
    for (const order of orders) NormalizedOrderSchema.parse(order);
    const orderRefs = new Set(gold.labels.filter((l) => l.class === "order").map((l) => l.fields.orderRef));
    expect(orders.map((order) => order.orderRef).sort()).toEqual([...orderRefs].sort());
    const ignored = gold.labels.filter((l) => l.class === "marketing" || l.class === "not_receipt");
    const used = new Set(orders.flatMap((order) => order.messageIds));
    for (const label of ignored) expect(used.has(label.emailId), label.emailId).toBe(false);
    expect(orders.every((order) => !order.needsReview)).toBe(true);
  });

  it("merges the duplicate and updated confirmations of BZ-114-5523301 (latest wins)", () => {
    const order = orderByRef("BZ-114-5523301");
    expect(order?.messageIds).toHaveLength(3);
    expect(order?.lineItems).toHaveLength(1);
    expect(order?.lineItems[0].qty).toBe(1);
    expect(order?.total).toBeCloseTo(21.64, 2);
  });

  it("keeps both shipments of the split OH-11590 order on one timeline", () => {
    const types = orderByRef("OH-11590")?.events.map((event) => event.type);
    expect(types).toEqual(["placed", "shipped", "delivered", "shipped", "delivered"]);
  });

  it("produces the expected count of findings per kind", () => {
    const count = (list: { kind: string }[], kind: string) => list.filter((f) => f.kind === kind).length;
    for (const kind of ["refund_overdue", "refund_short", "return_deadline", "price_drop"]) {
      expect(count(findings, kind), kind).toBe(count(expected.findings, kind));
    }
    expect(findings).toHaveLength(expected.findings.length);
  });

  describe.each(expected.findings.map((want) => [`${want.kind} ${want.orderRef} ${want.lineItem ?? ""}`, want] as const))(
    "expected %s",
    (_label, want) => {
      it("has a matching finding with the expected amount and due date", () => {
        const actual = findings.filter((finding) => matches(finding, want));
        expect(actual, findings.map(describeFinding).join("\n")).toHaveLength(1);
        expect(actual[0].amountAtStake).toBeCloseTo(want.amountAtStake, 2);
        if (want.dueDate) expect(actual[0].dueAt?.slice(0, 10)).toBe(want.dueDate);
      });
    },
  );

  it("has no findings beyond expected_findings.json", () => {
    const extra = findings.filter((finding) => !expected.findings.some((want) => matches(finding, want)));
    expect(extra.map(describeFinding)).toEqual([]);
  });
});
