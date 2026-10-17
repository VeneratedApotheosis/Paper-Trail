import { withAccountStore } from "@/lib/gmail/context";
import { z } from "zod";
import {
  applyClaimEdits,
  generateClaimDraft,
  getClaimContext,
  getStoredClaimDraft,
  maybeRephraseClaim,
} from "@/lib/api/claims";
import { decodeId, jsonError, readJsonBody, type ParsedBody } from "@/lib/api/http";
import type { ClaimRegenerateResponse, ClaimResponse } from "@/lib/api/types";
import { upsertDraft } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ClaimParams = { params: Promise<{ findingId: string }> };

const FindingIdSchema = z.string().min(1).max(300);

const RegenerateBodySchema = z.object({
  profileName: z.string().trim().min(1).max(200).optional(),
  supportEmail: z.string().trim().email().max(320).optional(),
  rephrase: z.boolean().optional(),
});

const EditBodySchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(10_000),
  recipient: z.union([z.literal(""), z.string().email().max(320)]),
});

/** POST body is optional: an empty body means "regenerate with defaults". */
async function readRegenerateBody(request: Request): Promise<ParsedBody<z.infer<typeof RegenerateBodySchema>>> {
  const text = await request.text();
  let json: unknown = {};
  if (text.trim()) {
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, response: jsonError(400, "Request body must be valid JSON") };
    }
  }
  const parsed = RegenerateBodySchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, response: jsonError(400, "Invalid request body", parsed.error.flatten()) };
  }
  return { ok: true, data: parsed.data };
}

async function findingIdFrom({ params }: ClaimParams): Promise<string | undefined> {
  const parsed = FindingIdSchema.safeParse(decodeId((await params).findingId));
  return parsed.success ? parsed.data : undefined;
}

/** The stored draft for a finding, or a freshly generated template draft (stored). */
async function handleGET(_request: Request, context: ClaimParams): Promise<Response> {
  const findingId = await findingIdFrom(context);
  if (!findingId) return jsonError(400, "Invalid finding id");
  const claim = getClaimContext(findingId);
  if (!claim) return jsonError(404, "Finding not found");
  let draft = getStoredClaimDraft(findingId);
  if (!draft) {
    const generated = generateClaimDraft(claim);
    if (!generated.ok) return generated.response;
    draft = generated.draft;
    upsertDraft(draft);
  }
  const body: ClaimResponse = { draft, ...claim };
  return Response.json(body);
}

/** Regenerates the draft from the template (discarding user edits and approval); optional LLM rephrase. */
async function handlePOST(request: Request, context: ClaimParams): Promise<Response> {
  const findingId = await findingIdFrom(context);
  if (!findingId) return jsonError(400, "Invalid finding id");
  const parsed = await readRegenerateBody(request);
  if (!parsed.ok) return parsed.response;
  const claim = getClaimContext(findingId);
  if (!claim) return jsonError(404, "Finding not found");
  const { rephrase = false, ...options } = parsed.data;
  const generated = generateClaimDraft(claim, options);
  if (!generated.ok) return generated.response;
  const outcome = await maybeRephraseClaim(generated.draft, rephrase);
  upsertDraft(outcome.draft);
  const body: ClaimRegenerateResponse = {
    draft: outcome.draft,
    ...claim,
    rephrased: outcome.rephrased,
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  };
  return Response.json(body);
}

/** Saves the user's subject/body/recipient; the draft is marked edited and any earlier approval is cleared. */
async function handlePUT(request: Request, context: ClaimParams): Promise<Response> {
  const findingId = await findingIdFrom(context);
  if (!findingId) return jsonError(400, "Invalid finding id");
  const parsed = await readJsonBody(request, EditBodySchema);
  if (!parsed.ok) return parsed.response;
  const claim = getClaimContext(findingId);
  if (!claim) return jsonError(404, "Finding not found");
  let base = getStoredClaimDraft(findingId);
  if (!base) {
    const generated = generateClaimDraft(claim);
    if (!generated.ok) return generated.response;
    base = generated.draft;
  }
  const draft = applyClaimEdits(base, parsed.data);
  upsertDraft(draft);
  const body: ClaimResponse = { draft, ...claim };
  return Response.json(body);
}

export const GET = withAccountStore(handleGET);

export const POST = withAccountStore(handlePOST);

export const PUT = withAccountStore(handlePUT);
