import { sameOriginAllowed } from "@/lib/http/same-origin";
import { buildLedgerResponse } from "@/lib/api/ledger";
import { ReviewError } from "./service";

export function reviewOriginAllowed(request: Request) {
  return sameOriginAllowed(request);
}
export function reviewResponse(result: { order: unknown; findings: unknown; revision: string }) {
  return Response.json({ ok: true, ...result, summary: buildLedgerResponse().summary });
}
export function reviewError(error: unknown) {
  return Response.json({ error: error instanceof ReviewError ? error.message : "Review could not be saved." },
    { status: error instanceof ReviewError ? error.status : 500 });
}
