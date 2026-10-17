import { createHash } from "node:crypto";
import { RawEmailSchema, type RawEmail } from "@/lib/contracts";

/**
 * Minimal, dependency-free .eml / .mbox parser for demo uploads (issue #4, F1.2).
 * Supports folded headers, RFC 2047 encoded words, multipart (alternative prefers text/plain, nested parts),
 * quoted-printable and base64 bodies, common charsets, and an HTML-to-text fallback.
 */

export class EmailParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailParseError";
  }
}

type Headers = Map<string, string>;
type MimePart = { headers: Headers; body: string };
type TextBody = { text: string | null; html: string | null };

function splitHeaderBlock(source: string): MimePart {
  const match = /\r?\n\r?\n/.exec(source);
  const headerBlock = match ? source.slice(0, match.index) : source;
  const body = match ? source.slice(match.index + match[0].length) : "";
  return { headers: parseHeaders(headerBlock), body };
}

/** Header names lowercased; folded continuation lines joined with one space; first occurrence wins. */
function parseHeaders(block: string): Headers {
  const headers: Headers = new Map();
  const unfolded: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && unfolded.length > 0) unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    else unfolded.push(line);
  }
  for (const line of unfolded) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!headers.has(name)) headers.set(name, line.slice(colon + 1).trim());
  }
  return headers;
}

/** `text/plain; charset="utf-8"` -> { type: "text/plain", params: { charset: "utf-8" } }. */
function parseContentType(value: string | undefined): { type: string; params: Record<string, string> } {
  const [type, ...rest] = (value ?? "text/plain").split(";");
  const params: Record<string, string> = {};
  for (const param of rest) {
    const eq = param.indexOf("=");
    if (eq <= 0) continue;
    params[param.slice(0, eq).trim().toLowerCase()] = param.slice(eq + 1).trim().replace(/^"|"$/g, "");
  }
  return { type: type.trim().toLowerCase() || "text/plain", params };
}

/** windows-1252 code points for bytes 0x80-0x9F (WHATWG also uses this table for iso-8859-1 / us-ascii labels). */
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
];
const WINDOWS_1252_LABELS = new Set(["windows-1252", "cp1252", "iso-8859-1", "latin1", "us-ascii", "ascii"]);

function decodeBytes(bytes: Buffer, charset: string | undefined): string {
  const label = (charset ?? "utf-8").toLowerCase();
  // Decoded by hand: some Node builds' TextDecoder treats windows-1252 as plain latin1.
  if (WINDOWS_1252_LABELS.has(label)) {
    return Array.from(bytes, (byte) => String.fromCodePoint(byte >= 0x80 && byte < 0xa0 ? WINDOWS_1252_HIGH[byte - 0x80] : byte)).join("");
  }
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

function quotedPrintableBytes(input: string, underscoreIsSpace: boolean): Buffer {
  const text = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const hex = text.slice(i + 1, i + 3);
    if (char === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else if (char === "_" && underscoreIsSpace) {
      bytes.push(0x20);
    } else {
      bytes.push(...Buffer.from(char, "utf8"));
    }
  }
  return Buffer.from(bytes);
}

function decodeTransfer(body: string, encoding: string | undefined, charset: string | undefined): string {
  const kind = (encoding ?? "7bit").trim().toLowerCase();
  if (kind === "base64") return decodeBytes(Buffer.from(body.replace(/\s+/g, ""), "base64"), charset);
  if (kind === "quoted-printable") return decodeBytes(quotedPrintableBytes(body, false), charset);
  return body;
}

/** RFC 2047 encoded words, e.g. `=?UTF-8?Q?Your_order_=E2=80=94_shipped?=`. */
function decodeEncodedWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_match, charset: string, kind: string, data: string) =>
      kind.toUpperCase() === "B"
        ? decodeBytes(Buffer.from(data, "base64"), charset)
        : decodeBytes(quotedPrintableBytes(data, true), charset),
    );
}

