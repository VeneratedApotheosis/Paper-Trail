import { z } from "zod";
import { buildLedgerResponse } from "@/lib/api/ledger";
import { decodeId, jsonError } from "@/lib/api/http";
import { EmailClassSchema } from "@/lib/contracts";
import { withAccountStore } from "@/lib/gmail/context";
import { markSkippedAsReceipt } from "@/lib/quality/feedback";
import { qualityErrorResponse, qualityOriginAllowed } from "@/lib/quality/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({ class: EmailClassSchema.optional() }).strict();

/** POST /api/quality/skipped/:emailId/receipt `{ class? }`: "this is a receipt". Extracts it, merges it, saves a label. */
async function handlePOST(request: Request, context: { params: Promise<{ emailId: string }> }): Promise<Response> {
  if (!qualityOriginAllowed(request)) return jsonError(403, "Send feedback from this app.");
  const text = await request.text();
  let json: unknown;
  try { json = text.trim() === "" ? {} : JSON.parse(text); } catch { return jsonError(400, "Request body must be valid JSON"); }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return jsonError(400, "Invalid request body", parsed.error.flatten());
  try {
    const result = await markSkippedAsReceipt(decodeId((await context.params).emailId), { class: parsed.data.class });
    return Response.json({ ...result, summary: buildLedgerResponse().summary });
  } catch (error) {
    return qualityErrorResponse(error);
  }
}

export const POST = withAccountStore(handlePOST);
