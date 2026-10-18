import type { RawEmail } from "@/lib/contracts";

const PERSON = String.raw`\p{Lu}[\p{L}'’.-]*(?:[ \t]+\p{Lu}[\p{L}'’.-]*){0,4}`;
const GENERIC = /^(?:customer|valued customer|friend|there|sir|madam|support|team)$/i;
const HONORIFIC = /^(?:mr|mrs|ms|miss|mx|dr|prof)\.?$/i;
/** Words that make a hinted "name" an organisation, a place or a greeting filler instead of a person. */
const NOT_A_PERSON = /^(?:customers?|members?|guests?|valued|shopper|user|subscriber|account|holder|team|support|service|services|corp|corporation|inc|llc|ltd|limited|co|company|gmbh|locker|office|store|shop|home|warehouse|pickup|hotel|reception|lobby|neighbou?r|friend|there|everyone|all)\.?$/i;
const MONTH_WORD = /^(?:January|February|March|April|May|June|July|August|September|October|November|December)$/i;
/** Colours are everywhere in receipts; a surname that is also a colour is not expanded to a stand-alone token. */
const COLOUR_WORD = /^(?:black|white|green|brown|grey|gray|blue|red|pink|gold|silver|orange|purple|yellow|navy|beige|cream)$/i;
/** Contact-detail words that surround a real "Name:" line (the line before or after it). */
const NAME_BLOCK_CONTEXT = /@|\b(?:phone|tel|mobile|e-?mail|address|ship(?:ping)?|bill(?:ing)?|contact|customer|deliver(?:y)?)\b/i;
const HONORIFICS = ["Mr.", "Mrs.", "Ms.", "Miss", "Mx.", "Dr."];
const GREETING = String.raw`(?:Hi|Hello|Dear|Hey|Hola|Bonjour)`;
const SENDER_NOISE = new Set(["com", "net", "org", "mail", "email", "orders", "order", "noreply", "info", "example", "service", "store", "shop", "the", "and"]);

export interface CustomerNameHints {
  /** Redacted wherever they appear in the email. */
  names: string[];
  /**
   * Only redacted in the salutation line that named them ("Hi Priya,"). A first name found there is too ambiguous to
   * hide elsewhere: it may be a brand, product or month ("Hello Jordan" vs "Jordan 1 Retro", "Dear May" vs "May 12").
   */
  greetingNames: string[];
}

/** The lines directly before and after the line that contains `index`. */
function neighbourLines(text: string, index: number): string {
  const lines = text.split("\n");
  const lineNumber = text.slice(0, index).split("\n").length - 1;
  return `${lines[lineNumber - 1] ?? ""}\n${lines[lineNumber + 1] ?? ""}`;
}
/** Lowercase words of the sender display name and domain: "Hi Amazon Customer" must not hide the merchant. */
function senderWords(from: string): Set<string> {
  const words = new Set<string>();
  const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
  const display = from.replace(/<[^>]*>/, "");
  const domain = address.includes("@") ? address.slice(address.lastIndexOf("@") + 1) : "";
  for (const word of `${display} ${domain.replace(/\./g, " ")}`.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (word.length >= 3 && !SENDER_NOISE.has(word)) words.add(word);
  }
  return words;
}

