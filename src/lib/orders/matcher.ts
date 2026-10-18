import {
  NormalizedOrderSchema,
  REVIEW_CONFIDENCE_THRESHOLD,
  type EmailClass,
  type Extraction,
  type ExtractedLineItem,
  type MerchantPolicy,
  type NormalizedLineItem,
  type NormalizedOrder,
  type OrderEvent,
  type OrderEventType,
  type RawEmail,
} from "@/lib/contracts";
import { roundCents } from "@/lib/rules/money";

/** One classified + extracted email, the matcher's input unit. */
export interface MatchInput {
  email: RawEmail;
  extraction: Extraction;
}

export interface MatchOptions {
  /** Max distance between a ref-less email's date and an existing order's placedAt for the fallback match. */
  fallbackMaxDays?: number;
}

export interface MatchResult {
  orders: NormalizedOrder[];
  /**
   * Order id -> why the matcher flagged it for review, for problems the order itself cannot explain later
   * (negative/invalid amounts, non-ISO dates). Orders flagged only for low confidence, a missing confirmation or
   * currency have no entry.
   */
  reviewReasons: Map<string, string[]>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FALLBACK_MAX_DAYS = 3;
/** Classes that never create or join an order (promos, phishing, account notices). */
const IGNORED_CLASSES: readonly EmailClass[] = ["marketing", "not_receipt"];
const RETURN_EVENT_TYPES: readonly OrderEventType[] = ["return_started", "return_dropped", "return_received"];
const DELIVERY_ANCHOR_PATTERN = /\b(?:of|after|from) delivery\b|a la entrega/i;
const FINAL_SALE_PATTERN = /final sale|non-returnable|cannot be returned/i;
const DROP_OFF_PATTERN = /\bdropped off\b/i;

interface OrderGroup {
  merchantKey: string;
  /** Normalized order ref, null for groups built by the fallback match. */
  refKey: string | null;
  inputs: MatchInput[];
}

/**
 * Groups extracted emails into normalized orders (issue #8, scope_features F1.5). Pure and deterministic.
 *
 * - marketing / not_receipt emails are ignored.
 * - Emails group by normalized merchant (name, else domain) + order ref (case-insensitive).
 * - Emails without an order ref join the same-merchant order whose total is within max($0.50, 2%) and whose
 *   placedAt is within 3 days; otherwise they form their own order.
 * - The latest order confirmation wins for totals and line items; duplicate lifecycle emails produce one event.
 * - Orders with no order confirmation, no currency, or confMin < REVIEW_CONFIDENCE_THRESHOLD need review.
 * - Orders with a negative or non-finite amount, or an email date that is not ISO 8601, need review (see
 *   matchOrdersWithReasons for the reasons).
 */
export function matchOrders(inputs: readonly MatchInput[], opts: MatchOptions = {}): NormalizedOrder[] {
  return matchOrdersWithReasons(inputs, opts).orders;
}

/** matchOrders plus the matcher's review reasons per order id. */
export function matchOrdersWithReasons(inputs: readonly MatchInput[], opts: MatchOptions = {}): MatchResult {
  const fallbackMaxDays = opts.fallbackMaxDays ?? DEFAULT_FALLBACK_MAX_DAYS;
  const relevant = [...inputs]
    .filter((input) => !IGNORED_CLASSES.includes(input.extraction.class))
    .sort(compareInputs);
  const merchantKeyOf = buildMerchantKeyResolver(relevant);

  const groups = new Map<string, OrderGroup>();
  const refless: MatchInput[] = [];
  for (const input of relevant) {
    const refKey = normalizeRef(input.extraction.fields.orderRef);
    if (refKey === null) {
      refless.push(input);
      continue;
    }
    const merchantKey = merchantKeyOf(input);
    const key = `${merchantKey}|${refKey}`;
    const group = groups.get(key) ?? { merchantKey, refKey, inputs: [] };
    group.inputs.push(input);
    groups.set(key, group);
  }

  for (const input of refless) {
    const merchantKey = merchantKeyOf(input);
    const match = findFallbackGroup([...groups.values()], merchantKey, input, fallbackMaxDays);
    if (match) {
      match.inputs.push(input);
    } else {
      groups.set(`${merchantKey}|email:${input.email.id}`, { merchantKey, refKey: null, inputs: [input] });
    }
  }

  const built = [...groups.values()].map((group) => buildOrder(group));
  const reviewReasons = new Map<string, string[]>();
  for (const { order, reasons } of built) {
    if (reasons.length > 0) reviewReasons.set(order.id, reasons);
  }
  const orders = built
    .map(({ order }) => order)
    .sort((a, b) => a.placedAt.localeCompare(b.placedAt) || a.id.localeCompare(b.id));
  return { orders, reviewReasons };
}

function compareInputs(a: MatchInput, b: MatchInput): number {
  return Date.parse(a.email.date) - Date.parse(b.email.date) || a.email.id.localeCompare(b.email.id);
}

/** Lowercase, non-alphanumerics collapsed to "-". */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeRef(orderRef: string | null): string | null {
  if (orderRef == null) return null;
  const key = slugify(orderRef.replace(/^#/, ""));
  return key === "" ? null : key;
}

function normalizeDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const normalized = domain.trim().toLowerCase().replace(/^www\./, "");
  return normalized === "" ? null : normalized;
}

/**
 * Merchant key = slug of the extracted merchant name. Emails with only a domain use the name key seen with that
 * domain elsewhere in the inbox, else the domain's first label.
 */
function buildMerchantKeyResolver(inputs: readonly MatchInput[]): (input: MatchInput) => string {
  const nameKeyByDomain = new Map<string, string>();
  for (const { extraction } of inputs) {
    const domain = normalizeDomain(extraction.fields.merchantDomain);
    const name = extraction.fields.merchant;
    if (domain && name && slugify(name) !== "" && !nameKeyByDomain.has(domain)) {
      nameKeyByDomain.set(domain, slugify(name));
    }
  }
  return ({ extraction }) => {
    const name = extraction.fields.merchant;
    if (name && slugify(name) !== "") return slugify(name);
    const domain = normalizeDomain(extraction.fields.merchantDomain);
    if (domain) return nameKeyByDomain.get(domain) ?? slugify(domain.split(".")[0]);
    return "unknown-merchant";
  };
}

function withinTotalTolerance(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.5, 0.02 * Math.max(a, b)) + 1e-9;
}

function inputAmount(input: MatchInput): number | null {
  const fields = input.extraction.fields;
  return fields.totals.total ?? fields.eventAmount ?? null;
}

function findFallbackGroup(
  groups: readonly OrderGroup[],
  merchantKey: string,
  input: MatchInput,
  maxDays: number,
): OrderGroup | null {
  const amount = inputAmount(input);
  if (amount == null) return null;
  const at = Date.parse(resolveEventAt(input));
  let best: { group: OrderGroup; distance: number } | null = null;
  for (const group of groups) {
    if (group.merchantKey !== merchantKey) continue;
    const primary = primaryConfirmation(group.inputs) ?? group.inputs[0];
    const groupTotal = inputAmount(primary);
    if (groupTotal == null || !withinTotalTolerance(amount, groupTotal)) continue;
    const distance = Math.abs(at - Date.parse(resolvePlacedAt(group.inputs)));
    if (distance > maxDays * DAY_MS) continue;
    if (!best || distance < best.distance) best = { group, distance };
  }
  return best?.group ?? null;
}

function isConfirmation(input: MatchInput): boolean {
  return input.extraction.class === "order";
}

/** Latest order confirmation by email date (inputs are already sorted ascending). */
function primaryConfirmation(inputs: readonly MatchInput[]): MatchInput | null {
  const confirmations = [...inputs].sort(compareInputs).filter(isConfirmation);
  return confirmations.at(-1) ?? null;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** ISO 8601 / RFC 3339 datetime: date, `T` or space, hh:mm[:ss[.fff]], optional `Z` or ±hh[:]mm offset. */
const ISO_DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}:?\d{2})?$/i;
/** Confidence given to an extracted date that is not ISO 8601 (below REVIEW_CONFIDENCE_THRESHOLD: needs review). */
const NON_ISO_DATE_CONFIDENCE = 0.5;

