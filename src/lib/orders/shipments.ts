import type { EmailClass, Extraction, RawEmail, RedactedEmail, Shipment, ShipmentStatus } from "@/lib/contracts";
import {
  carrierFromDomain,
  carrierFromName,
  carrierFromText,
  carrierFromTrackingNumber,
  isPlausibleTrackingNumber,
  normalizeTrackingNumber,
  scanTrackingNumbers,
  trackingUrlFor,
} from "@/lib/ingestion/carriers";
import { foldText, senderDomain } from "@/lib/ingestion/text";

/**
 * Packages from tracking emails (#127): per-email package updates, deterministic status reading and one `Shipment` per
 * tracking number. Pure. The LLM's tracking numbers are only used when they appear in the email text, statuses come from
 * wording first, and tracking URLs are built by code.
 */

/** What the matcher needs of one email; `MatchInput` satisfies it. */
export interface ShippingSource {
  email: Pick<RawEmail | RedactedEmail, "id" | "from" | "subject" | "text">;
  extraction: Pick<Extraction, "class" | "fields">;
}

/** One shipping / tracking email, read. `at` is the event time (ISO). */
export interface PackageUpdate {
  emailId: string;
  at: string;
  status: ShipmentStatus;
  trackingNumbers: string[];
  carrier: string | null;
  eta: string | null;
  pickupLocation: string | null;
  /** Order line items this email names; only set when the email carries a single tracking number. */
  itemIds: string[];
}

export const SHIPPING_CLASSES: readonly EmailClass[] = ["shipped", "delivered"];

export function isShippingClass(cls: EmailClass): boolean {
  return SHIPPING_CLASSES.includes(cls);
}

const READY_FOR_PICKUP =
  /ready (?:for|to) (?:be )?(?:pick ?up|collect(?:ion)?)|available for (?:pick ?up|collection)|awaiting (?:pick ?up|collection)|waiting for pick ?up|arrived at (?:the |your )?(?:pick-?up|store|locker|branch)|ready at (?:the )?(?:store|locker)|已到店|到店通知|可取貨|待取貨|取貨通知|貨到門市|已抵達門市|請(?:於|在).{0,30}取貨/;
const OUT_FOR_DELIVERY = /out for delivery|arriving today|arrives today|delivery today|will be delivered today|on (?:its|the) way to you today|配送中|派送中|配達中|今日送達|今天送達|司機配送|外送中/;
const RETURNED_TO_SENDER = /returned to sender|return to sender|being returned to (?:the )?(?:sender|merchant)|退回寄件人|已退回|包裹退回|退貨至/;
const IN_TRANSIT = /in transit|on (?:its|the) way|shipped|運送中|已出貨|已寄出|已發貨|已发货|出貨通知/;

/** Sentences that promise a later update ("we will email you once it is out for delivery") say nothing about now. */
const FUTURE_PROMISE = /\b(?:when|once|until|as soon as)\b[^.\n]*[.\n]|\bwe(?:'ll| will)\b[^.\n]*[.\n]|\byou(?:'ll| will) (?:receive|get)\b[^.\n]*[.\n]/g;

/** The more specific status of a tracking email's wording, or null when it only says "shipped". Subject first. */
function statusFromWording(subject: string, body: string): ShipmentStatus | null {
  for (const text of [subject, body.replace(FUTURE_PROMISE, " ")]) {
    if (RETURNED_TO_SENDER.test(text)) return "returned";
    if (READY_FOR_PICKUP.test(text)) return "ready_for_pickup";
    if (OUT_FOR_DELIVERY.test(text)) return "out_for_delivery";
    if (IN_TRANSIT.test(text)) return "shipped";
  }
  return null;
}

/** What one tracking email says about the package: `delivered` for the delivered class (also pickups), else wording, else the LLM, else `shipped`. */
export function packageStatusOf(source: ShippingSource): ShipmentStatus {
  const { extraction, email } = source;
  if (extraction.class === "delivered") return "delivered";
  const wording = statusFromWording(foldText(email.subject), foldText(email.text));
  if (wording !== null) return wording;
  const guessed = extraction.fields.shipment?.status;
  return guessed === "out_for_delivery" || guessed === "ready_for_pickup" || guessed === "returned" ? guessed : "shipped";
}

/** Tracking numbers of one email: the LLM's that really appear in the text, plus the ones scanned from the text. Normalized. */
export function trackingNumbersOf(source: Pick<ShippingSource, "email" | "extraction">): string[] {
  const { email, extraction } = source;
  const haystack = normalizeTrackingNumber(`${email.subject}\n${email.text}`);
  const stated = (extraction.fields.shipment?.trackingNumbers ?? [])
    .map(normalizeTrackingNumber)
    .filter((number) => isPlausibleTrackingNumber(number) && haystack.includes(number));
  return [...new Set([...stated, ...scanTrackingNumbers(`${email.subject}\n${email.text}`)])];
}