const HTML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Basic HTML to plain text: drops script/style, maps block tags to newlines, strips tags, decodes entities. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|section)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
      if (entity.startsWith("#x") || entity.startsWith("#X")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
      if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
      return HTML_ENTITIES[entity.toLowerCase()] ?? match;
    })
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitMultipart(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const parts: string[] = [];
  const lines = body.split(/\r?\n/);
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith(delimiter)) {
      if (current) parts.push(current.join("\n"));
      if (line.startsWith(`${delimiter}--`)) return parts;
      current = [];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) parts.push(current.join("\n"));
  return parts;
}

/** Text and HTML bodies of a MIME part; within multipart, the first text/plain and first text/html found win. */
function extractBodies(part: MimePart): TextBody {
  const contentType = parseContentType(part.headers.get("content-type"));
  if (contentType.type.startsWith("multipart/") && contentType.params.boundary) {
    const result: TextBody = { text: null, html: null };
    for (const child of splitMultipart(part.body, contentType.params.boundary)) {
      const childPart = splitHeaderBlock(child);
      if (/^attachment/i.test(childPart.headers.get("content-disposition") ?? "")) continue;
      const bodies = extractBodies(childPart);
      result.text ??= bodies.text;
      result.html ??= bodies.html;
    }
    return result;
  }
  const decoded = decodeTransfer(part.body, part.headers.get("content-transfer-encoding"), contentType.params.charset);
  if (contentType.type === "text/plain") return { text: decoded, html: null };
  if (contentType.type === "text/html") return { text: null, html: decoded };
  return { text: null, html: null };
}

function stripAngles(value: string): string {
  return value.trim().replace(/^<|>$/g, "");
}

function toIsoDate(value: string | undefined): string {
  const parsed = value ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(parsed)) throw new EmailParseError("missing or unparseable Date header");
  return new Date(parsed).toISOString();
}

/** Parses one RFC 822 message. Throws EmailParseError when From or Date is missing. */
export function parseEml(source: string): RawEmail {
  const message = splitHeaderBlock(source.replace(/^\uFEFF/, ""));
  const from = decodeEncodedWords(message.headers.get("from") ?? "");
  if (!from) throw new EmailParseError("missing From header");
  const date = toIsoDate(message.headers.get("date"));
  const bodies = extractBodies(message);
  const text = (bodies.text ?? (bodies.html !== null ? htmlToText(bodies.html) : "")).replace(/\r\n/g, "\n").trim();
  const messageId = message.headers.get("message-id");
  const id = messageId
    ? stripAngles(messageId)
    : `eml-${createHash("sha256").update(source, "utf8").digest("hex").slice(0, 16)}`;
  const to = message.headers.get("to");
  return RawEmailSchema.parse({
    id,
    from,
    ...(to ? { to: decodeEncodedWords(to) } : {}),
    subject: decodeEncodedWords(message.headers.get("subject") ?? ""),
    date,
    text,
  });
}

export interface MboxParseResult {
  emails: RawEmail[];
  /** Messages that could not be parsed, by 0-based position in the mbox. */
  errors: Array<{ index: number; reason: string }>;
}

/** Splits an mbox on `From ` separator lines (at file start or after a blank line) and unescapes `>From `. */
function splitMbox(source: string): string[] {
  const messages: string[] = [];
  let current: string[] | null = null;
  let previousBlank = true;
  for (const line of source.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (line.startsWith("From ") && previousBlank) {
      if (current) messages.push(current.join("\n"));
      current = [];
    } else if (current) {
      current.push(line.replace(/^>(>*From )/, "$1"));
    }
    previousBlank = line.trim() === "";
  }
  if (current) messages.push(current.join("\n"));
  return messages.filter((message) => message.trim() !== "");
}

export function parseMboxDetailed(source: string): MboxParseResult {
  const result: MboxParseResult = { emails: [], errors: [] };
  splitMbox(source).forEach((message, index) => {
    try {
      result.emails.push(parseEml(message));
    } catch (error) {
      result.errors.push({ index, reason: error instanceof Error ? error.message : "unparseable message" });
    }
  });
  return result;
}

/** Parses every message in an mbox; unparseable messages are skipped (use parseMboxDetailed to see them). */
export function parseMbox(source: string): RawEmail[] {
  return parseMboxDetailed(source).emails;
}
