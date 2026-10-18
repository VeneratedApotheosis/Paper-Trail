/**
 * Order-reference canonicalization (#126). Merchants print one purchase under several spellings: `#NW-2041`,
 * `NW2041`, `Order NW 2041`, `ORD-0042` vs `42`. Pure.
 */

/** Leading words that label a number but are not part of it. Only dropped as whole tokens, never from inside one. */
const LABEL_TOKENS = new Set([
  "ORDER", "ORD", "INVOICE", "INV", "CONFIRMATION", "CONF", "NUMBER", "NUM", "NO", "REF", "WEB", "ID",
  "TRANSACTION", "TXN", "RECEIPT", "DOC", "DOCUMENT", "PURCHASE",
]);

/** Shortest canonical reference trusted to join emails that do not name each other's primary order number. */
export const MIN_STRONG_REF_LENGTH = 4;

/**
 * Canonical form of a reference: upper case letters and digits only, label words and a leading `#` dropped, leading
 * zeros of the number removed. Null when nothing is left.
 */
export function canonicalRef(ref: string | null | undefined): string | null {
  if (ref == null) return null;
  const tokens = ref
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((token) => token !== "");
  while (tokens.length > 1 && LABEL_TOKENS.has(tokens[0])) tokens.shift();
  const joined = tokens.join("").replace(/^([A-Z]*)0+(?=\d)/, "$1");
  return joined === "" ? null : joined;
}

/** A reference specific enough to identify a purchase on its own: long enough and carrying a digit. */
export function isStrongRef(canonical: string | null): canonical is string {
  return canonical !== null && canonical.length >= MIN_STRONG_REF_LENGTH && /\d/.test(canonical);
}

/** Canonical primary reference first, then the canonical `otherRefs`, without duplicates. */
export function canonicalRefs(primary: string | null | undefined, others: readonly string[] | null | undefined): string[] {
  const all = [primary, ...(others ?? [])].map((ref) => canonicalRef(ref)).filter((ref): ref is string => ref !== null);
  return [...new Set(all)];
}

/** `order #BKB-9129`, `Invoice INV-77`, `Pedido 8841`: a labelled reference with a digit. */
const SUBJECT_REF = /\b(?:order|pedido|invoice|factura|bestellung|commande)\s*(?:#|no\.?|number|num\.?|nº|n°)?\s*[:#]?\s*#?([A-Za-z0-9][A-Za-z0-9-]{3,})/gi;

/**
 * Canonical references a subject line names ("A shipment from order #BKB-9129 is on the way"). The subject states which
 * order the email is about even when extraction returned a shipment id or nothing as the order reference.
 */
export function refsFromSubject(subject: string): string[] {
  const refs: string[] = [];
  for (const match of subject.matchAll(SUBJECT_REF)) {
    if (!/\d/.test(match[1])) continue;
    const ref = canonicalRef(match[1]);
    if (isStrongRef(ref)) refs.push(ref);
  }
  return [...new Set(refs)];
}