type ParsedExtractedDate = { kind: "date"; day: string } | { kind: "datetime"; iso: string };

/**
 * Parses an extracted date without ever using the server's local time zone: offset-less datetimes are UTC.
 * Returns null for anything that is not a valid ISO 8601 date or datetime.
 */
function parseExtractedDate(date: string): ParsedExtractedDate | null {
  const value = date.trim();
  if (DATE_ONLY_PATTERN.test(value)) {
    const ms = Date.parse(`${value}T00:00:00Z`);
    return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value ? { kind: "date", day: value } : null;
  }
  const match = ISO_DATETIME_PATTERN.exec(value);
  if (!match) return null;
  const [, day, time, rawOffset] = match;
  const offset = !rawOffset || rawOffset.toUpperCase() === "Z" ? "Z" : rawOffset.replace(/^([+-]\d{2}):?(\d{2})$/, "$1:$2");
  const ms = Date.parse(`${day}T${time}${offset}`);
  if (Number.isNaN(ms) || new Date(Date.parse(`${day}T00:00:00Z`)).toISOString().slice(0, 10) !== day) return null;
  return { kind: "datetime", iso: new Date(ms).toISOString() };
}

/** True when the extraction has a date that is not ISO 8601 (it was ignored in favour of the email date). */
function hasNonIsoDate(input: MatchInput): boolean {
  const { date } = input.extraction.fields;
  return date != null && parseExtractedDate(date) === null;
}

