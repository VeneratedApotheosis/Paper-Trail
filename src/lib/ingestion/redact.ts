import { createHash } from "node:crypto";
import { customerNameHints, greetingNamePattern, namePattern, isPurchaseFact, type CustomerNameHints } from "./names";
import type { RawEmail, RedactedEmail, RedactionKind } from "@/lib/contracts";

/**
 * PII redaction (AGENTS.md hard rule #3): runs before any LLM call.
 * Replaces card numbers, phone numbers, street addresses, email addresses and customer names with numbered tokens
 * (`[PAN_1]`, `[PHONE_1]`, `[ADDRESS_1]`, `[EMAIL_1]`, `[NAME_1]`). The same value maps to the same token within one email
 * (subject and body share the numbering). Last-4 mentions ("ending in 4242") are kept: last4 is allowed.
 */

const TOKEN_LABEL: Record<RedactionKind, string> = {
  pan: "PAN",
  phone: "PHONE",
  address: "ADDRESS",
  email: "EMAIL",
  name: "NAME",
};

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** 13-19 digits with optional single space/dash separators, not glued to other digits, letters, '#' or '-'. */
const PAN_PATTERN = /(?<![\w#-])(?<!\d[ -])\d(?:[ -]?\d){12,18}(?![\w-])(?![ -]\d)/g;

/**
 * US phone numbers: (555) 012-3456, 555-012-3456, 555.012.3456, +1 555 012 3456, and 7-digit 555-0123.
 * Separators are required so bare digit runs (order numbers, SKUs) are not touched.
 */
const PHONE_PATTERN =
  /(?<![\w#〒-])(?<!\d[ .-])(?:(?:\+?1[ .-]?)?(?:\(\d{3}\)[ .-]?|\d{3}[ .-])\d{3}[ .-]\d{4}|\d{3}[.-]\d{4})(?![\w-])(?![ .-]\d)/g;

const INTERNATIONAL_PHONE = /(?<![\w#])\+[1-9](?:[ \t().-]*\d){6,14}(?![\w]|[ \t().-]*\d)/g;
const BARE_PHONE = /(?<![\w#-])\d{10,11}(?![\w-])/g;
/**
 * Local-format numbers (020 7946 0958, 07911 123456, 98765 43210, 03-1234-5678, 0044 20 7946 0958). Only redacted
 * right after a phone label (see `hasPhoneLabelBefore`); amounts, ids and dates must never be touched.
 */
const LABELED_LOCAL_PHONE = /(?<![\w#+$€£¥.,-])\(?\d[\d \t().-]{6,18}\d(?![\w%]|[.,]\d)/g;
const DATE_SHAPED = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4})$/;

/** Case-insensitive literal without the `i` flag: with `iu`, `\p{Lu}` would also match lowercase letters. */
function anyCase(word: string): string {
  return [...word].map(char => {
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    return lower === upper || upper.length !== 1 ? char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : `[${lower}${upper}]`;
  }).join("");
}

const NAME_WORD = String.raw`\p{Lu}[\p{L}’'-]*`;
const FRENCH_STREET_TYPE = ["rue", "avenue", "boulevard", "chemin", "route", "allée", "allee", "place", "impasse", "quai", "cours"].map(anyCase).join("|");
const FRENCH_PARTICLE = String.raw`(?:(?:${anyCase("de")}[ \t]+${anyCase("la")}|${anyCase("des")}|${anyCase("du")}|${anyCase("de")}|${anyCase("la")}|${anyCase("les")}|${anyCase("le")})[ \t]+|(?:${anyCase("de")}[ \t]+)?[dDlL]['’])`;

/**
 * `12 rue de Rivoli`, `3 place de la République`, `5 Rue Rivoli`. The street name must be introduced by a particle
 * (up to 4 words, ending at a comma, newline or postcode) or be 1-2 capitalized words followed by a comma or postcode,
 * so "5 Boulevard Coffee Beans $12" and "2 Route Planner Pro" are left alone.
 */
const FRENCH_ADDRESS = new RegExp(
  String.raw`\b\d{1,6}[ \t]+(?:${FRENCH_STREET_TYPE})[ \t]+(?:${FRENCH_PARTICLE}[\p{L}][\p{L}’'-]*(?:[ \t]+[\p{L}][\p{L}’'-]*){0,3}(?=[ \t]*(?:,|\r?\n|$)|[ \t]+\d{4,5}\b)|${NAME_WORD}(?:[ \t]+${NAME_WORD})?(?=[ \t]*,|[ \t]+\d{4,5}\b))`,
  "gmu",
);
/** `Hauptstrasse 5`, `Berliner Str. 5`, `Keizersgracht 123`. */
const GERMANIC_ADDRESS = /\b(?:[\p{L}.’'-]*(?:straße|strasse|str\.|weg|platz|gasse|straat|gracht|laan|plein)[ \t]+\d{1,6}[a-z]?|\p{L}[\p{L}-]*[ \t]+str\.?[ \t]+\d{1,6}[a-z]?)(?![\p{L}\d])/giu;
/** `Calle Mayor 12`, `Via Roma 10`: capitalized keyword and name so "shipped via Standard 5-7 days" is left alone. */
const SOUTHERN_EUROPEAN_ADDRESS = /\b(?:Calle|calle|Carrer|Avenida|Via|Viale|Piazza)[ \t]+(?:(?:de|del|della|di|la)[ \t]+)?\p{Lu}\p{Ll}[\p{L}’'-]*(?:[ \t]+\p{Lu}\p{Ll}[\p{L}’'-]*){0,2},?[ \t]+(?:n[º°o.]*[ \t]*)?\d{1,6}[A-Za-z]?(?![\p{L}\d])/gu;
const PO_BOX = /\b(?:P\.?[ \t]?O\.?[ \t]*Box|Postfach)[ \t]+\d{1,7}\b/g;
const LITERAL_ADDRESS_PATTERNS = [GERMANIC_ADDRESS, FRENCH_ADDRESS, SOUTHERN_EUROPEAN_ADDRESS, PO_BOX];

const CITY = String.raw`\p{Lu}[\p{L} .’'-]*`;
const UK_CODE = String.raw`[A-Z]{1,2}\d[A-Z\d]?[ \t]*\d[A-Z]{2}`;
const CA_CODE = String.raw`[A-Z]\d[A-Z][ \t-]?\d[A-Z]\d`;
const US_ZIP = String.raw`\d{5}(?:-\d{4})?`;
const POSTAL_COUNTRY = String.raw`(?:,?[ \t]+(?:USA|US|United States|Canada|France|Germany|Deutschland|UK|United Kingdom))?`;
/** Words that follow a 4-6 digit amount or count, never a postcode: `12800 JPY`, `1500 Pts`, `12345 Items shipped`. */
const AMOUNT_UNIT = "JPY|EUR|USD|GBP|CAD|AUD|NZD|PLN|SEK|NOK|DKK|CHF|CZK|HUF|KRW|CNY|INR|MXN|BRL|Pts|Points?|Items?|Qty|Units?|Pcs";
/**
 * A line that is only a postal tail, recognised anywhere: a bare UK/CA code, or "City, ST 12345" / "City, ON M5V 2B7"
 * with the comma that real addresses carry. Case-sensitive: "Qty OR 10001" and "Color Red ID 12345" are not addresses.
 */
const POSTAL_LINE = new RegExp(
  String.raw`^(?:(?:${UK_CODE}|${CA_CODE})|${CITY},[ \t]+[A-Z]{2}[ \t]+${US_ZIP}|(?:${CITY},[ \t]+)?[A-Z]{2}[ \t]+${CA_CODE})${POSTAL_COUNTRY}$`,
  "u",
);
/**
 * Looser postal tails, only accepted directly under an address (a street token or a Ship to / Billing / Address label)
 * or after a street on the same line: "London SW1A 2AA", "Toronto ON M5V 2B7", "Springfield IL 62704", "10115 Berlin".
 */
const POSTAL_TAIL = new RegExp(
  String.raw`^(?:(?:${CITY}[ \t]+)?(?:${UK_CODE}|(?:[A-Z]{2}[ \t]+)?${CA_CODE})|${CITY},?[ \t]+[A-Z]{2}[ \t]+${US_ZIP}|\d{4,6}[ \t]+(?!(?:${AMOUNT_UNIT})\b)${CITY})${POSTAL_COUNTRY}$`,
  "u",
);
/** Labels that open an address block; "Shipping:"/"Billing:" alone only count when nothing but a name follows. */
const ADDRESS_LABEL_LINE =
  /(?:\b(?:(?:ship(?:ping)?|bill(?:ing)?|deliver(?:y)?|sold|send|mail|return)[ \t]+(?:to|address)|address|adresse|direcci[oó]n|recipient)\b[^\n]{0,60}|\b(?:shipping|billing|delivery)[ \t]*:?[ \t]*(?:\[NAME_\d+\])?[ \t]*)$/i;

/** True when one of the two previous non-blank lines holds an address token or opens an address block. */
function followsAddressContext(lines: readonly string[], index: number): boolean {
  let inspected = 0;
  for (let i = index - 1; i >= 0 && inspected < 2; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    inspected += 1;
    if (/\[ADDRESS_\d+\]/.test(line) || ADDRESS_LABEL_LINE.test(line)) return true;
  }
  return false;
}

const STREET_SUFFIX =
  "Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy|Highway|Hwy|Gardens|Gdns|Close|Crescent|Cres|Square|Sq|Grove|Mews";
const DIRECTIONAL = String.raw`(?:[ \t]+(?:NE|NW|SE|SW|N|S|E|W)\b\.?)?`;
const UNIT = String.raw`(?:,?[ \t]*(?:Apt|Apartment|Unit|Suite|Ste|#)\.?[ \t]*#?[A-Za-z0-9-]+)?`;
const CITY_STATE_ZIP = String.raw`(?:,[ \t]*[A-Z][A-Za-z.' -]*,[ \t]*[A-Z]{2}[ \t]+\d{5}(?:-\d{4})?)?`;

/**
 * House number + 1-4 capitalized street-name words + suffix, optional direction ("Queen St W"), unit and
 * "City, ST 12345" tail. Not followed by another capitalized word, so product names like "2 Pack Court Shoes" are left alone.
 */
const ADDRESS_PATTERN = new RegExp(
  String.raw`\b\d{1,6}[ \t]+(?:[A-Z0-9][A-Za-z0-9.'-]*[ \t]+){1,4}(?:${STREET_SUFFIX})\b\.?${DIRECTIONAL}${UNIT}${CITY_STATE_ZIP}(?![ \t]+[A-Z][a-z])`,
  "g",
);
/**
 * A digit run right after one of these labels is an order/tracking/SKU reference, not a PAN or phone.
 * Matched against folded text immediately preceding the candidate on the same line.
 */
const PROTECTED_LABEL =
  /(?:\b(?:order|pedido|invoice|factura|tracking|confirmation|ref|reference|sku|item|style|model|upc|serial|rma|numero|number|no\.?|id|zip(?: code)?|postal(?: code)?|postcode|plz)|#)[ \t]*(?:#|no\.?|number|id)?[ \t]*[:#]?[ \t]*$/i;

/** Words that mark a labeled value as PII even when a protected label is also present. */
const PII_CONTEXT: Record<"pan" | "phone", RegExp> = {
  pan: /\b(?:card|visa|mastercard|amex|discover|tarjeta|credit|debit|pan)\b/i,
  phone: /\b(?:phone|tel|t\u00e9l|telephone|t\u00e9l\u00e9phone|telefon|call|text|mobile|cell|fax|telefono|tel\u00e9fono|handy|whatsapp)\b/i,
};

/** A phone label shortly before the number on the same line, with no reference word ("order", "SKU") in between. */
const PHONE_LABEL_BEFORE = /\b(?:phone|tel|t\u00e9l|telephone|t\u00e9l\u00e9phone|telefon|telefono|tel\u00e9fono|mobile|mobil|handy|cell|call|fax|whatsapp|contact number)\b([^\d\n]{0,24})$/i;
const REFERENCE_WORD = /\b(?:order|pedido|invoice|factura|tracking|confirmation|ref|reference|sku|item|style|model|upc|serial|rma|numero)\b/i;

function hasPhoneLabelBefore(text: string, offset: number): boolean {
  const match = PHONE_LABEL_BEFORE.exec(lineContextBefore(text, offset));
  return match !== null && !REFERENCE_WORD.test(match[1]);
}

/** Text of the current line before `offset`, capped at 40 chars. */
function lineContextBefore(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return text.slice(Math.max(lineStart, offset - 40), offset);
}

function isLabeledReference(kind: "pan" | "phone", text: string, offset: number): boolean {
  const before = lineContextBefore(text, offset);
  return PROTECTED_LABEL.test(before) && !PII_CONTEXT[kind].test(before);
}

/** Luhn checksum; card numbers pass it, most random digit runs don't. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

class Redactor {
  private readonly tokens: Record<RedactionKind, Map<string, string>> = {
    pan: new Map(),
    phone: new Map(),
    address: new Map(),
    email: new Map(),
    name: new Map(),
  };

  readonly counts: Record<RedactionKind, number> = { pan: 0, phone: 0, address: 0, email: 0, name: 0 };

  constructor(private readonly hints: CustomerNameHints) {}

  private token(kind: RedactionKind, key: string): string {
    const known = this.tokens[kind];
    let token = known.get(key);
    if (!token) {
      token = `[${TOKEN_LABEL[kind]}_${known.size + 1}]`;
      known.set(key, token);
    }
    this.counts[kind] += 1;
    return token;
  }

  /** Order matters: emails and names first; international phones before PANs, then local phones and addresses. */
  redactText(text: string): string {
    let out = text.replace(EMAIL_PATTERN, (match) => this.token("email", match.toLowerCase()));
    for (const name of this.hints.names) {
      out = out.replace(namePattern(name), (match: string, offset: number, whole: string) =>
        isPurchaseFact(whole, offset, match) ? match : this.token("name", name.toLowerCase()));
    }
    for (const name of this.hints.greetingNames) {
      out = out.replace(greetingNamePattern(name), (_match: string, greeting: string) => greeting + this.token("name", name.toLowerCase()));
    }
    out = out.replace(INTERNATIONAL_PHONE, (match: string, offset: number, whole: string) => {
      // "SKU +12345678" and "+1234567 pts" are not phones: without a phone label need 10+ digits or grouping.
      const plausible = hasPhoneLabelBefore(whole, offset) || /\d[ \t().-]+\d/.test(match) || match.replace(/\D/g, "").length >= 10;
      if (!plausible || isLabeledReference("phone", whole, offset)) return match;
      return this.token("phone", normalizePhone(match));
    });
    out = out.replace(PAN_PATTERN, (match: string, offset: number, whole: string) => {
      const digits = match.replace(/\D/g, "");
      if (!passesLuhn(digits) || isLabeledReference("pan", whole, offset)) return match;
      return this.token("pan", digits);
    });
    out = out.replace(PHONE_PATTERN, (match: string, offset: number, whole: string) => {
      if (isLabeledReference("phone", whole, offset)) return match;
      return this.token("phone", normalizePhone(match));
    });
    out = out.replace(BARE_PHONE, (match: string, offset: number, whole: string) => {
      const lineEnd = whole.indexOf("\n", offset);
      const after = whole.slice(offset + match.length, lineEnd < 0 ? undefined : lineEnd).slice(0, 30);
      if (!PII_CONTEXT.phone.test(lineContextBefore(whole, offset) + after) || isLabeledReference("phone", whole, offset)) return match;
      return this.token("phone", normalizePhone(match));
    });
    out = out.replace(LABELED_LOCAL_PHONE, (match: string, offset: number, whole: string) => {
      const digits = match.replace(/\D/g, "").length;
      if (digits < 7 || digits > 15 || DATE_SHAPED.test(match.trim()) || !hasPhoneLabelBefore(whole, offset)) return match;
      return this.token("phone", normalizePhone(match));
    });
    for (const pattern of LITERAL_ADDRESS_PATTERNS) {
      out = out.replace(pattern, match => this.token("address", match.toLowerCase().trim()));
    }
    out = out.replace(ADDRESS_PATTERN, (match) =>
      this.token("address", match.toLowerCase().replace(/[\s.,]+/g, " ").trim()),
    );
    return this.redactPostalLines(out);
  }

  /** Postal tails after a street token and postal lines under an address; monetary/order lines stay intact. */
  private redactPostalLines(text: string): string {
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const streetToken = /\[ADDRESS_\d+\]/.exec(line);
      if (streetToken) {
        const start = streetToken.index + streetToken[0].length;
        const tail = line.slice(start).replace(/^[, \t]+/, "").trim();
        if (POSTAL_LINE.test(tail) || POSTAL_TAIL.test(tail)) lines[index] = line.slice(0, start) + " " + this.token("address", tail.toLowerCase());
        continue;
      }
      const trimmed = line.trim();
      if (POSTAL_LINE.test(trimmed) || (POSTAL_TAIL.test(trimmed) && followsAddressContext(lines, index))) {
        lines[index] = this.token("address", trimmed.toLowerCase());
      }
    }
    return lines.join("\n");
  }
}
/** sha256 hex of the redacted text; the LLM cache key. */
export function hashRedactedText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Redacts the subject and body of one email and drops `html`.
 * `redactions` counts replaced occurrences per kind (all kinds always present).
 * Headers (`from`, `to`) are passed through unchanged.
 */
export function redact(email: RawEmail): RedactedEmail {
  const redactor = new Redactor(customerNameHints(email));
  const subject = redactor.redactText(email.subject);
  const text = redactor.redactText(email.text);
  const withoutHtml: RawEmail = { ...email };
  delete withoutHtml.html;
  return {
    ...withoutHtml,
    subject,
    text,
    redactions: { ...redactor.counts },
    textHash: hashRedactedText(text),
  };
}
