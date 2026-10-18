/**
 * Email body text for ingestion (issue #116), shared by Gmail decoding and .eml/.mbox parsing:
 * a table-aware HTML-to-text converter and the rule for choosing between a message's text/plain and text/html parts.
 */

export type BodySource = "plain" | "html";

export interface SelectedBody {
  text: string;
  /** Which MIME part the text came from; `null` when the message had no usable body. */
  bodySource: BodySource | null;
}

/** Cap on text derived from HTML (marketing mails can be huge); plain parts are never truncated here. */
export const MAX_HTML_TEXT_CHARS = 40_000;

// ---------------------------------------------------------------------------------------------------------------------
// Body choice
// ---------------------------------------------------------------------------------------------------------------------

/** A plain part with fewer content characters than this is "thin" and loses to a clearly longer HTML part. */
const THIN_PLAIN_CHARS = 200;
/** A plain part that is boilerplate ("view this email in your browser") is only replaced when it is this short. */
const BOILERPLATE_PLAIN_MAX_CHARS = 500;

const BROWSER_BOILERPLATE =
  /\bview (?:this |the )?(?:email|message|it|online)\b[^.\n]{0,20}\bbrowser\b|\bview in (?:your )?(?:web )?browser\b|\bopen in (?:your )?browser\b|\b(?:trouble|difficulty) (?:viewing|reading|seeing)\b|\bcan(?:no|')t (?:see|view|read) (?:this|the) (?:email|message)\b|\b(?:html|html-capable|html-enabled) (?:email|mail|viewer|client)\b|\b(?:enable|use) html\b/i;

/** Currency amounts such as `$40.00`, `€ 1,299`, `£7.5`, `40.00 USD`. */
const PRICE_TOKEN = /[$€£]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*\.\d{2}\s?(?:usd|eur|gbp|cad|mxn)\b/gi;

function countPrices(text: string): number {
  return text.match(PRICE_TOKEN)?.length ?? 0;
}

/** Characters of real content: URLs and whitespace runs do not count. */
function contentLength(text: string): number {
  return text.replace(/https?:\/\/\S+/gi, "").replace(/\s+/g, " ").trim().length;
}

/**
 * Picks the richer of a message's text/plain and text/html parts. Plain wins by default (it is exact and has no markup
 * noise). HTML-derived text wins when the HTML carries more price-like tokens than the plain part, or when the plain part
 * is thin (< 200 content chars) or "view in your browser" boilerplate and the HTML text is clearly longer.
 */
export function selectBodyText(parts: { plain: string; html: string }): SelectedBody {
  const plain = parts.plain.trim();
  const rawHtml = parts.html.trim();
  const html = rawHtml ? htmlToText(rawHtml) : "";
  if (!html) return plain ? { text: plain, bodySource: "plain" } : { text: "", bodySource: null };
  if (!plain) return { text: html, bodySource: "html" };

  const plainLength = contentLength(plain);
  const htmlLength = contentLength(html);
  const htmlHasMorePrices = countPrices(html) > countPrices(plain);
  const plainIsThin = plainLength < THIN_PLAIN_CHARS && htmlLength >= plainLength * 1.5 && htmlLength - plainLength >= 40;
  const plainIsBoilerplate = BROWSER_BOILERPLATE.test(plain) && plainLength < BOILERPLATE_PLAIN_MAX_CHARS && htmlLength > plainLength;
  return htmlHasMorePrices || plainIsThin || plainIsBoilerplate
    ? { text: html, bodySource: "html" }
    : { text: plain, bodySource: "plain" };
}

// ---------------------------------------------------------------------------------------------------------------------
// HTML to text
// ---------------------------------------------------------------------------------------------------------------------

const HTML_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", bull: "•", middot: "·", euro: "€", pound: "£", yen: "¥", cent: "¢", copy: "©", reg: "®",
  trade: "™", times: "×", deg: "°", zwnj: "", zwj: "", shy: "",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    try {
      if (entity[0] === "#") {
        const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
        return String.fromCodePoint(code);
      }
    } catch {
      return match;
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link", "wbr", "area", "base", "col", "source", "embed", "param"]);
/** Open and close of these tags end the current line. */
const BLOCK_TAGS = new Set([
  "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "section", "article", "header", "footer", "main",
  "blockquote", "pre", "hr", "dl", "dt", "dd", "center", "address", "form", "figure", "figcaption", "caption", "nav",
]);

const HIDDEN_STYLE =
  /display\s*:\s*none|visibility\s*:\s*hidden|mso-hide\s*:\s*all|opacity\s*:\s*0(?![.\d])|font-size\s*:\s*0(?:px|pt|em|%)?\s*(?:;|!|$)|max-height\s*:\s*0(?:px|pt)?\s*(?:;|!|$)|width\s*:\s*0(?:px)?\s*;[^"]*overflow\s*:\s*hidden/i;
const PREHEADER_CLASS = /\b(?:pre-?header(?:-?text)?|preview-?text|email-?preview|hidden-?preheader|mso-hide)\b/i;
/** Alt text that names a decoration rather than a product. */
const GENERIC_ALT = /\b(?:logo|spacer|pixel|tracking|icon|facebook|twitter|instagram|pinterest|youtube|linkedin|tiktok|banner|divider|arrow|bullet)\b|^(?:image|photo|picture|img|spacer|\s)*$/i;

/** Footer lines that never carry order data. Unsubscribe / view-in-browser lines are kept: the classifier uses them. */
const FOOTER_NOISE = /^©|\ball rights reserved\b|\bcopyright\b|\byou(?:'re| are) receiving this (?:email|message)\b|\bthis (?:is an? )?(?:automated|auto-generated) (?:email|message)\b/i;
const LONG_URL = /(?:https?:\/\/|www\.)\S{20,}/gi;
const INVISIBLE_CHARS = /[\u00ad\u034f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\ufeff]/g;

function attributesOf(raw: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const match of raw.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function isHiddenElement(attributes: Map<string, string>): boolean {
  if (attributes.has("hidden")) return true;
  if (HIDDEN_STYLE.test(attributes.get("style") ?? "")) return true;
  return PREHEADER_CLASS.test(`${attributes.get("class") ?? ""} ${attributes.get("id") ?? ""}`);
}

function isMeaningfulAlt(alt: string): boolean {
  const trimmed = alt.trim();
  return /[\p{L}]{3}/u.test(trimmed) && trimmed.length <= 120 && !/^https?:/i.test(trimmed) && !GENERIC_ALT.test(trimmed);
}

interface Row {
  tableDepth: number;
  cells: string[];
  current: string;
}

/** Lines of one cell of a multi-cell row, on one line: "412 Alder Street" + "Portland, OR" -> "412 Alder Street, Portland, OR". */
function joinCellLines(lines: string[]): string {
  return lines.reduce((joined, line) => (joined === "" ? line : /[,.:;!?]$/.test(joined) ? `${joined} ${line}` : `${joined}, ${line}`), "");
}

/** A cell repeating a longer neighbour, e.g. a product image alt next to the product name cell. */
function isRepeatedInOtherCell(text: string, index: number, texts: string[]): boolean {
  if (text.length < 4 || !/\p{L}/u.test(text)) return false;
  const folded = text.toLowerCase();
  return texts.some((other, otherIndex) =>
    otherIndex !== index && (other.length > text.length || (other.length === text.length && otherIndex < index)) && other.toLowerCase().includes(folded));
}

/** Cleans a block of text with embedded newlines into non-empty trimmed lines. */
function toLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .filter((line) => line !== "");
}

/**
 * HTML to plain text that keeps receipt structure:
 * - one line per table row, cells joined by " | " ("Subtotal | $40.00"); empty cells and repeated cells are dropped;
 * - a row with a single cell (layout wrapper) keeps that cell's own line breaks; nested tables emit their own rows;
 * - headings, paragraphs and divs are their own lines; list items start with "- ";
 * - script/style/head/comments, hidden elements (display:none, mso-hide, preheaders), tracking pixels and decorative
 *   images are dropped; alt text is kept only when it looks like a product name; long URLs are dropped (link text stays);
 * - entities decoded, whitespace collapsed, copyright/"you are receiving this" footer lines removed.
 */
export function htmlToText(html: string): string {
  const source = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[!?][^>]*>/g, "")
    .replace(/<(script|style|head|title|noscript|svg|template)\b[\s\S]*?<\/\1\s*>/gi, "");

  const lines: string[] = [];
  const rows: Row[] = [];
  const stack: Array<{ name: string; hidden: boolean }> = [];
  let hiddenCount = 0;
  let tableDepth = 0;
  let outside = "";

  const write = (text: string) => {
    if (rows.length > 0) rows[rows.length - 1].current += text;
    else outside += text;
  };
  const flushLoose = () => {
    if (rows.length > 0) {
      const row = rows[rows.length - 1];
      lines.push(...toLines(row.current));
      row.current = "";
    } else {
      lines.push(...toLines(outside));
      outside = "";
    }
  };
  const endCell = () => {
    const row = rows[rows.length - 1];
    if (row && toLines(row.current).length > 0) row.cells.push(row.current);
    if (row) row.current = "";
  };
  const closeRow = () => {
    const row = rows.pop();
    if (!row) return;
    if (toLines(row.current).length > 0) row.cells.push(row.current);
    const cells = row.cells.map((cell) => toLines(cell));
    if (cells.length === 1) {
      lines.push(...cells[0]);
      return;
    }
    const texts = cells.map(joinCellLines);
    const joined = texts.filter((text, index) => !isRepeatedInOtherCell(text, index, texts));
    if (joined.length > 0) lines.push(joined.join(" | "));
  };
  const closeRowsAtOrBelow = (depth: number) => {
    while (rows.length > 0 && rows[rows.length - 1].tableDepth >= depth) closeRow();
  };

  const tagPattern = /<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g;
  let cursor = 0;
  const emitText = (raw: string) => {
    if (hiddenCount > 0 || raw === "") return;
    const text = decodeEntities(raw).replace(INVISIBLE_CHARS, "").replace(/\s+/g, " ").replace(LONG_URL, " ");
    if (text.trim() !== "") write(text);
  };

  for (const match of source.matchAll(tagPattern)) {
    emitText(source.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const closing = match[1] === "/";
    const name = match[2].toLowerCase();
    const attributes = closing ? new Map<string, string>() : attributesOf(match[3]);
    const selfClosing = !closing && (VOID_TAGS.has(name) || match[3].trimEnd().endsWith("/"));

    if (closing) {
      let index = stack.length - 1;
      while (index >= 0 && stack[index].name !== name) index--;
      if (index < 0) continue;
      const wasHidden = hiddenCount > 0;
      while (stack.length > index) hiddenCount -= stack.pop()?.hidden ? 1 : 0;
      if (wasHidden) continue;
      if (name === "td" || name === "th") endCell();
      else if (name === "tr") closeRowsAtOrBelow(tableDepth);
      else if (name === "table") {
        closeRowsAtOrBelow(tableDepth);
        tableDepth = Math.max(0, tableDepth - 1);
      } else if (BLOCK_TAGS.has(name)) write("\n");
      continue;
    }

    if (name === "br") {
      if (hiddenCount === 0) write("\n");
      continue;
    }
    if (name === "img") {
      if (hiddenCount === 0 && !isHiddenElement(attributes)) {
        const tiny = [attributes.get("width"), attributes.get("height")].some((value) => value !== undefined && /^[0-2](?:px)?$/.test(value.trim()));
        const alt = decodeEntities(attributes.get("alt") ?? "");
        if (!tiny && isMeaningfulAlt(alt)) emitText(` ${alt} `);
      }
      continue;
    }

    const hidden = hiddenCount > 0 || isHiddenElement(attributes);
    if (!selfClosing) {
      stack.push({ name, hidden: isHiddenElement(attributes) });
      if (stack[stack.length - 1].hidden) hiddenCount++;
    }
    if (hidden) continue;

    if (name === "table") {
      flushLoose();
      tableDepth++;
    } else if (name === "tr") {
      if (rows.length > 0 && rows[rows.length - 1].tableDepth === tableDepth) closeRow();
      else flushLoose();
      rows.push({ tableDepth, cells: [], current: "" });
    } else if (name === "td" || name === "th") {
      endCell();
    } else if (name === "li") {
      write("\n- ");
    } else if (BLOCK_TAGS.has(name)) {
      write("\n");
    }
  }
  emitText(source.slice(cursor).replace(/<[a-zA-Z/!?][^>]*$/, ""));
  while (rows.length > 0) closeRow();
  flushLoose();

  const kept = lines.filter((line) => /[\p{L}\p{N}]/u.test(line) && !FOOTER_NOISE.test(line));
  const text = kept.join("\n");
  if (text.length <= MAX_HTML_TEXT_CHARS) return text;
  const clipped = text.slice(0, MAX_HTML_TEXT_CHARS);
  return clipped.slice(0, Math.max(clipped.lastIndexOf("\n"), 0) || MAX_HTML_TEXT_CHARS);
}
