import { describe, expect, it } from "vitest";
import type { Finding } from "@/lib/contracts";
import { makeOrder } from "@/lib/rules/test-helpers";
import { draftClaim, RETURN_ON_SITE_NOTE, SIMULATED_PRICE_WARNING, type ClaimDraft } from "./draft";
import {
  POLICY_QUOTE,
  priceDropFixture,
  refundOverdueFixture,
  refundShortFixture,
  returnDeadlineFixture,
  rewardsGapFixture,
  SIMULATED_FEED,
  type ClaimFixture,
} from "./test-fixtures";

const GUESSED_RECIPIENT_WARNING =
  "support@northwind.example is a guess based on the merchant's domain; confirm the support address before sending.";

function draftOf({ finding, order, now }: ClaimFixture, opts: Parameters<typeof draftClaim>[2] = {}): ClaimDraft {
  const result = draftClaim(finding, order, { now, ...opts });
  if (!result.ok) throw new Error(`expected a draft, got ${result.reason}: ${result.message}`);
  return result.draft;
}

function expectFactsInBody(draft: ClaimDraft) {
  for (const fact of draft.facts) expect(draft.body).toContain(fact.value);
}

describe("draftClaim templates", () => {
  it("refund_overdue cites ref, return date, expected amount and date, and the policy quote", () => {
    const fixture = refundOverdueFixture();
    const draft = draftOf(fixture);

    expect(draft).toMatchObject({
      id: "draft:refund_overdue:ord-1",
      findingId: "refund_overdue:ord-1",
      kind: "refund_overdue",
      subject: "Refund not yet received for order NW-1001",
      recipient: "support@northwind.example",
      recipientVerified: false,
      signedName: "Sam Synthetic",
    });
    expect(draft.body).toBe(
      [
        "Hello Northwind Outfitters support team,",
        "I'm writing about order NW-1001, placed on Sep 1, 2026. Your team received my return on Sep 20, 2026.",
        "I expected a refund of $113.00 by Sep 30, 2026, but I have not received it yet.",
        `Your policy states: "${POLICY_QUOTE}"`,
        "Could you please check the status of this refund and let me know when it will be processed?",
        "Thank you,\nSam Synthetic",
      ].join("\n\n"),
    );
    expect(draft.facts).toEqual([
      { label: "Order ref", value: "NW-1001" },
      { label: "Order date", value: "Sep 1, 2026" },
      { label: "Return date", value: "Sep 20, 2026" },
      { label: "Expected refund", value: "$113.00" },
      { label: "Refund expected by", value: "Sep 30, 2026" },
      { label: "Policy quote", value: POLICY_QUOTE },
    ]);
    expect(fixture.finding.amountAtStake).toBe(113);
    expectFactsInBody(draft);
  });

  it("refund_short cites expected vs refunded and asks for the difference", () => {
    const fixture = refundShortFixture();
    const draft = draftOf(fixture);

    expect(draft.subject).toBe("Partial refund for order NW-1001");
    expect(draft.body).toBe(
      [
        "Hello Northwind Outfitters support team,",
        "I'm writing about the refund for order NW-1001, placed on Sep 1, 2026.",
        "I expected a refund of $86.40 for my return, but I have received $60.00 so far, which is $26.40 less than expected.",
        "Could you please review this and refund the remaining $26.40?",
        "Thank you,\nSam Synthetic",
      ].join("\n\n"),
    );
    expect(draft.facts.map((fact) => fact.value)).toEqual(["NW-1001", "Sep 1, 2026", "$86.40", "$60.00", "$26.40"]);
    expect(fixture.finding.amountAtStake).toBe(26.4);
    expectFactsInBody(draft);
  });

  it("return_deadline lists held items and the deadline, with the on-site note outside the email", () => {
    const draft = draftOf(returnDeadlineFixture());

    expect(draft.subject).toBe("Return request for order NW-1001");
    expect(draft.body).toBe(
      [
        "Hello Northwind Outfitters support team,",
        "I would like to return the following from order NW-1001, placed on Sep 1, 2026: Rain Jacket and 2 × Wool Socks.",
        "The return window for this order closes on Oct 5, 2026, so I'm requesting the return before then.",
        "Could you please send me a return authorization or shipping label, along with any instructions?",
        "Thank you,\nSam Synthetic",
      ].join("\n\n"),
    );
    expect(draft.note).toBe(RETURN_ON_SITE_NOTE);
    expect(draft.body).not.toContain(RETURN_ON_SITE_NOTE);
    expect(draft.warnings).toEqual([GUESSED_RECIPIENT_WARNING]);
    expectFactsInBody(draft);
  });

  it("return_deadline warns when the window has already closed", () => {
    const draft = draftOf(returnDeadlineFixture(), { now: new Date("2026-10-06T00:00:00.000Z") });
    expect(draft.warnings).toContain(
      "The return window (Oct 5, 2026) has passed; the merchant may decline this request.",
    );
  });

  it("price_drop cites item, paid, current, difference, window end and policy quote, with the simulated warning", () => {
    const fixture = priceDropFixture();
    const draft = draftOf(fixture);

    expect(fixture.finding.simulated).toBe(true);
    expect(draft.id).toBe("draft:price_drop:ord-1:li-jacket");
    expect(draft.subject).toBe("Price adjustment request for order NW-1001");
    expect(draft.body).toBe(
      [
        "Hello Northwind Outfitters support team,",
        "In order NW-1001, placed on Sep 1, 2026, I paid $80.00 for Rain Jacket.",
        "It is now listed at $65.00, a difference of $15.00. I'm requesting a price adjustment before the adjustment window ends on Sep 15, 2026.",
        'Your policy states: "We match our own lower prices within 14 days of purchase."',
        "Could you please refund the difference of $15.00 to my original payment method?",
        "Thank you,\nSam Synthetic",
      ].join("\n\n"),
    );
    expect(draft.warnings).toEqual([GUESSED_RECIPIENT_WARNING, SIMULATED_PRICE_WARNING]);
    expectFactsInBody(draft);
  });

  it("price_drop from a non-simulated source has no simulated warning", () => {
    const promoFeed = {
      simulated: false,
      observations: SIMULATED_FEED.observations.map((observation) => ({ ...observation, source: "email_promo" as const })),
    };
    const fixture = priceDropFixture(promoFeed);
    expect(fixture.finding.simulated).toBe(false);
    expect(draftOf(fixture).warnings).not.toContain(SIMULATED_PRICE_WARNING);
  });

  it("rewards_gap returns a not-supported error result", () => {
    const { finding, order } = rewardsGapFixture();
    expect(draftClaim(finding, order)).toEqual({
      ok: false,
      reason: "unsupported_kind",
      message: "Claim drafts are not supported for rewards_gap findings.",
    });
  });

  it("rejects a finding for a different order and a finding without the explain values it needs", () => {
    const { finding, order } = refundOverdueFixture();
    expect(draftClaim(finding, { ...order, id: "ord-2" })).toMatchObject({ ok: false, reason: "order_mismatch" });
    const stripped: Finding = { ...finding, explain: { rule: "refund_overdue" } };
    expect(draftClaim(stripped, order)).toMatchObject({ ok: false, reason: "invalid_finding" });
  });

  it("describes the order by merchant and date when it has no order ref", () => {
    const fixture = returnDeadlineFixture();
    const draft = draftOf({ ...fixture, order: { ...fixture.order, orderRef: null } });
    expect(draft.subject).toBe("Return request for Northwind Outfitters order of Sep 1, 2026");
    expect(draft.body).toContain("from my Northwind Outfitters order, placed on Sep 1, 2026:");
    expect(draft.facts.some((fact) => fact.label === "Order ref")).toBe(false);
  });
});

