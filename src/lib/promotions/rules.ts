import type { Promotion, PromotionChannel, PromotionDiscount } from "@/lib/contracts";

/**
 * Promotion reading by rules (#131): free, deterministic, English + Traditional Chinese basics. Reads one marketing
 * email (redacted text) and returns the offer: discount, min spend, promo codes, expiry and channel.
 *
 * Expiry assumption: phrases without a time of day ("ends tonight", "ends Oct 20", "through Sunday") end at 23:59 in the
 * user's local time zone (PaperTrail runs on the user's machine, so that is the server's zone unless `utcOffsetMinutes`
 * says otherwise). "Tonight" and "today" mean the local calendar day of the email's date. A date without a year is the
 * next such date within 30 days of the email's date (a date more than 30 days in the past rolls to the next year).
 */

export interface PromotionEmail {
  emailId: string;
  fromName: string | null;
  fromDomain: string | null;
  subject: string;
  /** ISO time the email was sent. */
  date: string;
  /** Redacted body text. */
  text: string;
}

export interface RulesOptions {
  /** Minutes east of UTC at the given instant; defaults to the process time zone. Tests pass a fixed offset. */
  utcOffsetMinutes?: (at: Date) => number;
}

export interface PromotionReading {
  store: string;
  storeDomain: string | null;
  headline: string;
  discount: PromotionDiscount | null;
  codes: string[];
  expiresAt: string | null;
  channel: PromotionChannel | null;
  confidence: number;
}

const MS_HOUR = 3_600_000;
const MS_DAY = 24 * MS_HOUR;
const MAX_CODES = 5;
const MAX_HEADLINE_CHARS = 120;

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_NAMES = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
};
const WEEKDAY_NAMES = "sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thurs?|thu|fri|sat";
const CHINESE_WEEKDAYS: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

/** Characters that make the text easier to match: full-width forms become ASCII, quotes stay. */
function normalize(value: string): string {
  return value.normalize("NFKC");
}

// ---------------------------------------------------------------------------------------------------------------------
// Time helpers (all in the local zone described above)
// ---------------------------------------------------------------------------------------------------------------------

type CalendarDay = { year: number; month: number; day: number };

function defaultOffset(at: Date): number {
  return -at.getTimezoneOffset();
}

function localDay(at: Date, offset: number): CalendarDay & { weekday: number } {
  const shifted = new Date(at.getTime() + offset * 60_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}

function dayNumber(day: CalendarDay): number {
  return Math.floor(Date.UTC(day.year, day.month - 1, day.day) / MS_DAY);
}

function addDays(day: CalendarDay, days: number): CalendarDay {
  const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day) + days * MS_DAY);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function validDay(day: CalendarDay): boolean {
  const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day));
  return shifted.getUTCFullYear() === day.year && shifted.getUTCMonth() === day.month - 1 && shifted.getUTCDate() === day.day;
}

/** 23:59 local time of `day`, as an ISO instant. */
function endOfDay(day: CalendarDay, offset: number): string {
  return new Date(Date.UTC(day.year, day.month - 1, day.day, 23, 59, 0) - offset * 60_000).toISOString();
}

/** Resolves a month/day written without a year against the email's local day (see the module comment). */
function resolveMonthDay(month: number, dayOfMonth: number, year: number | null, today: CalendarDay): CalendarDay | null {
  if (year !== null) {
    const explicit = { year: year < 100 ? 2000 + year : year, month, day: dayOfMonth };
    return validDay(explicit) ? explicit : null;
  }
  const candidate = { year: today.year, month, day: dayOfMonth };
  if (!validDay(candidate)) return null;
  return dayNumber(candidate) < dayNumber(today) - 30 ? { ...candidate, year: today.year + 1 } : candidate;
}

