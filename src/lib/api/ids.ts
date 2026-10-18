/**
 * Ids in URL paths. Real ids contain ':' (`order:...`, `refund_overdue:order:...`) and Next 15 passes dynamic route
 * params (`params.id`) still percent-encoded, so an id may arrive raw or encoded. Shared by the browser client, the
 * route handlers and the server-component helpers; no server-only imports.
 */

/** Decodes a percent-encoded id once; returns the input unchanged when it is not valid percent-encoding. */
export function safeDecode(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

/** Path segment for an id that may already be encoded: decode once, then encode, so it is never double-encoded. */
export function encodeIdSegment(id: string): string {
  return encodeURIComponent(safeDecode(id));
}

/** Same bounds the id route handlers validate (`z.string().min(1).max(300)`; longer or empty ids are a 400). */
export const MAX_ROUTE_ID_LENGTH = 300;

export function isValidRouteId(id: string): boolean {
  return id.length >= 1 && id.length <= MAX_ROUTE_ID_LENGTH;
}