/** Display carrier of one email: the number's own shape, the LLM's carrier, a labelled/unique mention, then the sender. */
function carrierOf(source: ShippingSource, numbers: readonly string[]): string | null {
  const { email, extraction } = source;
  const fromNumber = numbers.map((number) => carrierFromTrackingNumber(number)).find((carrier) => carrier !== null);
  if (fromNumber) return fromNumber.name;
  const stated = extraction.fields.shipment?.carrier?.trim();
  if (stated) return carrierFromName(stated)?.name ?? stated.slice(0, 60);
  const fromText = carrierFromText(`${email.subject}\n${email.text}`);
  if (fromText) return fromText.name;
  return carrierFromDomain(senderDomain(email.from))?.name ?? null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** The value when it is an ISO date or datetime, else null (free-form "Thursday" is not an ETA). */
export function isoOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && ISO_DAY.test(trimmed) && !Number.isNaN(Date.parse(trimmed)) ? trimmed : null;
}

/** Reads one tracking email. `at` is the event time the matcher resolved; `itemIds` the order items it matched. */
export function packageUpdateOf(source: ShippingSource, at: string, itemIds: readonly string[]): PackageUpdate {
  const numbers = trackingNumbersOf(source);
  const shipment = source.extraction.fields.shipment;
  return {
    emailId: source.email.id,
    at,
    status: packageStatusOf(source),
    trackingNumbers: numbers,
    carrier: carrierOf(source, numbers),
    eta: isoOrNull(shipment?.eta),
    pickupLocation: shipment?.pickupLocation?.trim() || null,
    itemIds: numbers.length === 1 ? [...itemIds] : [],
  };
}

/** How far along a status is; shipments never move back (a late "shipped" email after "delivered" changes nothing). */
const STATUS_RANK: Record<ShipmentStatus, number> = {
  unknown: 0,
  ordered: 1,
  shipped: 2,
  out_for_delivery: 3,
  ready_for_pickup: 3,
  delivered: 4,
  returned: 5,
};

export function statusRank(status: ShipmentStatus): number {
  return STATUS_RANK[status];
}

const byTime = (a: PackageUpdate, b: PackageUpdate) => Date.parse(a.at) - Date.parse(b.at) || a.emailId.localeCompare(b.emailId);

/** Shipments of one order: one per tracking number; updates without a number apply to the only shipment, if there is exactly one. */
export function buildShipments(updates: readonly PackageUpdate[]): Shipment[] {
  const sorted = [...updates].sort(byTime);
  const numbers = [...new Set(sorted.flatMap((update) => update.trackingNumbers))];
  if (numbers.length === 0) return [];
  const forNumber = (number: string) =>
    sorted.filter((update) => update.trackingNumbers.includes(number) || (update.trackingNumbers.length === 0 && numbers.length === 1));
  return numbers
    .map((number) => shipmentOf(number, forNumber(number)))
    .sort((a, b) => (a.shippedAt ?? "").localeCompare(b.shippedAt ?? "") || a.trackingNumber.localeCompare(b.trackingNumber));
}

function shipmentOf(trackingNumber: string, updates: readonly PackageUpdate[]): Shipment {
  const newest = (pick: (update: PackageUpdate) => string | null): string | null => {
    for (let i = updates.length - 1; i >= 0; i -= 1) {
      const value = pick(updates[i]);
      if (value !== null) return value;
    }
    return null;
  };
  // The most advanced status wins; equal ranks (out for delivery vs ready for pickup) go to the later email.
  const lead = updates.reduce((best, update) => (statusRank(update.status) >= statusRank(best.status) ? update : best), updates[0]);
  const shipped = updates.find((update) => statusRank(update.status) >= statusRank("shipped"));
  const delivered = updates.find((update) => update.status === "delivered");
  const carrier = newest((update) => update.carrier);
  const open = updates.filter((update) => update.status !== "delivered" && update.status !== "returned");
  return {
    carrier,
    trackingNumber,
    trackingUrl: trackingUrlFor(carrier, trackingNumber),
    status: lead.status,
    eta: lead.status === "delivered" ? null : [...open].reverse().find((update) => update.eta !== null)?.eta ?? null,
    shippedAt: (shipped ?? updates[0]).at,
    deliveredAt: delivered?.at ?? null,
    itemIds: [...new Set(updates.flatMap((update) => update.itemIds))].sort(),
    pickupLocation: newest((update) => update.pickupLocation),
  };
}

/** Merges shipments of orders that turned out to be one (account merge): same tracking number, most advanced wins. */
export function mergeShipments(lists: readonly (readonly Shipment[])[]): Shipment[] {
  const byNumber = new Map<string, Shipment>();
  for (const shipment of lists.flat()) {
    const known = byNumber.get(shipment.trackingNumber);
    if (!known) {
      byNumber.set(shipment.trackingNumber, shipment);
      continue;
    }
    const [lead, other] = statusRank(shipment.status) > statusRank(known.status) ? [shipment, known] : [known, shipment];
    byNumber.set(shipment.trackingNumber, {
      ...lead,
      carrier: lead.carrier ?? other.carrier,
      trackingUrl: lead.trackingUrl ?? other.trackingUrl,
      eta: lead.eta ?? other.eta,
      shippedAt: [lead.shippedAt, other.shippedAt].filter((at): at is string => at !== null).sort()[0] ?? null,
      deliveredAt: lead.deliveredAt ?? other.deliveredAt,
      itemIds: [...new Set([...lead.itemIds, ...other.itemIds])].sort(),
      pickupLocation: lead.pickupLocation ?? other.pickupLocation ?? null,
    });
  }
  return [...byNumber.values()].sort((a, b) => (a.shippedAt ?? "").localeCompare(b.shippedAt ?? "") || a.trackingNumber.localeCompare(b.trackingNumber));
}