/** Next date on or after `today` with the given weekday (strictly after when `strictlyAfter`). */
function nextWeekday(today: CalendarDay & { weekday: number }, weekday: number, strictlyAfter: boolean): CalendarDay {
  let ahead = (weekday - today.weekday + 7) % 7;
  if (ahead === 0 && strictlyAfter) ahead = 7;
  return addDays(today, ahead);
}

interface Hit<T> {
  index: number;
  value: T;
}

const TRIGGER = String.raw`(?:ends?|ending|expires?|expiring|expiry|expiration|valid(?:\s+(?:through|thru|until|till|to|on))?|good\s+(?:through|until|thru)|through|thru|until|till|by|before|last\s+day|offer\s+ends|sale\s+ends)`;

function expiryHits(hay: string, received: Date, offset: number): Hit<string>[] {
  const today = localDay(received, offset);
  const hits: Hit<string>[] = [];
  const add = (index: number, day: CalendarDay | null) => {
    if (day) hits.push({ index, value: endOfDay(day, offset) });
  };

  for (const match of hay.matchAll(/\b(?:ends?|ending|expires?|expiring|valid|offer ends|sale ends|good)\s+(?:(?:through|thru|until|till)\s+)?(?:tonight|today|at midnight)\b|\b(?:tonight only|today only|one day only|last day|final day|ends? at midnight)\b|今晚(?:截止|結束|止)|[今本]日(?:截止|結束|止)|今天(?:截止|結束|止)|限今(?:日|天|晚)|僅限今(?:日|天)|最後一天/g)) {
    add(match.index, today);
  }
  for (const match of hay.matchAll(/\b(?:ends?|expires?|expiring|valid(?:\s+(?:through|until|till))?)\s+tomorrow\b|明(?:日|天|晚)(?:截止|結束|止)/g)) {
    add(match.index, addDays(today, 1));
  }
  for (const match of hay.matchAll(new RegExp(String.raw`\b${TRIGGER}\s+(?:on\s+)?(?:the\s+)?(?:(?:${WEEKDAY_NAMES}),?\s+)?(${MONTH_NAMES})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b`, "g"))) {
    add(match.index, resolveMonthDay(MONTHS[match[1].replace(/\.$/, "")] ?? MONTHS[match[1].slice(0, 3)], Number(match[2]), match[3] ? Number(match[3]) : null, today));
  }
  for (const match of hay.matchAll(new RegExp(String.raw`\b${TRIGGER}\s+(?:on\s+)?(?:the\s+)?(?:(?:${WEEKDAY_NAMES}),?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTH_NAMES})\b(?:,?\s+(\d{4}))?`, "g"))) {
    add(match.index, resolveMonthDay(MONTHS[match[2]] ?? MONTHS[match[2].slice(0, 3)], Number(match[1]), match[3] ? Number(match[3]) : null, today));
  }
  for (const match of hay.matchAll(new RegExp(String.raw`\b${TRIGGER}\s+(?:on\s+)?(\d{4})-(\d{2})-(\d{2})\b`, "g"))) {
    add(match.index, resolveMonthDay(Number(match[2]), Number(match[3]), Number(match[1]), today));
  }
  for (const match of hay.matchAll(new RegExp(String.raw`\b${TRIGGER}\s+(?:on\s+)?(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b`, "g"))) {
    add(match.index, resolveMonthDay(Number(match[1]), Number(match[2]), match[3] ? Number(match[3]) : null, today));
  }
  for (const match of hay.matchAll(new RegExp(String.raw`\b${TRIGGER}\s+(this\s+|next\s+)?(${WEEKDAY_NAMES})\b`, "g"))) {
    add(match.index, nextWeekday(today, WEEKDAYS[match[2]], match[1]?.trim() === "next"));
  }
  for (const match of hay.matchAll(/(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})[日号號]?\s*(?:截止|止|結束|前|為止)|(?:至|到|截至|於|直到)\s*(?:(\d{4})年)?\s*(\d{1,2})月\s*(\d{1,2})[日号號]?/g)) {
    const year = match[1] ?? match[4];
    add(match.index, resolveMonthDay(Number(match[2] ?? match[5]), Number(match[3] ?? match[6]), year ? Number(year) : null, today));
  }
  for (const match of hay.matchAll(/(\d{1,2})\/(\d{1,2})\s*(?:截止|止|前)|(?:至|到|截至)\s*(\d{1,2})\/(\d{1,2})/g)) {
    add(match.index, resolveMonthDay(Number(match[1] ?? match[3]), Number(match[2] ?? match[4]), null, today));
  }
  for (const match of hay.matchAll(/(?:至|到|於)?(?:本|這|这)?(?:週|周|星期)([一二三四五六日天])(?:截止|結束|止)|(?:至|到)(?:本)?(?:週|周|星期)([一二三四五六日天])/g)) {
    add(match.index, nextWeekday(today, CHINESE_WEEKDAYS[match[1] ?? match[2]], false));
  }

  const relative = (index: number, amount: number, unit: string) => {
    if (!Number.isFinite(amount) || amount <= 0 || amount > 90) return;
    if (/^(?:hours?|hrs?|小時|小时)$/.test(unit)) hits.push({ index, value: new Date(received.getTime() + amount * MS_HOUR).toISOString() });
    else add(index, addDays(today, amount));
  };
  for (const match of hay.matchAll(/\b(?:ends?|expires?|expiring|ending)\s+in\s+(\d{1,3})\s*(hours?|hrs?|days?)\b|\b(?:within|in the next|for the next|only)\s+(\d{1,3})\s*(hours?|hrs?|days?)\b|\b(\d{1,3})\s*(hours?|hrs?|days?)\s+(?:left|remaining|only)\b/g)) {
    relative(match.index, Number(match[1] ?? match[3] ?? match[5]), match[2] ?? match[4] ?? match[6]);
  }
  for (const match of hay.matchAll(/(\d{1,3})\s*(小時|小时|天|日)\s*(?:內|内|後截止|限定|限時)|限時\s*(\d{1,3})\s*(小時|小时|天|日)/g)) {
    relative(match.index, Number(match[1] ?? match[3]), match[2] ?? match[4]);
  }
  return hits;
}

