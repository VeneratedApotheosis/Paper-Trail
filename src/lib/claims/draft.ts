import { z } from "zod";
import type { Finding, FindingKind, NormalizedLineItem, NormalizedOrder, OrderEvent } from "@/lib/contracts";
import { formatMoney } from "@/lib/format";
import type { PriceDropExplain, RefundExplain, ReturnExplain } from "@/lib/rules";
import type { Draft } from "@/lib/types";

/**
 * Claim draft templates (issue #32, scope_features F2.5). Every amount, date, order ref and policy quote is read
 * from the finding, its explain payload or the order (AGENTS.md hard rule #4); nothing here calls an LLM or sends.
 */

export type ClaimKind = Exclude<FindingKind, "rewards_gap">;

/** One value the body cites, verbatim. Rephrasing must keep every `value` unchanged (see rephrase.ts). */
export type ClaimFact = { label: string; value: string };

/** Draft view-model (src/lib/types.ts) plus the provenance the claim sheet and the rephrase check need. */
export interface ClaimDraft extends Draft {
  kind: ClaimKind;
  /** False when the recipient is guessed from the merchant domain (or unknown). */
  recipientVerified: boolean;
  facts: ClaimFact[];
  /** Shown to the user next to the draft; never part of the email. */
  warnings: string[];
  /** One-line hint for the user; never part of the email. */
  note?: string;
}

export type ClaimDraftErrorReason = "unsupported_kind" | "order_mismatch" | "invalid_finding";

export type ClaimDraftResult =
  | { ok: true; draft: ClaimDraft }
  | { ok: false; reason: ClaimDraftErrorReason; message: string };

export type DraftClaimOptions = {
  /** Connected Google account name; used when the receipt has no customer name. */
  profileName?: string;
  /** Known merchant support address; otherwise `support@<merchant domain>` is guessed. */
  supportEmail?: string;
  /** Used only to warn when a claim deadline has already passed. */
  now?: Date;
};

export const SIMULATED_PRICE_WARNING =
  "Price comes from a simulated feed; verify the current price before sending.";
export const RETURN_ON_SITE_NOTE =
  "Many stores let you start a return on their website, which can be faster than emailing.";

/** Closing appended to every body; rephrase.ts strips it so the customer's name never reaches the LLM. */
export function claimClosing(signedName: string): string {
  return `\n\nThank you,\n${signedName}`;
}

const RefundExplainFieldsSchema: z.ZodType<
  Pick<RefundExplain, "triggerAt" | "expectedBy" | "expectedAmount" | "refundedAmount">
> = z.object({
  triggerAt: z.string().datetime({ offset: true }),
  expectedBy: z.string().datetime({ offset: true }),
  expectedAmount: z.number().nonnegative(),
  refundedAmount: z.number().nonnegative().optional(),
});

const ReturnExplainFieldsSchema: z.ZodType<Pick<ReturnExplain, "deadline">> = z.object({
  deadline: z.string().datetime({ offset: true }),
});

const PriceDropExplainFieldsSchema: z.ZodType<
  Pick<PriceDropExplain, "paidUnitPrice" | "currentPrice" | "qty" | "drop" | "adjustBy">
> = z.object({
  paidUnitPrice: z.number().nonnegative(),
  currentPrice: z.number().nonnegative(),
  qty: z.number().int().positive(),
  drop: z.number().nonnegative(),
  adjustBy: z.string().datetime({ offset: true }),
});

const claimDateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Rule dates are UTC instants; render the UTC calendar date so drafts never shift with the server time zone. */
export function formatClaimDate(iso: string): string {
  return claimDateFormat.format(new Date(iso));
}

const TRIGGER_SENTENCES: Partial<Record<OrderEvent["type"], string>> = {
  return_received: "Your team received my return on",
  return_dropped: "I dropped off my return on",
  return_started: "I started my return on",
};

/** Collects facts while building sentences, so every cited value is listed exactly once as it appears. */
class FactList {
  readonly facts: ClaimFact[] = [];

  cite(label: string, value: string): string {
    if (!this.facts.some((fact) => fact.value === value)) this.facts.push({ label, value });
    return value;
  }
}

type DraftParts = {
  subject: string;
  paragraphs: string[];
  warnings: string[];
  note?: string;
};

type TemplateContext = {
  finding: Finding;
  order: NormalizedOrder;
  now: Date;
  facts: FactList;
  money: (amount: number) => string;
  /** "order NW-1001" or, without a ref, "my Northwind order"; cites the ref as a fact. */
  orderPhrase: string;
  /** Short subject suffix: "order NW-1001" or "Northwind order of Sep 1, 2026". */
  orderSubject: string;
  placedOn: string;
};

type TemplateResult = DraftParts | { error: string };

function policyQuoteParagraph(ctx: TemplateContext): string[] {
  const quote = ctx.order.merchant.policy.policyQuote;
  return quote ? [`Your policy states: "${ctx.facts.cite("Policy quote", quote)}"`] : [];
}