describe("draftClaim signature and recipient", () => {
  it("signs with customerName, then profileName, then 'Customer'", () => {
    const fixture = refundOverdueFixture();
    const withName = draftOf(fixture, { profileName: "Profile Person" });
    expect(withName.signedName).toBe("Sam Synthetic");

    const noCustomer = { ...fixture, order: { ...fixture.order, customerName: null } };
    const fromProfile = draftOf(noCustomer, { profileName: "Profile Person" });
    expect(fromProfile.signedName).toBe("Profile Person");
    expect(fromProfile.body.endsWith("Thank you,\nProfile Person")).toBe(true);

    expect(draftOf(noCustomer).signedName).toBe("Customer");
    expect(draftOf({ ...fixture, order: { ...fixture.order, customerName: "[NAME_1]" } }).signedName).toBe("Customer");
    expect(draftOf({ ...fixture, order: { ...fixture.order, customerName: "  " } }).signedName).toBe("Customer");
  });

  it("uses a provided support address as verified, with no recipient warning", () => {
    const draft = draftOf(refundOverdueFixture(), { supportEmail: "help@northwind.example" });
    expect(draft.recipient).toBe("help@northwind.example");
    expect(draft.recipientVerified).toBe(true);
    expect(draft.warnings).toEqual([]);
  });

  it("guesses support@<domain> unverified with a warning, or leaves it empty without a domain", () => {
    const guessed = draftOf(refundOverdueFixture());
    expect(guessed.recipient).toBe("support@northwind.example");
    expect(guessed.recipientVerified).toBe(false);
    expect(guessed.warnings).toEqual([GUESSED_RECIPIENT_WARNING]);

    const fixture = refundOverdueFixture();
    const order = makeOrder({ ...fixture.order, merchant: { ...fixture.order.merchant, domain: null } });
    const unknown = draftOf({ ...fixture, order });
    expect(unknown.recipient).toBe("");
    expect(unknown.recipientVerified).toBe(false);
    expect(unknown.warnings).toEqual([
      "No support address is known for Northwind Outfitters; add the recipient before sending.",
    ]);
  });
});