/** Earliest expiry phrase in the text (the subject comes first, so a headline beats fine print). */
export function resolveExpiry(text: string, receivedAt: string, options: RulesOptions = {}): string | null {
  const received = new Date(receivedAt);
  if (Number.isNaN(received.getTime())) return null;
  const offset = (options.utcOffsetMinutes ?? defaultOffset)(received);
  const hits = expiryHits(normalize(text).toLowerCase(), received, offset);
  return hits.sort((a, b) => a.index - b.index)[0]?.value ?? null;
}

/** An ISO date or date-time from Claude -> an ISO instant; a bare date ends at 23:59 local. Null when unreadable. */
export function normalizeExpiry(value: string, receivedAt: string, options: RulesOptions = {}): string | null {
  const received = new Date(receivedAt);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    const day = { year: Number(dateOnly[1]), month: Number(dateOnly[2]), day: Number(dateOnly[3]) };
    if (!validDay(day)) return null;
    const offset = (options.utcOffsetMinutes ?? defaultOffset)(Number.isNaN(received.getTime()) ? new Date() : received);
    return endOfDay(day, offset);
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

// ---------------------------------------------------------------------------------------------------------------------
// Discounts
// ---------------------------------------------------------------------------------------------------------------------

const CURRENCY = String.raw`(NT\$|US\$|CA\$|C\$|A\$|HK\$|\$|€|£|¥|₩|₹)`;
// Thousands separators only in groups of three: a full-width comma after a number ("$50，10月") must not glue digits.
const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`;
const symbolOf = (value: string | undefined): string => (value ?? "").toUpperCase();

const CURRENCY_CODES: Record<string, string | null> = {
  "$": "USD", "US$": "USD", "NT$": "TWD", "CA$": "CAD", "C$": "CAD", "A$": "AUD", "HK$": "HKD", "€": "EUR", "£": "GBP",
  "¥": null, "₩": "KRW", "₹": "INR",
};

function parseAmount(value: string): number {
  return Number(value.replace(/,/g, ""));
}

function formatAmount(symbol: string, value: number): string {
  return `${symbol}${Number.isInteger(value) ? String(value) : value.toFixed(2)}`;
}

type DiscountHit = Hit<{ discount: PromotionDiscount; symbol: string }>;

function discountHits(hay: string): DiscountHit[] {
  const hits: DiscountHit[] = [];
  const percent = (index: number, value: number) => {
    if (value > 0 && value <= 100) hits.push({ index, value: { discount: { kind: "percent", value, currency: null, minSpend: null }, symbol: "" } });
  };
  const amount = (index: number, symbol: string, value: number) => {
    if (value > 0) hits.push({ index, value: { discount: { kind: "amount", value, currency: CURRENCY_CODES[symbol] ?? null, minSpend: null }, symbol } });
  };

  for (const match of hay.matchAll(/(\d{1,3}(?:\.\d+)?)\s?%\s*(?:off|discount)\b|\bsave\s+(?:up to\s+)?(\d{1,3}(?:\.\d+)?)\s?%/g)) {
    percent(match.index, Number(match[1] ?? match[2]));
  }
  for (const match of hay.matchAll(/(?<![\d.])(\d{1,2}(?:\.\d)?)\s*折(?![扣價券碼])/g)) {
    const times = Number(match[1]);
    percent(match.index, times >= 10 ? 100 - times : 100 - times * 10);
  }
  for (const match of hay.matchAll(new RegExp(String.raw`${CURRENCY}\s?${AMOUNT}\s*(?:off|discount)\b|\bsave\s+(?:up to\s+)?${CURRENCY}\s?${AMOUNT}`, "gi"))) {
    amount(match.index, symbolOf(match[1] ?? match[3]), parseAmount(match[2] ?? match[4]));
  }
  for (const match of hay.matchAll(new RegExp(String.raw`(?:現折|立減|折抵|現省|折價)\s*${CURRENCY}?\s?${AMOUNT}|折\s*${CURRENCY}?\s?${AMOUNT}\s*元|滿\s*${CURRENCY}?\s?${AMOUNT}\s*元?\s*折\s*${CURRENCY}?\s?${AMOUNT}`, "gi"))) {
    const symbol = symbolOf(match[1] ?? match[3] ?? match[5] ?? match[7]) || "NT$";
    amount(match.index, symbol, parseAmount(match[2] ?? match[4] ?? match[8]));
  }
  for (const match of hay.matchAll(/\bbogo\b|\bbuy\s+(?:one|1)[ ,]+get\s+(?:one|1)\b|\bb1g1\b|\bbuy\s+(?:two|2)[ ,]+get\s+(?:one|1)\s+free\b|\b2\s?for\s?1\b|買一送一|買1送1|買二送一|買2送1/g)) {
    hits.push({ index: match.index, value: { discount: { kind: "bogo", value: null, currency: null, minSpend: null }, symbol: "" } });
  }
  return hits;
}

const FREE_SHIPPING = /free\s+(?:standard\s+|express\s+|2-day\s+|two-day\s+)?(?:shipping|delivery)|ships?\s+free|免運費?|免运费|包郵/;
const OTHER_PERK = /\b(?:free gift|gift with purchase|double points|triple points|bonus points|extra points|2x points|3x points)\b|贈品|雙倍點數|點數加倍|點數回饋/;

/** A free-shipping sentence has its own minimum ("free shipping on orders over $75"); it must not become the discount's. */
function withoutShippingClauses(hay: string): string {
  return hay
    .replace(/free\s+(?:standard\s+|express\s+|2-day\s+|two-day\s+)?(?:shipping|delivery)(?:[^.,;\n]|,(?=\d))*/g, " ")
    .replace(/ships?\s+free(?:[^.,;\n]|,(?=\d))*/g, " ")
    .replace(/滿[^。.\n，,]*?(?:免運費?|免运费|包郵)/g, " ");
}

function minSpendOf(source: string, discountValue: number | null): { symbol: string; value: number } | null {
  const hay = withoutShippingClauses(source);
  const patterns: RegExp[] = [
    new RegExp(String.raw`(?:off|discount|save)\s+(?:on\s+|your\s+|any\s+|a\s+|an\s+|every\s+)*(?:(?:first\s+)?(?:online\s+|in-store\s+)?(?:order|purchase)s?\s+)?(?:of\s+|over\s+|totaling\s+|above\s+)?${CURRENCY}\s?${AMOUNT}\+?`, "gi"),
    new RegExp(String.raw`(?:orders?|purchases?|spend|spending|spent|total)\s+(?:of\s+|over\s+|above\s+|at least\s+|more than\s+)?${CURRENCY}\s?${AMOUNT}\+?`, "gi"),
    new RegExp(String.raw`(?:minimum|min\.?)\s+(?:order|purchase|spend)\s*(?:of\s+|is\s+)?${CURRENCY}\s?${AMOUNT}`, "gi"),
    new RegExp(String.raw`${CURRENCY}\s?${AMOUNT}\+?\s+(?:order|purchase|minimum)`, "gi"),
    new RegExp(String.raw`(?:消費)?滿\s*${CURRENCY}?\s?${AMOUNT}`, "gi"),
  ];
  for (const pattern of patterns) {
    for (const match of hay.matchAll(pattern)) {
      const symbol = symbolOf(match[1]) || "NT$";
      const value = parseAmount(match[2]);
      if (value > 0 && value !== discountValue && (match[1] !== undefined || /滿/.test(match[0]))) return { symbol, value };
    }
  }
  return null;
}

function freeShippingMinimum(hay: string): { symbol: string; value: number } | null {
  const match = new RegExp(String.raw`free\s+(?:standard\s+|express\s+)?(?:shipping|delivery)\s+(?:on|for|with)\s+(?:all\s+)?(?:orders?\s+|purchases?\s+)?(?:of\s+|over\s+|above\s+)?${CURRENCY}\s?${AMOUNT}|滿\s*${CURRENCY}?\s?${AMOUNT}\s*元?\s*免運`, "i").exec(hay);
  if (!match) return null;
  return { symbol: symbolOf(match[1] ?? match[3]) || "NT$", value: parseAmount(match[2] ?? match[4]) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Codes, channel, store
// ---------------------------------------------------------------------------------------------------------------------

const CODE_TRIGGER = String.raw`(?:\b(?:promo(?:tion(?:al)?)?|coupon|discount|offer|voucher)\s+code|\b(?:use|enter|apply|using|with|redeem|type)\s+(?:the\s+)?(?:(?:promo|coupon|discount)\s+)?code|\bcode|\bcoupon|折扣碼|優惠碼|折價碼|優惠代碼|折扣代碼|优惠码|序號)`;
const CODE_PATTERN = new RegExp(String.raw`${CODE_TRIGGER}\s*(?:[:=\-–]|is)?\s*["“'‘「『]?([A-Za-z0-9][A-Za-z0-9_-]{2,19})(?![A-Za-z0-9_-])`, "gi");
const NOT_CODES = new Set(["CODE", "PROMO", "COUPON", "ONLINE", "CHECKOUT", "ORDER", "BELOW", "ABOVE", "HERE"]);

/** Codes as written (uppercase, or letters with digits). Plain words after "code" ("use code at checkout") are not codes. */
export function findCodes(text: string): string[] {
  const codes: string[] = [];
  for (const match of normalize(text).matchAll(CODE_PATTERN)) {
    const token = match[1];
    const looksLikeCode = (token === token.toUpperCase() || /\d/.test(token)) && /[A-Za-z]/.test(token) && !NOT_CODES.has(token.toUpperCase());
    if (looksLikeCode && !codes.includes(token)) codes.push(token);
    if (codes.length === MAX_CODES) break;
  }
  return codes;
}

function channelOf(hay: string): PromotionChannel | null {
  const both = /\bonline\s+(?:and|or|&)\s+in[- ]stores?\b|\bin[- ]stores?\s+(?:and|or|&)\s+online\b|線上.{0,6}(?:門市|實體|店)|(?:門市|實體店?).{0,6}線上/.test(hay);
  if (both) return "both";
  const inStore = /\bin[- ]stores?\b|\bat (?:the |your |a )?(?:local )?store\b|\bpick(?:ing)? (?:it )?up\b|\bstore pickup\b|\bcurbside\b|門市|店內|實體店/.test(hay);
  const online = /\bonline only\b|\bonline exclusive\b|\bshop online\b|\border online\b|\bat checkout\b|\bonline orders?\b|線上|網路限定|官網/.test(hay);
  if (inStore && online) return "both";
  return inStore ? "in_store" : online ? "online" : null;
}

const GENERIC_SENDER_WORD = /\b(?:team|offers?|deals?|rewards?|newsletters?|emails?|promotions?|marketing|customer (?:care|service)|updates?|news)\b\s*$/i;
const MAIL_SERVICE_DOMAINS = [
  "sendgrid.net", "mailchimp.com", "mcsv.net", "rsgsv.net", "amazonses.com", "klaviyomail.com", "shopifyemail.com", "mailgun.org",
  "sparkpostmail.com", "exacttarget.com", "createsend.com", "cmail19.com", "cmail20.com", "constantcontact.com", "sendinblue.com",
  "brevo.com", "mandrillapp.com", "hubspotemail.net", "iterable.com", "braze.com", "email.mg",
];
const SECOND_LEVEL_LABELS = new Set(["co", "com", "org", "net", "gov", "edu", "ac"]);

/** The store's own domain: subdomains such as `e.` or `mail.` are dropped; a mail-service domain says nothing about the store. */
export function storeDomainOf(fromDomain: string | null): string | null {
  if (!fromDomain) return null;
  if (MAIL_SERVICE_DOMAINS.some((service) => fromDomain === service || fromDomain.endsWith(`.${service}`))) return null;
  const labels = fromDomain.split(".");
  const keep = labels.length >= 3 && labels.at(-1)!.length === 2 && SECOND_LEVEL_LABELS.has(labels.at(-2)!) ? 3 : 2;
  return labels.slice(-keep).join(".");
}

function storeNameOf(email: PromotionEmail, storeDomain: string | null): string {
  let name = (email.fromName ?? "").replace(/\S+@\S+/g, "").trim();
  while (GENERIC_SENDER_WORD.test(name) && name.replace(GENERIC_SENDER_WORD, "").trim() !== "") name = name.replace(GENERIC_SENDER_WORD, "").trim();
  if (name) return name;
  const label = storeDomain?.split(".")[0];
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : "Unknown store";
}

// ---------------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------------

function clip(value: string, max: number): string {
  const single = value.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

function headlineOf(discount: PromotionDiscount | null, symbol: string, pickup: boolean, minimum: { symbol: string; value: number } | null, perk: string | null, subject: string): string {
  const min = minimum ? formatAmount(minimum.symbol, minimum.value) : null;
  if (discount?.kind === "amount") {
    const order = min ? ` a ${min}${pickup ? " pickup" : ""} order` : pickup ? " a pickup order" : "";
    return `${formatAmount(symbol, discount.value ?? 0)} off${order}`;
  }
  if (discount?.kind === "percent") return `${discount.value}% off${min ? ` orders over ${min}` : pickup ? " pickup orders" : ""}`;
  if (discount?.kind === "free_shipping") return min ? `Free shipping on orders over ${min}` : "Free shipping";
  if (discount?.kind === "bogo") return "Buy one, get one";
  if (discount?.kind === "other" && perk) return perk.charAt(0).toUpperCase() + perk.slice(1);
  return clip(subject, MAX_HEADLINE_CHARS) || "Special offer";
}

/** True when the reading found anything worth listing: a discount, a code or an end date. */
export function hasOffer(reading: Pick<PromotionReading, "discount" | "codes" | "expiresAt">): boolean {
  return reading.discount !== null || reading.codes.length > 0 || reading.expiresAt !== null;
}

/** Reads one marketing email. Pure: no clock, no network. */
export function readPromotion(email: PromotionEmail, options: RulesOptions = {}): PromotionReading {
  const full = normalize(`${email.subject}\n${email.text}`);
  const hay = full.toLowerCase();
  const storeDomain = storeDomainOf(email.fromDomain);

  const primary = discountHits(hay).sort((a, b) => a.index - b.index)[0];
  let discount: PromotionDiscount | null = primary ? { ...primary.value.discount } : null;
  const symbol = primary?.value.symbol ?? "$";
  const shipping = FREE_SHIPPING.test(hay);
  const perk = OTHER_PERK.exec(hay)?.[0] ?? null;
  const shippingMinimum = shipping ? freeShippingMinimum(hay) : null;
  let minimum: { symbol: string; value: number } | null = null;
  if (discount && (discount.kind === "amount" || discount.kind === "percent")) {
    minimum = minSpendOf(hay, discount.kind === "amount" ? discount.value : null);
    if (minimum) {
      discount.minSpend = minimum.value;
      if (discount.currency === null && discount.kind === "percent") discount.currency = CURRENCY_CODES[minimum.symbol] ?? null;
    }
  } else if (!discount && shipping) {
    discount = { kind: "free_shipping", value: null, currency: shippingMinimum ? CURRENCY_CODES[shippingMinimum.symbol] ?? null : null, minSpend: shippingMinimum?.value ?? null };
    minimum = shippingMinimum;
  } else if (!discount && perk) {
    discount = { kind: "other", value: null, currency: null, minSpend: null };
  }

  const codes = findCodes(full);
  const expiresAt = resolveExpiry(full, email.date, options);
  const channel = channelOf(hay);
  const pickup = /\bpick(?:ing)? (?:it )?up\b|\bstore pickup\b|\bcurbside\b/.test(hay);
  const reading: PromotionReading = {
    store: storeNameOf(email, storeDomain),
    storeDomain,
    headline: headlineOf(discount, symbol, pickup, minimum, perk, email.subject),
    discount,
    codes,
    expiresAt,
    channel,
    confidence: 0,
  };
  const signals = (discount ? 0.25 : 0) + (codes.length > 0 ? 0.2 : 0) + (expiresAt ? 0.15 : 0) + (channel ? 0.05 : 0);
  reading.confidence = Math.round(Math.min(0.85, 0.35 + signals) * 100) / 100;
  return reading;
}

/** A Promotion for one email from a reading; the caller supplies the account and where the details came from. */
export function promotionFrom(email: PromotionEmail & { accountId?: string }, reading: PromotionReading, source: Promotion["source"]): Promotion {
  return {
    id: email.emailId,
    emailIds: [email.emailId],
    ...(email.accountId ? { accountId: email.accountId } : {}),
    store: reading.store,
    storeDomain: reading.storeDomain,
    receivedAt: email.date,
    headline: reading.headline,
    discount: reading.discount,
    codes: reading.codes,
    expiresAt: reading.expiresAt,
    channel: reading.channel,
    source,
    confidence: reading.confidence,
  };
}



