import type { RawEmail } from "@/lib/contracts";

const PERSON = String.raw`\p{Lu}[\p{L}'’.-]*(?:[ \t]+\p{Lu}[\p{L}'’.-]*){0,4}`;
const GENERIC = /^(?:customer|valued customer|friend|there|sir|madam|support|team)$/i;

/** Local hints only: recipient display names, salutations and explicit customer/shipping labels. */
export function customerNames(email: RawEmail): string[] {
  const names = new Set<string>();
  function add(value: string) {
    const name = value.trim().replace(/^"|"$/g, "").trim();
    if (name.length < 2 || GENERIC.test(name) || !new RegExp(`^${PERSON}$`, "iu").test(name)) return;
    names.add(name);
  }
  for (const match of (email.to ?? "").matchAll(/(?:^|,)\s*"?([^"<>,]+)"?\s*</g)) add(match[1]);
  const text = `${email.subject}\n${email.text}`;
  const hints = [
    new RegExp(String.raw`^(?:Hi|Hello|Dear|Hey|Hola|Bonjour)[ ,\t]+(${PERSON})(?=[,:!\n\r]|$)`, "gimu"),
    new RegExp(String.raw`^(?:Customer(?: name)?|Name|Ship(?:ping)? to|Bill(?:ing)? to|Shipping address|Billing address|Deliver to|Sold to|Recipient)[ \t]*:[ \t]*(?:\r?\n)?(${PERSON})(?=[,:\n\r]|$)`, "gimu"),
  ];
  const hasRecipientName = names.size > 0;
  for (const [index, pattern] of hints.entries()) {
    // A draft can greet merchant support. A known recipient name is stronger than a salutation guess.
    if (index === 0 && hasRecipientName) continue;
    for (const match of text.matchAll(pattern)) add(match[1]);
  }
  // Receipts commonly greet the recipient by first name after giving their full name in the To header.
  for (const name of [...names]) {
    const first = name.split(/\s+/)[0];
    if (first.length >= 3 && !GENERIC.test(first)) names.add(first);
  }
  return [...names].sort((a, b) => b.length - a.length);
}

export function namePattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}#/_-])${escaped}(?![\\p{L}\\p{N}#/_-])`, "giu");
}

const MONTH = /^(?:January|February|March|April|May|June|July|August|September|October|November|December)$/i;
const REFERENCE_PREFIX = /\b(?:order|tracking|sku|item|ref|reference|invoice)(?:[ \t]+(?:number|no\.?|ref|id))?[ \t]*[:#]?[ \t]*$/i;

/** Names can also be months or order-id fragments. Preserve explicit structured purchase facts. */
export function isPurchaseFact(text: string, offset: number, value: string): boolean {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const before = text.slice(Math.max(start, offset - 60), offset);
  if (REFERENCE_PREFIX.test(before)) return true;
  if (!MONTH.test(value)) return false;
  const after = text.slice(offset + value.length, offset + value.length + 30);
  return /^[ \t]+(?:[0-2]?\d|3[01])(?:st|nd|rd|th)?\b/i.test(after)
    || /^[ \t]+(?:19|20)\d{2}\b/.test(after)
    || /\b(?:[0-2]?\d|3[01])(?:st|nd|rd|th)?[ \t]+$/i.test(before);
}