/** Extraction confidence with a non-ISO date counted as a low-confidence field. */
function inputConfMin(input: MatchInput): number {
  const { confMin } = input.extraction;
  return hasNonIsoDate(input) ? Math.min(confMin, NON_ISO_DATE_CONFIDENCE) : confMin;
}

/**
 * ISO datetime for an extracted date. A date-only value takes the time of the earliest candidate email sent that
 * UTC day (the body date and the send time agree), else midnight UTC. Non-ISO/missing => fallback (the email date).
 */
function resolveDate(date: string | null, candidates: readonly string[], fallback: string): string {
  const parsed = date == null ? null : parseExtractedDate(date);
  if (parsed?.kind === "date") {
    const sameDay = candidates
      .filter((candidate) => new Date(candidate).toISOString().slice(0, 10) === parsed.day)
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    return sameDay.length > 0 ? new Date(sameDay[0]).toISOString() : `${parsed.day}T00:00:00.000Z`;
  }
  if (parsed?.kind === "datetime") return parsed.iso;
  return new Date(fallback).toISOString();
}

function resolveEventAt(input: MatchInput): string {
  return resolveDate(input.extraction.fields.date, [input.email.date], input.email.date);
}

/** Order date from the latest confirmation's date field; no confirmation => earliest email date. */
function resolvePlacedAt(inputs: readonly MatchInput[]): string {
  const sorted = [...inputs].sort(compareInputs);
  const primary = primaryConfirmation(sorted);
  if (!primary) return new Date(sorted[0].email.date).toISOString();
  const confirmationDates = sorted.filter(isConfirmation).map((input) => input.email.date);
  return resolveDate(primary.extraction.fields.date, confirmationDates, primary.email.date);
}

