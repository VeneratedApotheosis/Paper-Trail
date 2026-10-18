import { jsonError } from "@/lib/api/http";
import { QualityError } from "./feedback";

/** Same-origin guard for the POST routes (the browser app is the only caller). */
export function qualityOriginAllowed(request: Request): boolean {
  const origin = request.headers.get("origin");
  return (!origin || origin === new URL(request.url).origin) && request.headers.get("sec-fetch-site") !== "cross-site";
}

export function qualityErrorResponse(error: unknown): Response {
  if (error instanceof QualityError) return jsonError(error.status, error.message, error.details);
  return jsonError(500, "The quality action could not be completed.");
}
