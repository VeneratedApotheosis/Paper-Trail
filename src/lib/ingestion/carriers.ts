import { foldText } from "./text";

/**
 * Carriers, convenience-store pickup networks and marketplaces that send tracking emails (#127), plus deterministic
 * tracking-number reading and public tracking-URL building. Pure. The LLM may read a tracking number; code validates
 * it against the email text and builds the URL, so neither is ever taken on trust.
 */

export interface CarrierInfo {
  id: string;
  /** Name shown to the shopper. */
  name: string;
  /** `carrier` ships for many shops; `store` is also a merchant (marketplace, convenience store) whose emails can be receipts. */
  role: "carrier" | "store";
  /** Registrable sender domains (subdomains match). */
  domains: readonly string[];
  /** Matches the carrier's name in folded (lowercase, accent-free) text. */
  names: RegExp;
  /** Public tracking page for a normalized tracking number; absent when the carrier has no direct-link pattern. */
  trackingUrl?: (trackingNumber: string) => string;
}

const enc = encodeURIComponent;

export const CARRIERS: readonly CarrierInfo[] = [
  {
    id: "ups", name: "UPS", role: "carrier", domains: ["ups.com", "upsemail.com"], names: /\bups\b|united parcel service/,
    trackingUrl: (n) => `https://www.ups.com/track?tracknum=${enc(n)}`,
  },
  {
    id: "usps", name: "USPS", role: "carrier", domains: ["usps.com", "usps.gov", "uspsinformeddelivery.com"],
    names: /\busps\b|u\.s\. postal service|united states postal service/,
    trackingUrl: (n) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${enc(n)}`,
  },
  {
    id: "fedex", name: "FedEx", role: "carrier", domains: ["fedex.com"], names: /\bfedex\b|federal express/,
    trackingUrl: (n) => `https://www.fedex.com/fedextrack/?trknbr=${enc(n)}`,
  },
  {
    id: "dhl", name: "DHL", role: "carrier", domains: ["dhl.com", "dhl.de", "dhl.co.uk", "dhl-news.com"], names: /\bdhl\b/,
    trackingUrl: (n) => `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${enc(n)}`,
  },
  {
    id: "amazon", name: "Amazon", role: "store", domains: ["amazon.com", "amazon.co.uk", "amazon.de", "amazon.co.jp", "amazon.ca", "amazon.com.au", "amazon.in", "amazon.fr", "amazon.it", "amazon.es", "amzn.com"],
    names: /\bamazon(?: logistics| shipping)?\b/,
    trackingUrl: (n) => `https://track.amazon.com/tracking/${enc(n)}`,
  },
  {
    id: "tcat", name: "T-cat 黑貓宅急便", role: "carrier", domains: ["t-cat.com.tw", "tcat.com.tw"], names: /\bt-?cat\b|black cat|黑貓/,
    trackingUrl: (n) => `https://www.t-cat.com.tw/Inquire/TraceDetail.aspx?BillID=${enc(n)}&ReturnUrl=Trace.aspx`,
  },
  {
    id: "hct", name: "HCT 新竹物流", role: "carrier", domains: ["hct.com.tw"], names: /\bhct\b|hsinchu (?:logistics|transport)|新竹(?:物流|貨運)/,
  },
  {
    id: "chunghwapost", name: "Chunghwa Post 中華郵政", role: "carrier", domains: ["post.gov.tw"], names: /chunghwa post|taiwan post|中華郵政|中华邮政/,
  },
  {
    id: "seveneleven", name: "7-ELEVEN 統一超商", role: "carrier", domains: ["7-11.com.tw", "7-eleven.com.tw", "ibon.com.tw"],
    names: /7[- ]?eleven|7-11|統一超商|超商取貨|ibon/,
    trackingUrl: (n) => `https://eservice.7-11.com.tw/e-tracking/search.aspx?shipNum=${enc(n)}`,
  },
  {
    id: "familymart", name: "FamilyMart 全家", role: "carrier", domains: ["family.com.tw", "famiport.com.tw", "fmt.com.tw"], names: /family ?mart|全家/,
  },
  { id: "hilife", name: "Hi-Life 萊爾富", role: "carrier", domains: ["hilife.com.tw"], names: /hi-?life|萊爾富/ },
  { id: "shopee", name: "Shopee 蝦皮", role: "store", domains: ["shopee.tw", "shopee.com", "shopee.sg", "spx.tw"], names: /shopee|蝦皮|虾皮/ },
  { id: "momo", name: "momo", role: "store", domains: ["momoshop.com.tw", "momo.com.tw", "fubon-momo.com"], names: /\bmomo(?:shop)?\b|富邦媒體/ },
  { id: "pchome", name: "PChome", role: "store", domains: ["pchome.com.tw", "pcstore.com.tw"], names: /pchome|網路家庭/ },
];

/** Registrable-ish match: the domain or any subdomain of it. */
function domainMatches(domain: string, candidates: readonly string[]): boolean {
  return candidates.some((candidate) => domain === candidate || domain.endsWith(`.${candidate}`));
}

export function carrierFromDomain(domain: string | null | undefined): CarrierInfo | null {
  if (!domain) return null;
  const lowered = domain.toLowerCase();
  return CARRIERS.find((carrier) => domainMatches(lowered, carrier.domains)) ?? null;
}

