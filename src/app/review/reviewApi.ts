import type { Finding, NormalizedOrder } from "@/lib/contracts";
import { ApiError } from "@/lib/api/client";
import { encodeIdSegment } from "@/lib/api/ids";
import type { ApiErrorBody, LedgerSummary } from "@/lib/api/types";
import type { ReviewEdit } from "@/lib/review/schema";

// Local browser calls for the review routes (#47, docs/review-api.md) until src/lib/api/client.ts has review
// functions. Same conventions as that client: same-origin JSON, no-store, ApiError (status + the API's `{ error }`
// text) on a non-2xx response. The browser sends the same-origin Origin header the routes require.

/** Body of POST /api/review/:id/edit and /confirm. `revision` replaces the order's previous revision. */
export interface ReviewMutationResponse {
  ok: true;
  order: NormalizedOrder;
  findings: Finding[];
  revision: string;
  summary: LedgerSummary;
}

async function postReview(path: string, body: unknown): Promise<ReviewMutationResponse> {
  const response = await fetch(path, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorBody = json !== null && typeof json === "object" && "error" in json ? (json as ApiErrorBody) : null;
    throw new ApiError(response.status, errorBody);
  }
  return json as ReviewMutationResponse;
}

function reviewPath(orderId: string, action: "edit" | "confirm"): string {
  return `/api/review/${encodeIdSegment(orderId)}/${action}`;
}

export function postReviewEdit(orderId: string, revision: string, edit: ReviewEdit): Promise<ReviewMutationResponse> {
  return postReview(reviewPath(orderId, "edit"), { revision, edit });
}

export function postReviewConfirm(orderId: string, revision: string): Promise<ReviewMutationResponse> {
  return postReview(reviewPath(orderId, "confirm"), { revision, confirmed: true });
}
