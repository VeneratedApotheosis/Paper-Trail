import { buildLedgerResponse } from "@/lib/api/ledger";
import { ReviewError } from "./service";

export function reviewOriginAllowed(request: Request) {
  const origin = request.headers.get("origin");
  return (!origin || origin === new URL(request.url).origin) && request.headers.get("sec-fetch-site") !== "cross-site";
}
export function reviewResponse(result: { order: unknown; findings: unknown; revision: string }) {
  return Response.json({ ok: true, ...result, summary: buildLedgerResponse().summary });
}
export function reviewError(error: unknown) {
  return Response.json({ error: error instanceof ReviewError ? error.message : "Review could not be saved." },
    { status: error instanceof ReviewError ? error.status : 500 });
}