function deadlinePassedWarning(ctx: TemplateContext, deadlineIso: string, what: string): string[] {
  return ctx.now.getTime() > Date.parse(deadlineIso)
    ? [`The ${what} (${formatClaimDate(deadlineIso)}) has passed; the merchant may decline this request.`]
    : [];
}

function refundOverdue(ctx: TemplateContext): TemplateResult {
  const parsed = RefundExplainFieldsSchema.safeParse(ctx.finding.explain);
  if (!parsed.success) return { error: "refund explain payload is missing triggerAt/expectedBy/expectedAmount" };
  const explain = parsed.data;
  const { facts } = ctx;
  const trigger = ctx.order.events.find((event) => Date.parse(event.at) === Date.parse(explain.triggerAt));
  const triggerSentence = (trigger && TRIGGER_SENTENCES[trigger.type]) ?? "My return is dated";
  const triggerDate = facts.cite("Return date", formatClaimDate(explain.triggerAt));
  const expected = facts.cite("Expected refund", ctx.money(explain.expectedAmount));
  const expectedBy = facts.cite("Refund expected by", formatClaimDate(explain.expectedBy));
  return {
    subject: `Refund not yet received for ${ctx.orderSubject}`,
    paragraphs: [
      `I'm writing about ${ctx.orderPhrase}, placed on ${ctx.placedOn}. ${triggerSentence} ${triggerDate}.`,
      `I expected a refund of ${expected} by ${expectedBy}, but I have not received it yet.`,
      ...policyQuoteParagraph(ctx),
      "Could you please check the status of this refund and let me know when it will be processed?",
    ],
    warnings: [],
  };
}

function refundShort(ctx: TemplateContext): TemplateResult {
  const parsed = RefundExplainFieldsSchema.safeParse(ctx.finding.explain);
  if (!parsed.success || parsed.data.refundedAmount === undefined) {
    return { error: "refund_short explain payload is missing expectedAmount/refundedAmount" };
  }
  const { facts } = ctx;
  const expected = facts.cite("Expected refund", ctx.money(parsed.data.expectedAmount));
  const refunded = facts.cite("Refunded so far", ctx.money(parsed.data.refundedAmount));
  const remaining = facts.cite("Remaining amount", ctx.money(ctx.finding.amountAtStake));
  return {
    subject: `Partial refund for ${ctx.orderSubject}`,
    paragraphs: [
      `I'm writing about the refund for ${ctx.orderPhrase}, placed on ${ctx.placedOn}.`,
      `I expected a refund of ${expected} for my return, but I have received ${refunded} so far, ` +
        `which is ${remaining} less than expected.`,
      ...policyQuoteParagraph(ctx),
      `Could you please review this and refund the remaining ${remaining}?`,
    ],
    warnings: [],
  };
}

function itemLabel(item: NormalizedLineItem, qty: number): string {
  return qty > 1 ? `${qty} × ${item.name}` : item.name;
}

