import { withAccountStore } from "@/lib/gmail/context";
import { z } from "zod";
import { readJsonBody } from "@/lib/api/http";
import type { MerchantExcludeResponse } from "@/lib/api/types";
import { excludeMerchant, includeMerchant } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MerchantBodySchema = z.object({ merchant: z.string().trim().min(1).max(200) });

/** Hides a merchant (name or domain, case-insensitive) from every API response. */
async function handlePOST(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MerchantBodySchema);
  if (!body.ok) return body.response;
  const response: MerchantExcludeResponse = { excludedMerchants: excludeMerchant(body.data.merchant) };
  return Response.json(response);
}

async function handleDELETE(request: Request): Promise<Response> {
  const body = await readJsonBody(request, MerchantBodySchema);
  if (!body.ok) return body.response;
  const response: MerchantExcludeResponse = { excludedMerchants: includeMerchant(body.data.merchant) };
  return Response.json(response);
}

export const POST = withAccountStore(handlePOST);

export const DELETE = withAccountStore(handleDELETE);
