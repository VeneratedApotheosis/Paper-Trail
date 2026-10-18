/** Shared text helpers for the ingestion heuristics (prefilter, classify). */

/** Lowercases and strips diacritics so "Devolución" matches "devolucion". */
export function foldText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * Labeled order references: "Order #NW-1001", "order number: 112-4455", "Pedido n.º 8841".
 * Run against folded (lowercase, accent-free) text.
 */
export const ORDER_REF_PATTERN =
  /\b(?:order|pedido|invoice|factura)\s*(?:#|no\b\.?|n\.?º|number|num\.|numero|id\b)?\s*[:#]?\s*#?(?=[a-z0-9-]*\d)[a-z0-9][a-z0-9-]{3,}|訂單(?:編號|號碼|號)?\s*[:：#]?\s*#?(?=[a-z0-9-]*\d)[a-z0-9][a-z0-9-]{3,}/;

/** True when the folded text contains a labeled order reference. */
export function hasOrderRef(foldedText: string): boolean {
  return ORDER_REF_PATTERN.test(foldedText);
}

/** Domain part of a From header, e.g. `"Northwind" <orders@northwind.example>` -> `northwind.example`. */
export function senderDomain(from: string): string | null {
  const match = /@([a-z0-9.-]+\.[a-z]{2,})/i.exec(from);
  return match ? match[1].toLowerCase() : null;
}

/** Local part of a From header, e.g. `orders@northwind.example` -> `orders`. */
export function senderLocalPart(from: string): string | null {
  const match = /([a-z0-9._%+-]+)@[a-z0-9.-]+\.[a-z]{2,}/i.exec(from);
  return match ? match[1].toLowerCase() : null;
}

/** Display name of a From header, e.g. `"Northwind Outfitters" <orders@...>` -> `Northwind Outfitters`. */
export function senderDisplayName(from: string): string | null {
  const match = /^\s*"?([^"<]*?)"?\s*</.exec(from);
  const name = match?.[1].trim();
  return name ? name : null;
}