function stripWord(word: string): string {
  return word.replace(/[.’']/g, "").toLowerCase();
}

/** A salutation or label value that can be trusted as a person: no organisation/place words, not the sender. */
function isPersonLike(words: string[], sender: Set<string>): boolean {
  return !words.some(word => NOT_A_PERSON.test(word) || sender.has(stripWord(word)));
}

function withoutHonorific(words: string[]): string[] {
  return words.length > 1 && HONORIFIC.test(words[0]) ? words.slice(1) : words;
}

function validPerson(value: string): boolean {
  return new RegExp(`^${PERSON}$`, "iu").test(value);
}

/** Local hints only: recipient display names, salutations and explicit customer/shipping/cardholder labels. */
export function customerNameHints(email: RawEmail): CustomerNameHints {
  const names = new Set<string>();
  const greetingNames = new Set<string>();
  const sender = senderWords(email.from);

  function add(value: string) {
    const name = value.trim().replace(/^"|"$/g, "").trim().replace(/(?<=\p{L}{3})\.$/u, "");
    if (name.length < 2 || GENERIC.test(name) || !validPerson(name)) return;
    names.add(name);
  }

  /** The To display name is the only source of stand-alone first/last name tokens. */
  function addRecipient(display: string) {
    const trimmed = display.trim();
    const surnameFirst = /^([^,]+),[ \t]*([^,]+)$/.exec(trimmed);
    const name = surnameFirst ? `${surnameFirst[2].trim()} ${surnameFirst[1].trim()}` : trimmed;
    if (!validPerson(name) || GENERIC.test(name)) return;
    add(name);
    if (surnameFirst) names.add(trimmed);
    const words = name.split(/\s+/);
    if (words.length < 2) return;
    const [first] = words;
    const last = words[words.length - 1];
    if (first.length >= 3 && !GENERIC.test(first) && !NOT_A_PERSON.test(first)) names.add(first);
    if (last.length >= 4 && !NOT_A_PERSON.test(last) && !MONTH_WORD.test(last) && !COLOUR_WORD.test(last) && !sender.has(stripWord(last))) {
      names.add(last);
    } else if (last.length >= 2 && !NOT_A_PERSON.test(last) && !MONTH_WORD.test(last) && !COLOUR_WORD.test(last) && !sender.has(stripWord(last))) {
      // Short surnames ("Doe") are too ambiguous alone, but "Ms. Doe" is clearly the customer.
      for (const honorific of HONORIFICS) names.add(`${honorific} ${last}`);
    }
  }

  for (const match of (email.to ?? "").matchAll(/(?:"([^"]*)"|([^<>,"]+?))[ \t]*<[^>]*>/g)) addRecipient(match[1] ?? match[2]);
  const hasRecipientName = names.size > 0;
  const text = `${email.subject}\n${email.text}`;

  function addGreetingFirstName(words: string[]) {
    const first = words[0];
    if (first.length >= 3 && !GENERIC.test(first) && !names.has(first)) greetingNames.add(first);
  }

  // A draft can greet merchant support. A known recipient name is stronger than a salutation guess.
  if (!hasRecipientName) {
    const salutation = new RegExp(String.raw`^${GREETING}[ ,\t]+(${PERSON})(?=[,:!\n\r]|$)`, "gimu");
    for (const match of text.matchAll(salutation)) {
      const words = withoutHonorific(match[1].trim().split(/\s+/));
      if (!isPersonLike(words, sender) || GENERIC.test(words.join(" "))) continue;
      if (words.length >= 2) {
        add(words.join(" "));
        addGreetingFirstName(words);
      } else {
        addGreetingFirstName(words);
      }
    }
  }

  // Labels give a full name, so a single capitalized word ("Customer: Dr. Martens", "Name: Jordan") is not enough.
  const labels = [
    String.raw`(?:Customer(?: name)?|Ship(?:ping)? to|Bill(?:ing)? to|Shipping address|Billing address|Deliver to|Sold to|Recipient|Card ?holder(?: name)?|Account holder|Name on card)[ \t]*:[ \t]*(?:\r?\n)?`,
    String.raw`(?:Order for|Placed by|Order placed by)[ \t]*:?[ \t]*`,
    String.raw`Thank(?:s| you)(?: for [^,\n]{1,40})?,[ \t]*`,
    String.raw`Name[ \t]*:[ \t]*`,
  ];
  for (const [index, label] of labels.entries()) {
    const pattern = new RegExp(String.raw`^${label}(${PERSON})(?=[,:!.\n\r]|$)`, "gimu");
    for (const match of text.matchAll(pattern)) {
      const words = withoutHonorific(match[1].trim().split(/\s+/));
      if (words.length < 2 || (index > 0 && words.length > 3) || !isPersonLike(words, sender)) continue;
      // A bare "Name:" also labels products and plans; only trust it inside a block of contact details.
      if (index === 3 && !NAME_BLOCK_CONTEXT.test(neighbourLines(text, match.index))) continue;
      add(words.join(" "));
      addGreetingFirstName(words);
    }
  }
  return { names: [...names].sort((a, b) => b.length - a.length), greetingNames: [...greetingNames] };
}

export function namePattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\./g, "\\.?");
  return new RegExp(`(?<![\\p{L}\\p{N}#/_-])${escaped}(?![\\p{L}\\p{N}#/_-])`, "giu");
}

/** Matches `name` only as the addressee of a salutation line: "Hi Priya," -> group 1 is the greeting, kept as is. */
export function greetingNamePattern(name: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`^(${GREETING}[ ,\t]+(?:(?:Mr|Mrs|Ms|Miss|Mx|Dr|Prof)\.?[ \t]+)?)${escaped}(?=[,:!\n\r]|$)`, "gimu");
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
