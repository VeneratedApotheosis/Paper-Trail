import type { z } from "zod";
import { jsonError, type ParsedBody } from "@/lib/api/http";

/**
 * Like readJsonBody from @/lib/api/http, but typed by the schema's output, so schemas with defaults (FindingSchema,
 * NormalizedOrderSchema) can be used. Malformed JSON or a schema mismatch becomes a 400 `{ error, details? }`.
 */
export async function readSchemaBody<Schema extends z.ZodTypeAny>(
  request: Request,
  schema: Schema,
): Promise<ParsedBody<z.output<Schema>>> {
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
