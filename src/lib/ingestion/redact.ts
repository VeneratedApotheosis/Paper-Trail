import { createHash } from "node:crypto";
import { customerNames, namePattern } from "./names";
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
  /(?<![\w#-])(?<!\d[ .-])(?:(?:\+?1[ .-]?)?(?:\(\d{3}\)[ .-]?|\d{3}[ .-])\d{3}[ .-]\d{4}|\d{3}[.-]\d{4})(?![\w-])(?![ .-]\d)/g;

const INTERNATIONAL_PHONE = /(?<![\w#])\+[1-9](?:[ \t().-]*\d){6,14}(?![\w]|[ \t().-]*\d)/g;
const BARE_PHONE = /(?<![\w#-])\d{10,11}(?![\w-])/g;
const INTERNATIONAL_ADDRESS = /\b(?:\d{1,6}[ \t]+(?:rue|avenue|boulevard|chemin|route|allée|allee)[ \t]+[\p{L}][\p{L} .’'-]{1,65}|[\p{L}.’'-]*(?:straße|strasse|weg|platz|gasse)[ \t]+\d{1,6}[a-z]?)(?![\p{L}\d])/giu;
const POSTAL_LINE = /^(?:(?:[\p{L}][\p{L} .’'-]*[ \t]+)?[A-Z]{1,2}\d[A-Z\d]?[ \t]*\d[A-Z]{2}|[\p{L}][\p{L} .’'-]*,?[ \t]+[A-Z]{2}[ \t]+\d{5}(?:-\d{4})?|(?:[\p{L}][\p{L} .’'-]*,?[ \t]+)?(?:[A-Z]{2}[ \t]+)?[A-Z]\d[A-Z][ -]?\d[A-Z]\d|\d{4,6}[ \t]+[\p{L}][\p{L} .’'-]*)(?:,?[ \t]+(?:USA|United States|Canada|France|Germany|Deutschland))?$/iu;

const STREET_SUFFIX =
  "Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Way|Court|Ct|Place|Pl|Terrace|Ter|Circle|Cir|Parkway|Pkwy|Highway|Hwy";
const UNIT = String.raw`(?:,?[ \t]*(?:Apt|Apartment|Unit|Suite|Ste|#)\.?[ \t]*#?[A-Za-z0-9-]+)?`;
const CITY_STATE_ZIP = String.raw`(?:,[ \t]*[A-Z][A-Za-z.' -]*,[ \t]*[A-Z]{2}[ \t]+\d{5}(?:-\d{4})?)?`;

/**
 * House number + 1-4 capitalized street-name words + suffix, optional unit and "City, ST 12345" tail.
 * Not followed by another capitalized word, so product names like "2 Pack Court Shoes" are left alone.
 */
const ADDRESS_PATTERN = new RegExp(
  String.raw`\b\d{1,6}[ \t]+(?:[A-Z0-9][A-Za-z0-9.'-]*[ \t]+){1,4}(?:${STREET_SUFFIX})\b\.?${UNIT}${CITY_STATE_ZIP}(?![ \t]+[A-Z][a-z])`,
  "g",
);

/**
 * A digit run right after one of these labels is an order/tracking/SKU reference, not a PAN or phone.
 * Matched against folded text immediately preceding the candidate on the same line.
 */
const PROTECTED_LABEL =
  /(?:\b(?:order|pedido|invoice|factura|tracking|confirmation|ref|reference|sku|item|style|model|upc|serial|rma|numero|number|no\.?|id)|#)[ \t]*(?:#|no\.?|number|id)?[ \t]*[:#]?[ \t]*$/i;

/** Words that mark a labeled value as PII even when a protected label is also present. */
const PII_CONTEXT: Record<"pan" | "phone", RegExp> = {
  pan: /\b(?:card|visa|mastercard|amex|discover|tarjeta|credit|debit|pan)\b/i,
  phone: /\b(?:phone|tel|telephone|call|text|mobile|cell|fax|telefono|tel\u00e9fono)\b/i,
};

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

  constructor(private readonly names: readonly string[]) {}

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
    for (const name of this.names) {
      out = out.replace(namePattern(name), () => this.token("name", name.toLowerCase()));
    }
    out = out.replace(INTERNATIONAL_PHONE, match => this.token("phone", normalizePhone(match)));
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
    out = out.replace(INTERNATIONAL_ADDRESS, match => this.token("address", match.toLowerCase().trim()));
    out = out.replace(ADDRESS_PATTERN, (match) =>
      this.token("address", match.toLowerCase().replace(/[\s.,]+/g, " ").trim()),
    );
    // Keep monetary/order lines intact; postal lines and postal tails after a street token are PII.
    out = out.split("\n").map(line => {
      const tokenEnd = /\[ADDRESS_\d+\]/.exec(line);
      if (tokenEnd) {
        const start = tokenEnd.index + tokenEnd[0].length;
        const tail = line.slice(start).replace(/^[, \t]+/, "").trim();
        if (POSTAL_LINE.test(tail)) return line.slice(0, start) + " " + this.token("address", tail.toLowerCase());
      }
      const trimmed = line.trim();
      return POSTAL_LINE.test(trimmed) ? this.token("address", trimmed.toLowerCase()) : line;
    }).join("\n");
    return out;
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
  const redactor = new Redactor(customerNames(email));
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