/** The carrier a free-text name refers to ("UPS Ground", "黑貓宅急便", "7-ELEVEN"), or null. */
export function carrierFromName(value: string | null | undefined): CarrierInfo | null {
  if (!value) return null;
  const folded = foldText(value);
  return CARRIERS.find((carrier) => carrier.names.test(folded)) ?? null;
}

/** True when the sender domain belongs to a known carrier, pickup network or logistics-capable marketplace. */
export function isTrustedLogisticsDomain(domain: string | null | undefined): boolean {
  return carrierFromDomain(domain) !== null;
}

/** True when the name is a carrier that ships for many shops (never the shop itself). */
export function isCarrierName(value: string | null | undefined): boolean {
  return carrierFromName(value)?.role === "carrier";
}

/** Upper case, no spaces or hyphens: the form tracking numbers are compared and shown in. */
export function normalizeTrackingNumber(value: string): string {
  return value.toUpperCase().replace(/[\s-]+/g, "");
}

/** A tracking number worth keeping: 8 to 40 letters/digits with at least five digits. */
export function isPlausibleTrackingNumber(normalized: string): boolean {
  return /^[A-Z0-9]{8,40}$/.test(normalized) && (normalized.match(/\d/g)?.length ?? 0) >= 5;
}

/** Carrier implied by the number's own shape: UPS `1Z...`, Amazon Logistics `TBA...`. */
export function carrierFromTrackingNumber(normalized: string): CarrierInfo | null {
  if (/^1Z[0-9A-Z]{16}$/.test(normalized)) return CARRIERS.find((carrier) => carrier.id === "ups") ?? null;
  if (/^TBA\d{9,14}$/.test(normalized)) return CARRIERS.find((carrier) => carrier.id === "amazon") ?? null;
  return null;
}

/** Public tracking URL for a carrier name + number, or null when the carrier has no direct-link pattern. Never LLM-written. */
export function trackingUrlFor(carrier: string | null | undefined, trackingNumber: string): string | null {
  const info = carrierFromName(carrier) ?? carrierFromTrackingNumber(normalizeTrackingNumber(trackingNumber));
  return info?.trackingUrl ? info.trackingUrl(normalizeTrackingNumber(trackingNumber)) : null;
}

const TRACKING_LABEL =
  "(?:tracking\\s*(?:number|no\\.?|#|id|code|num)|track(?:ing)?\\s*#|waybill(?:\\s*(?:number|no\\.?))?|tracking|追蹤編號|追蹤號碼|追蹤單號|物流編號|物流單號|物流追蹤碼|貨運單號|貨態編號|查貨號碼|配送編號|運單號碼|運單編號|包裹編號|寄貨編號|託運單號|取貨編號|寄件編號)";
const TRACKING_VALUE = "([A-Z0-9][A-Z0-9-]{6,38}|\\d{4}(?: \\d{4}){3,6}(?: \\d{1,4})?)";
const LABELED_TRACKING = new RegExp(`${TRACKING_LABEL}\\s*[:：#|]?\\s*${TRACKING_VALUE}`, "gi");
const UNLABELED_TRACKING = /\b(?:1Z[0-9A-Z]{16}|TBA\d{9,14}|9[2-5]\d{18,24})\b/g;
const SPACED_USPS = /\b9[2-5]\d{2}(?: \d{4}){4}(?: \d{2})?\b/g;
const URL_TRACKING = /[?&](?:tracknum|trknbr|tlabels|tracking[-_]?id|tracking[-_]?number|trackingnumber|trackingno|tracknumber|nums|billid|shipnum)=([A-Za-z0-9]{6,40})/gi;

/**
 * Tracking numbers an email prints: labelled ones ("Tracking number: ...", "物流單號：..."), carrier-shaped ones (UPS 1Z..,
 * USPS 92..-95.., Amazon TBA..) and tracking-link parameters. Normalized, de-duplicated, in order of appearance.
 */
export function scanTrackingNumbers(text: string): string[] {
  const found: Array<{ at: number; value: string }> = [];
  const add = (at: number, raw: string) => {
    const value = normalizeTrackingNumber(raw);
    if (isPlausibleTrackingNumber(value)) found.push({ at, value });
  };
  for (const match of text.matchAll(LABELED_TRACKING)) add(match.index ?? 0, match[1]);
  for (const match of text.matchAll(UNLABELED_TRACKING)) add(match.index ?? 0, match[0]);
  for (const match of text.matchAll(SPACED_USPS)) add(match.index ?? 0, match[0]);
  for (const match of text.matchAll(URL_TRACKING)) add(match.index ?? 0, match[1]);
  return [...new Set(found.sort((a, b) => a.at - b.at).map((entry) => entry.value))];
}

const CARRIER_LABEL = /(?:carrier|shipped via|shipping method|delivery service|shipped with|物流公司|物流商|配送方式|運送方式|貨運公司|承運商?)\s*[:：|]?\s*([^\n]{2,40})/i;

/**
 * The carrier an email names: a labelled "Carrier: ..." line, else the one carrier mentioned in the text (several
 * mentions are ambiguous, so none).
 */
export function carrierFromText(text: string): CarrierInfo | null {
  const labelled = CARRIER_LABEL.exec(text);
  const fromLabel = labelled ? carrierFromName(labelled[1]) : null;
  if (fromLabel) return fromLabel;
  const folded = foldText(text);
  const mentioned = CARRIERS.filter((carrier) => carrier.role === "carrier" && carrier.names.test(folded));
  return mentioned.length === 1 ? mentioned[0] : null;
}
