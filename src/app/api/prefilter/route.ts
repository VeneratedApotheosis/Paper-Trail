import type { PrefilterResponse } from "@/lib/api/types";
import { GMAIL_RECEIPT_QUERY, PREFILTER_WINDOW_DAYS, describePrefilterQuery, redactionMode } from "@/lib/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The exact Gmail query and its plain-language description, shown before a sync. */
export async function GET(): Promise<Response> {
  const body: PrefilterResponse = {
    query: GMAIL_RECEIPT_QUERY,
    description: describePrefilterQuery(),
    windowDays: PREFILTER_WINDOW_DAYS,
    redaction: redactionMode(),
  };
  return Response.json(body);
}
