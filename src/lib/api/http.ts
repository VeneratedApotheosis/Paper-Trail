import type { z } from "zod";
import type { ApiErrorBody } from "./types";

/** Server-side helpers shared by the route handlers in src/app/api. */

export function jsonError(status: number, error: string, details?: unknown): Response {
  const body: ApiErrorBody = details === undefined ? { error } : { error, details };
  return Response.json(body, { status });
}

export type ParsedBody<T> = { ok: true; data: T } | { ok: false; response: Response };

/** Parses a JSON request body with `schema`; malformed JSON or a schema mismatch becomes a 400 `{ error }`. */
export async function readJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<ParsedBody<T>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return { ok: false, response: jsonError(400, "Request body must be valid JSON") };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, response: jsonError(400, "Invalid request body", parsed.error.flatten()) };
  }
  return { ok: true, data: parsed.data };
}

/** Route param ids may arrive percent-encoded (order ids contain ':'). */
export function decodeId(id: string): string {
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}