/** First non-null value of `pick` over `inputs`. */
function firstValue<T>(inputs: readonly MatchInput[], pick: (input: MatchInput) => T | null | undefined): T | null {
  for (const input of inputs) {
    const value = pick(input);
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function buildLineItems(orderId: string, items: readonly ExtractedLineItem[]): NormalizedLineItem[] {
  const usedIds = new Set<string>();
  return items.map((item) => {
    const base = `${orderId}:li:${slugify(item.sku ?? "") || slugify(item.name) || "item"}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n += 1) id = `${base}-${n}`;
    usedIds.add(id);
    return { id, name: item.name, sku: item.sku ?? null, qty: item.qty, unitPrice: item.unitPrice, returnedQty: 0 };
  });
}

/** Line items from the latest confirmation that has any; else the union of lifecycle emails' items (max qty). */
function pickLineItems(sortedInputs: readonly MatchInput[]): ExtractedLineItem[] {
  const confirmations = sortedInputs.filter(isConfirmation);
  for (let i = confirmations.length - 1; i >= 0; i -= 1) {
    const items = confirmations[i].extraction.fields.lineItems;
    if (items.length > 0) return items;
  }
  const union = new Map<string, ExtractedLineItem>();
  for (const input of sortedInputs) {
    for (const item of input.extraction.fields.lineItems) {
      const key = itemKey(item);
      const existing = union.get(key);
      if (!existing || item.qty > existing.qty) union.set(key, item);
    }
  }
  return [...union.values()];
}

function itemKey(item: Pick<ExtractedLineItem, "name" | "sku">): string {
  return item.sku ? `sku:${item.sku.toLowerCase()}` : `name:${slugify(item.name)}`;
}

/** Order line item an extracted (shipment/return) item refers to: same sku, else same normalized name. */
function matchLineItem(items: readonly NormalizedLineItem[], extracted: ExtractedLineItem): NormalizedLineItem | null {
  const sku = extracted.sku?.toLowerCase();
  if (sku) {
    const bySku = items.find((item) => item.sku?.toLowerCase() === sku);
    if (bySku) return bySku;
  }
  const name = slugify(extracted.name);
  return items.find((item) => slugify(item.name) === name) ?? null;
}

function eventTypeFor(input: MatchInput): OrderEventType | null {
  const { extraction, email } = input;
  switch (extraction.class) {
    case "shipped":
      return "shipped";
    case "delivered":
      return "delivered";
    case "return_started":
      return DROP_OFF_PATTERN.test(`${email.subject}\n${email.text}`) ? "return_dropped" : "return_started";
    case "return_received":
      return "return_received";
    case "refund":
      return extraction.fields.isStoreCredit ? "store_credit" : "refund_issued";
    case "price_adjust":
      return "price_adjust";
    case "cancel":
      return "cancel";
    default:
      return null;
  }
}

interface BuiltEvent {
  event: OrderEvent;
  /** Matched order line item id -> quantity this event covers. */
  quantities: Map<string, number>;
}

function buildEvents(orderId: string, sortedInputs: readonly MatchInput[], lineItems: NormalizedLineItem[]): BuiltEvent[] {
  const seen = new Set<string>();
  const built: BuiltEvent[] = [];
  for (const input of sortedInputs) {
    const type = eventTypeFor(input);
    if (!type) continue;
    const { extraction, email } = input;
    const at = resolveEventAt(input);
    const quantities = new Map<string, number>();
    for (const extracted of extraction.fields.lineItems) {
      const item = matchLineItem(lineItems, extracted);
      if (item) quantities.set(item.id, (quantities.get(item.id) ?? 0) + extracted.qty);
    }
    const lineItemIds = [...quantities.keys()].sort();
    const amount = finiteOrNull(extraction.fields.eventAmount);
    // The same lifecycle email received twice (resend/copy) must not produce a second event.
    const dedupeKey = `${type}|${at.slice(0, 10)}|${amount ?? ""}|${lineItemIds.join(",")}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const evidence = extraction.evidence.eventAmount ?? extraction.evidence.date;
    built.push({
      event: {
        id: `${orderId}:${type}:${email.id}`,
        type,
        at,
        ...(amount !== null ? { amount } : {}),
        messageId: email.id,
        conf: inputConfMin(input),
        ...(evidence !== undefined ? { evidence } : {}),
        ...(lineItemIds.length > 0 ? { lineItemIds } : {}),
      },
      quantities,
    });
  }
  return built.sort(
    (a, b) => Date.parse(a.event.at) - Date.parse(b.event.at) || a.event.id.localeCompare(b.event.id),
  );
}

/**
 * Returned quantity per line item: per return stage (started / dropped / received) the quantities are summed, and the
 * largest stage total counts, so one return reported at several stages is not double-counted. Capped at qty.
 */
function applyReturnedQty(lineItems: NormalizedLineItem[], events: readonly BuiltEvent[]): NormalizedLineItem[] {
  return lineItems.map((item) => {
    let returned = 0;
    for (const stage of RETURN_EVENT_TYPES) {
      const stageQty = events
        .filter(({ event }) => event.type === stage)
        .reduce((sum, { quantities }) => sum + (quantities.get(item.id) ?? 0), 0);
      returned = Math.max(returned, stageQty);
    }
    return { ...item, returnedQty: Math.min(item.qty, returned) };
  });
}

/** Policy from facts stated in the order's emails. Confirmations (latest first) take precedence over other emails. */
function buildPolicy(policyInputs: readonly MatchInput[]): MerchantPolicy {
  const fields = (input: MatchInput) => input.extraction.fields;
  const returnWindowDays = firstValue(policyInputs, (input) => fields(input).returnWindowDays);
  const refundSlaDays = firstValue(policyInputs, (input) => fields(input).refundSlaDays);
  const priceAdjustDays = firstValue(policyInputs, (input) => fields(input).priceAdjustDays);
  const policyQuote = firstValue(policyInputs, (input) => fields(input).policyQuote);
  const policyTexts = policyInputs.flatMap((input) =>
    [fields(input).policyQuote, input.extraction.evidence.returnWindowDays].filter(
      (text): text is string => typeof text === "string",
    ),
  );
  const confirmationTexts = policyInputs.filter(isConfirmation).map((input) => input.email.text);
  const nonReturnable = [...policyTexts, ...confirmationTexts].some((text) => FINAL_SALE_PATTERN.test(text));
  const windowAnchor = policyTexts.some((text) => DELIVERY_ANCHOR_PATTERN.test(text))
    ? "delivery"
    : returnWindowDays != null
      ? "order"
      : null;
  const anyStated = returnWindowDays != null || refundSlaDays != null || priceAdjustDays != null || policyQuote != null;
  return {
    returnWindowDays,
    windowAnchor,
    refundSlaDays,
    priceAdjustDays,
    policySource: anyStated ? "email_text" : null,
    policyQuote,
    nonReturnable,
  };
}

function finiteOrNull(amount: number | null | undefined): number | null {
  return amount != null && Number.isFinite(amount) ? amount : null;
}

/** Review reasons for amounts no rule can use: negative or non-finite totals and event amounts. */
function amountReviewReasons(
  amounts: Record<"subtotal" | "tax" | "shipping" | "discount" | "total", number | null>,
  sortedInputs: readonly MatchInput[],
): string[] {
  const reasons: string[] = [];
  for (const [name, amount] of Object.entries(amounts)) {
    if (amount === null) continue;
    if (!Number.isFinite(amount)) reasons.push(`${name} is not a number`);
    else if (amount < 0) reasons.push(`${name} is negative (${amount.toFixed(2)})`);
  }
  for (const input of sortedInputs) {
    const amount = input.extraction.fields.eventAmount;
    if (amount == null) continue;
    if (!Number.isFinite(amount)) reasons.push(`event amount in email ${input.email.id} is not a number`);
    else if (amount < 0) reasons.push(`event amount in email ${input.email.id} is negative (${amount.toFixed(2)})`);
  }
  return reasons;
}

function buildOrder(group: OrderGroup): { order: NormalizedOrder; reasons: string[] } {
  const sorted = [...group.inputs].sort(compareInputs);
  const primary = primaryConfirmation(sorted);
  const confirmationsLatestFirst = sorted.filter(isConfirmation).reverse();
  const others = sorted.filter((input) => !isConfirmation(input));
  const byPrecedence = [...confirmationsLatestFirst, ...others];
  const fieldsOf = (input: MatchInput) => input.extraction.fields;

  const merchantSlug = group.merchantKey;
  const orderRef = firstValue(byPrecedence, (input) => fieldsOf(input).orderRef);
  const id = group.refKey
    ? `order:${merchantSlug}:${group.refKey}`
    : `order:${merchantSlug}:${slugify(sorted[0].email.id)}`;

  const merchantName =
    firstValue(byPrecedence, (input) => fieldsOf(input).merchant) ??
    firstValue(byPrecedence, (input) => fieldsOf(input).merchantDomain) ??
    merchantSlug;
  const domain = normalizeDomain(firstValue(byPrecedence, (input) => fieldsOf(input).merchantDomain));

  const totalsSource = primary ? fieldsOf(primary).totals : {};
  const lineItemsBase = buildLineItems(id, pickLineItems(sorted));
  const builtEvents = buildEvents(id, sorted, lineItemsBase);
  const lineItems = applyReturnedQty(lineItemsBase, builtEvents);

  const subtotal = totalsSource.subtotal ?? null;
  const tax = totalsSource.tax ?? null;
  const shipping = totalsSource.shipping ?? null;
  const discount = totalsSource.discount ?? null;
  const itemsSum = lineItems.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
  const total = roundCents(
    totalsSource.total ?? (subtotal ?? itemsSum) + (tax ?? 0) + (shipping ?? 0) - (discount ?? 0),
  );

  const reasons = [
    ...amountReviewReasons({ subtotal, tax, shipping, discount, total }, sorted),
    ...sorted
      .filter(hasNonIsoDate)
      .map((input) => `date "${input.extraction.fields.date}" in email ${input.email.id} is not ISO 8601; used the email date`),
  ];

  const currency = firstValue(byPrecedence, (input) => fieldsOf(input).currency);
  const confMin = Math.min(...sorted.map(inputConfMin));
  // Without a confirmation the totals are unverified; without a currency the amounts cannot be compared.
  const needsReview =
    confMin < REVIEW_CONFIDENCE_THRESHOLD || primary === null || currency === null || reasons.length > 0;

  const messageIds = primary
    ? [primary.email.id, ...sorted.filter((input) => input !== primary).map((input) => input.email.id)]
    : sorted.map((input) => input.email.id);

  const sources = [...new Set(sorted.map((input) => input.email.sourceAccount).filter((source): source is string => Boolean(source)))].sort();
  const order = NormalizedOrderSchema.parse({
    id,
    merchant: { name: merchantName, domain, policy: buildPolicy(byPrecedence) },
    orderRef,
    placedAt: resolvePlacedAt(sorted),
    // Unknown currency only ever reaches the needs-review queue (needsReview is forced above).
    currency: currency ?? "USD",
    // Non-finite amounts only ever reach the needs-review queue (a reason is recorded above).
    subtotal: finiteOrNull(subtotal),
    tax: finiteOrNull(tax),
    shipping: finiteOrNull(shipping),
    discount: finiteOrNull(discount),
    total: Number.isFinite(total) ? total : 0,
    last4: firstValue(byPrecedence, (input) => fieldsOf(input).last4),
    customerName: firstValue(byPrecedence, (input) => fieldsOf(input).customerName),
    lineItems,
    events: builtEvents.map(({ event }) => event),
    messageIds,
    ...(sources.length > 0 ? { sources } : {}),
    confMin,
    needsReview,
  });
  return { order, reasons };
}
