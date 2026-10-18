import { withAccountStore } from "@/lib/gmail/context";
import type { RawEmail } from "@/lib/contracts";
import { buildPipelineRunResponse } from "@/lib/api/ledger";
import { jsonError } from "@/lib/api/http";
import type { UploadResponse } from "@/lib/api/types";
import { liveLlmRateLimited } from "@/lib/api/rate-limit";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_EMAILS, parseEmlDetailed, parseMboxDetailed, runUploadPipeline } from "@/lib/demo";
import { createSyncCollector } from "@/lib/quality/collector";
import { classOverridesFor } from "@/lib/quality/labels";
import { recordSyncPromotions } from "@/lib/promotions/state";
import { recordSyncQuality } from "@/lib/quality/state";
import { beginStoreWork, currentStoreScope, getExcludedMerchants, getExtractionCache, setPipelineResult } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_EXTENSION = /\.(eml|mbox)$/i;
const DELETED_DURING_UPLOAD = "Your data was deleted while this upload was processing; nothing was saved. Upload again to continue.";

const TOO_LARGE = "Upload exceeds the 5 MB limit";

/** Reads at most `maxBytes` of the body as it streams in (a chunked body has no Content-Length to check); null if over. */
async function readLimitedBody(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  return body;
}

/** Multipart form with one or more .eml / .mbox files (any field name), max 5 MB and 300 emails in total. */
async function handlePOST(request: Request): Promise<Response> {
  // Captured before any await: a delete-all during the upload must not be undone by this upload's commit.
  const work = beginStoreWork();
  const cache = getExtractionCache();
  const excludedMerchants = getExcludedMerchants();
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_UPLOAD_BYTES * 1.1) return jsonError(413, TOO_LARGE);
  const limited = liveLlmRateLimited();
  if (limited) return limited;

  let form: FormData;
  try {
    const body = await readLimitedBody(request, MAX_UPLOAD_BYTES * 1.1);
    if (body === null) return jsonError(413, TOO_LARGE);
    form = await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return jsonError(400, "Expected a multipart/form-data body with .eml or .mbox files");
  }
  const files = [...form.values()].filter((value): value is File => typeof value !== "string");
  if (files.length === 0) return jsonError(400, "No files uploaded");
  const badName = files.find((file) => !ALLOWED_EXTENSION.test(file.name));
  if (badName) return jsonError(400, `Unsupported file type: ${badName.name} (only .eml and .mbox)`);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_UPLOAD_BYTES) return jsonError(413, TOO_LARGE);

  const emails: RawEmail[] = [];
  const bodySource = { plain: 0, html: 0 };
  const fileSummaries: UploadResponse["files"] = [];
  const parseErrors: UploadResponse["parseErrors"] = [];
  for (const file of files) {
    const text = await file.text();
    if (/\.mbox$/i.test(file.name)) {
      const parsed = parseMboxDetailed(text);
      emails.push(...parsed.emails);
      parseErrors.push(...parsed.errors.map((error) => ({ file: file.name, ...error })));
      fileSummaries.push({ name: file.name, emails: parsed.emails.length });
      continue;
    }
    try {
      const parsedEml = parseEmlDetailed(text);
      emails.push(parsedEml.email);
      if (parsedEml.bodySource) bodySource[parsedEml.bodySource] += 1;
      fileSummaries.push({ name: file.name, emails: 1 });
    } catch (error) {
      parseErrors.push({ file: file.name, index: 0, reason: error instanceof Error ? error.message : "unparseable" });
      fileSummaries.push({ name: file.name, emails: 0 });
    }
  }
  if (emails.length === 0) return jsonError(400, "No parseable emails in the upload", parseErrors);
  if (emails.length > MAX_UPLOAD_EMAILS) return jsonError(413, `Upload has ${emails.length} emails; the limit is ${MAX_UPLOAD_EMAILS}`);
  if (!work.isCurrent()) return jsonError(409, DELETED_DURING_UPLOAD);

  const now = new Date();
  const collector = createSyncCollector({ source: "upload" });
  const result = await runUploadPipeline(emails, {
    cache, now, audit: work.appendAudit, excludedMerchants,
    observer: collector.observe, onUsage: collector.recordUsage, classOverride: classOverridesFor(currentStoreScope()),
  });
  if (!work.isCurrent()) return jsonError(409, DELETED_DURING_UPLOAD);
  setPipelineResult("upload", now.toISOString(), result);
  const collected = collector.finish(result, { fetched: emails.length + parseErrors.length, bodySource });
  recordSyncQuality(collected);
  void recordSyncPromotions(collected).enrichment; // Claude reads promotion details in the background (PROMO_LLM_LIMIT)
  const body: UploadResponse = { ...buildPipelineRunResponse(), files: fileSummaries, parseErrors };
  return Response.json(body);
}

export const POST = withAccountStore(handlePOST);
