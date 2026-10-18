import { isCommercePlatform } from "@/lib/ingestion/classify";
import { senderDisplayName, senderDomain } from "@/lib/ingestion/text";

/**
 * Merchant identity for dedup (#126). The LLM spells a store many ways ("Amazon", "Amazon.com", "AMAZON MARKETPLACE");
 * the sender's registrable domain and a small alias table are steadier. Each email gets a SET of identity keys, and two
 * emails are the same merchant when their key sets intersect, so one weak key can never merge two merchants on its own.
 * Pure.
 */

/** Public suffixes with two labels, for the registrable-domain cut (`shop.example.co.uk` -> `example.co.uk`). */
const TWO_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "com.au", "net.au", "co.nz", "co.jp", "ne.jp", "com.tw", "com.hk", "com.sg", "com.my",
  "com.br", "com.mx", "com.ar", "co.in", "co.kr", "com.cn", "com.tr", "co.za", "co.il", "com.ph", "co.th", "com.vn",
]);

/** Mailbox providers: a message sent from one says nothing about the shop (forwards, hand-sent receipts). */
const MAILBOX_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "ymail.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "qq.com", "163.com",
  "126.com", "naver.com", "yahoo.co.jp", "yahoo.com.tw", "mail.com", "zoho.com", "fastmail.com",
]);

interface MerchantAlias {
  id: string;
  /** Matches the registrable domain. */
  domain: RegExp;
  /** Matches the folded merchant name. */
  name: RegExp;
}

/** One entry per merchant whose domains or names vary by country or marketplace. Extend as real inboxes show more. */
const MERCHANT_ALIASES: readonly MerchantAlias[] = [
  { id: "amazon", domain: /^(?:amazon\.[a-z.]+|amzn\.[a-z]+)$/, name: /^amazon(?:\.[a-z.]+)?\b/ },
  { id: "apple", domain: /^(?:apple\.com|itunes\.com)$/, name: /^(?:apple|itunes)\b/ },
  { id: "ebay", domain: /^ebay\.[a-z.]+$/, name: /^ebay\b/ },
  { id: "walmart", domain: /^walmart\.[a-z.]+$/, name: /^walmart\b/ },
  { id: "target", domain: /^target\.com$/, name: /^target\b/ },
  { id: "bestbuy", domain: /^bestbuy\.[a-z.]+$/, name: /^best ?buy\b/ },
  { id: "aliexpress", domain: /^aliexpress\.[a-z.]+$/, name: /^ali ?express\b/ },
];

const NAME_NOISE_WORDS = new Set(["inc", "llc", "ltd", "limited", "co", "corp", "corporation", "company", "gmbh", "the", "com"]);
const FORWARD_SUBJECT = /^\s*(?:fwd?|fw|wg|tr|rv)\s*:/i;

/** `mail.shop.example.co.uk` -> `shop.example.co.uk`'s registrable part: `example.co.uk`. */
export function registrableDomain(host: string): string {
  const labels = host.trim().toLowerCase().replace(/^www\./, "").split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return TWO_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

function foldName(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function aliasOfDomain(domain: string): string | null {
  return MERCHANT_ALIASES.find((alias) => alias.domain.test(domain))?.id ?? null;
}

function aliasOfName(folded: string): string | null {
  return MERCHANT_ALIASES.find((alias) => alias.name.test(folded))?.id ?? null;
}

/** Words of the name without corporate suffixes and `.com`, joined with `-`; empty when nothing meaningful is left. */
function nameSlug(folded: string): string {
  return folded
    .replace(/\.(?:com|net|org|co\.[a-z]{2}|[a-z]{2})\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "" && !NAME_NOISE_WORDS.has(word))
    .join("-");
}

/** A domain that can identify the shop: not a mailbox provider and not a platform that sends for many shops. */
function shopDomain(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const registrable = registrableDomain(domain);
  if (registrable === "" || MAILBOX_DOMAINS.has(registrable) || isCommercePlatform(registrable)) return null;
  return registrable;
}

export interface MerchantEvidence {
  from: string;
  subject: string;
  merchant: string | null;
  merchantDomain?: string | null;
}

/**
 * Identity keys of one email: `alias:<id>` (alias table), `dom:<registrable domain>` and `name:<slug>`.
 * The sender's domain is ignored for forwards and for mailbox/platform senders (the shop is then read from the
 * extracted name and domain only).
 */
export function merchantKeys(evidence: MerchantEvidence): string[] {
  const keys = new Set<string>();
  const addDomain = (domain: string | null) => {
    if (!domain) return;
    const alias = aliasOfDomain(domain);
    keys.add(alias ? `alias:${alias}` : `dom:${domain}`);
  };
  const sender = FORWARD_SUBJECT.test(evidence.subject) ? null : shopDomain(senderDomain(evidence.from));
  addDomain(sender);
  addDomain(shopDomain(evidence.merchantDomain));
  // A platform (Shopify, Shopline, Square, ...) sends for many shops: its display name is the shop.
  const senderName = senderDisplayName(evidence.from);
  const senderHost = senderDomain(evidence.from);
  if (senderName && senderHost && isCommercePlatform(registrableDomain(senderHost)) && !FORWARD_SUBJECT.test(evidence.subject)) {
    const slug = nameSlug(foldName(senderName));
    if (slug !== "") keys.add(`name:${slug}`);
  }
  if (evidence.merchant) {
    const folded = foldName(evidence.merchant);
    const alias = aliasOfName(folded);
    if (alias) keys.add(`alias:${alias}`);
    const slug = nameSlug(folded);
    if (slug !== "") keys.add(`name:${slug}`);
  }
  return [...keys].sort();
}

/** True when the two key sets share a key. */
export function sameMerchant(a: readonly string[], b: readonly string[]): boolean {
  return a.some((key) => b.includes(key));
}