function joinItems(labels: string[]): string {
  if (labels.length <= 2) return labels.join(" and ");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

function returnDeadline(ctx: TemplateContext): TemplateResult {
  const parsed = ReturnExplainFieldsSchema.safeParse(ctx.finding.explain);
  if (!parsed.success) return { error: "return_deadline explain payload is missing deadline" };
  const { facts } = ctx;
  const heldItems = ctx.order.lineItems
    .map((item) => ({ item, qty: item.qty - item.returnedQty }))
    .filter(({ qty }) => qty > 0)
    .map(({ item, qty }) => itemLabel(item, qty));
  const items = heldItems.length > 0 ? `: ${facts.cite("Items", joinItems(heldItems))}` : "";
  const deadline = facts.cite("Return by", formatClaimDate(parsed.data.deadline));
  return {
    subject: `Return request for ${ctx.orderSubject}`,
    paragraphs: [
      `I would like to return the following from ${ctx.orderPhrase}, placed on ${ctx.placedOn}${items}.`,
      `The return window for this order closes on ${deadline}, so I'm requesting the return before then.`,
      "Could you please send me a return authorization or shipping label, along with any instructions?",
    ],
    warnings: deadlinePassedWarning(ctx, parsed.data.deadline, "return window"),
    note: RETURN_ON_SITE_NOTE,
  };
}

function priceDrop(ctx: TemplateContext): TemplateResult {
  const parsed = PriceDropExplainFieldsSchema.safeParse(ctx.finding.explain);
  if (!parsed.success) return { error: "price_drop explain payload is missing price fields" };
  const item = ctx.order.lineItems.find((lineItem) => lineItem.id === ctx.finding.lineItemId);
  if (!item) return { error: `line item ${ctx.finding.lineItemId ?? "(none)"} is not on the order` };
  const explain = parsed.data;
  const { facts } = ctx;
  const itemText = facts.cite("Item", itemLabel(item, explain.qty));
  const paid = facts.cite("Paid", ctx.money(explain.paidUnitPrice));
  const current = facts.cite("Current price", ctx.money(explain.currentPrice));
  const difference = facts.cite("Difference", ctx.money(explain.drop));
  const adjustBy = facts.cite("Adjustment window ends", formatClaimDate(explain.adjustBy));
  const each = explain.qty > 1 ? " each" : "";
  return {
    subject: `Price adjustment request for ${ctx.orderSubject}`,
    paragraphs: [
      `In ${ctx.orderPhrase}, placed on ${ctx.placedOn}, I paid ${paid}${each} for ${itemText}.`,
      `It is now listed at ${current}${each}, a difference of ${difference}. ` +
        `I'm requesting a price adjustment before the adjustment window ends on ${adjustBy}.`,
      ...policyQuoteParagraph(ctx),
      `Could you please refund the difference of ${difference} to my original payment method?`,
    ],
    warnings: [
      ...deadlinePassedWarning(ctx, explain.adjustBy, "price adjustment window"),
      ...(ctx.finding.simulated ? [SIMULATED_PRICE_WARNING] : []),
    ],
  };
}

const TEMPLATES: Record<ClaimKind, (ctx: TemplateContext) => TemplateResult> = {
  refund_overdue: refundOverdue,
  refund_short: refundShort,
  return_deadline: returnDeadline,
  price_drop: priceDrop,
};

function isClaimKind(kind: FindingKind): kind is ClaimKind {
  return kind in TEMPLATES;
}

function nonBlank(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveRecipient(
  order: NormalizedOrder,
  supportEmail: string | undefined,
): { recipient: string; recipientVerified: boolean; warnings: string[] } {
  const known = nonBlank(supportEmail);
  if (known) return { recipient: known, recipientVerified: true, warnings: [] };
  const domain = nonBlank(order.merchant.domain);
  if (!domain) {
    return {
      recipient: "",
      recipientVerified: false,
      warnings: [`No support address is known for ${order.merchant.name}; add the recipient before sending.`],
    };
  }
  const recipient = `support@${domain}`;
  return {
    recipient,
    recipientVerified: false,
    warnings: [`${recipient} is a guess based on the merchant's domain; confirm the support address before sending.`],
  };
}

/**
 * Builds the claim email for one finding from a fixed per-kind template. rewards_gap has no claim template and
 * returns `{ ok: false, reason: "unsupported_kind" }`. Signed with order.customerName ?? opts.profileName ?? "Customer".
 */
export function draftClaim(
  finding: Finding,
  order: NormalizedOrder,
  opts: DraftClaimOptions = {},
): ClaimDraftResult {
  if (!isClaimKind(finding.kind)) {
    return {
      ok: false,
      reason: "unsupported_kind",
      message: `Claim drafts are not supported for ${finding.kind} findings.`,
    };
  }
  if (finding.orderId !== order.id) {
    return {
      ok: false,
      reason: "order_mismatch",
      message: `Finding ${finding.id} belongs to order ${finding.orderId}, not ${order.id}.`,
    };
  }

  const facts = new FactList();
  const orderRef = nonBlank(order.orderRef);
  const orderPhrase = orderRef ? `order ${facts.cite("Order ref", orderRef)}` : `my ${order.merchant.name} order`;
  const placedOn = facts.cite("Order date", formatClaimDate(order.placedAt));
  const ctx: TemplateContext = {
    finding,
    order,
    now: opts.now ?? new Date(),
    facts,
    money: (amount) => formatMoney(amount, finding.currency),
    orderPhrase,
    orderSubject: orderRef ? `order ${orderRef}` : `${order.merchant.name} order of ${placedOn}`,
    placedOn,
  };
  const parts = TEMPLATES[finding.kind](ctx);
  if ("error" in parts) {
    return { ok: false, reason: "invalid_finding", message: `Cannot draft ${finding.id}: ${parts.error}.` };
  }

  const knownName = (value: string | null | undefined) => {
    const name = nonBlank(value);
    return name && !/\[(?:NAME|EMAIL|ADDRESS)_\d+\]/i.test(name) ? name : undefined;
  };
  const signedName = knownName(order.customerName) ?? knownName(opts.profileName) ?? "Customer";
  const recipient = resolveRecipient(order, opts.supportEmail);
  const greeting = `Hello ${order.merchant.name} support team,`;
  const body = [greeting, ...parts.paragraphs].join("\n\n") + claimClosing(signedName);

  return {
    ok: true,
    draft: {
      id: `draft:${finding.id}`,
      findingId: finding.id,
      kind: finding.kind,
      subject: parts.subject,
      body,
      recipient: recipient.recipient,
      recipientVerified: recipient.recipientVerified,
      signedName,
      facts: facts.facts,
      warnings: [...recipient.warnings, ...parts.warnings],
      ...(parts.note ? { note: parts.note } : {}),
    },
  };
}
