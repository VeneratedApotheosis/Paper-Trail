import { describe, expect, it } from "vitest";
import type { PipelineStats } from "@/lib/pipeline/run";
import type { GmailPreviewResponse, GmailSyncResponse } from "./gmailApi";
import {
  gmailErrorCopy,
  gmailPreviewText,
  gmailProgressText,
  gmailSyncOutcome,
  uploadOutcome,
} from "./syncOutcome";

function stats(overrides: Partial<PipelineStats> = {}): PipelineStats {
  return {
    emails: 2,
    prefilteredOut: 0,
    classes: {},
    extracted: 0,
    skipped: 2,
    extractionOrigins: { llm: 0, cache: 0, gold: 0 },
    orders: 0,
    excludedOrders: 0,
    findings: 0,
    needsReview: 0,
    ...overrides,
  };
}

function syncResponse(overrides: Partial<GmailSyncResponse> = {}): GmailSyncResponse {
  return {
    mode: "gmail",
    asOf: "2026-10-17T00:00:00.000Z",
    summary: {} as GmailSyncResponse["summary"],
    stats: stats(),
    fetched: 12,
    capped: false,
    parseErrors: [],
    ...overrides,
  };
}

const preview: GmailPreviewResponse = {
  query: "newer_than:90d subject:receipt",
  estimatedMessages: 120,
  messagesToFetch: 50,
  countIsEstimate: true,
  windowDays: 90,
  maxMessages: 50,
};

describe("uploadOutcome", () => {
  it("opens the ledger when the upload produced orders or needs-review items", () => {
    const files = [{ name: "a.eml" }];
    expect(uploadOutcome({ stats: stats({ orders: 1 }), files, parseErrors: [] })).toEqual({ kind: "open_ledger" });
    expect(uploadOutcome({ stats: stats({ needsReview: 2 }), files, parseErrors: [] })).toEqual({
      kind: "open_ledger",
    });
  });

  it("reports the real email, file, and parse-error counts when nothing looked like a purchase", () => {
    const outcome = uploadOutcome({
      stats: stats({ emails: 3 }),
      files: [{ name: "a.eml" }, { name: "b.mbox" }],
      parseErrors: [{}],
    });
    expect(outcome).toEqual({
      kind: "no_receipts",
      detail: "Read 3 emails from 2 files (1 could not be parsed), but none looked like a purchase.",
    });
  });
});

describe("gmailSyncOutcome", () => {
  it("opens the ledger when the sync produced orders or needs-review items", () => {
    expect(gmailSyncOutcome(syncResponse({ stats: stats({ orders: 4 }) }), 50)).toEqual({ kind: "open_ledger" });
    expect(gmailSyncOutcome(syncResponse({ stats: stats({ needsReview: 1 }) }), 50)).toEqual({
      kind: "open_ledger",
    });
  });

  it("shows the fetched count and the cap from the preview when nothing looked like a purchase", () => {
    expect(gmailSyncOutcome(syncResponse({ fetched: 1 }), 50)).toEqual({
      kind: "no_receipts",
      detail: "Fetched 1 message, but none looked like a purchase.",
    });
    expect(gmailSyncOutcome(syncResponse({ fetched: 50, capped: true }), 50)).toEqual({
      kind: "no_receipts",
      detail: "Fetched 50 messages (stopped at the 50-message limit), but none looked like a purchase.",
    });
  });
});

describe("gmailPreviewText", () => {
  it("renders the route's estimate, fetch count, maxMessages, window, and exact query", () => {
    const text = gmailPreviewText(preview);
    expect(text).toContain("Gmail estimates about 120 matching messages from the last 90 days.");
    expect(text).toContain("This sync fetches 50 messages (at most 50 per run).");
    expect(text).toContain("Exact Gmail search: newer_than:90d subject:receipt");
    expect(text).not.toContain("300");
  });

  it("drops the estimate wording when the count is exact", () => {
    expect(gmailPreviewText({ ...preview, countIsEstimate: false })).toContain("Gmail found 120 matching messages");
  });
});

describe("gmailProgressText", () => {
  it("shows only real counts for in-flight stages", () => {
    expect(gmailProgressText({ stage: "listing", fetched: 0, total: null, skipped: 0 })).toBe(
      "Listing matching messages in Gmail…",
    );
    expect(gmailProgressText({ stage: "fetching", fetched: 7, total: 40, skipped: 1 })).toBe(
      "Fetched 7 of 40 messages, 1 skipped…",
    );
    expect(gmailProgressText({ stage: "fetching", fetched: 3, total: null, skipped: 0 })).toBe(
      "Fetched 3 messages…",
    );
    expect(gmailProgressText({ stage: "processing", fetched: 40, total: 40, skipped: 0 })).toBe(
      "Redacting, classifying and extracting 40 fetched messages…",
    );
  });

  it("says only 'Syncing…' for no status or a stage left over from an earlier run", () => {
    expect(gmailProgressText(null)).toBe("Syncing…");
    for (const stage of ["idle", "complete", "failed"] as const) {
      expect(gmailProgressText({ stage, fetched: 50, total: 50, skipped: 0 })).toBe("Syncing…");
    }
  });
});

describe("gmailErrorCopy", () => {
  it("maps 401 to reconnect", () => {
    expect(gmailErrorCopy({ status: 401, code: "token_expired", error: "Reconnect Gmail before syncing." }, "sync").kind).toBe(
      "reconnect",
    );
  });

  it("maps 409 to already running without claiming the ledger changed", () => {
    const copy = gmailErrorCopy({ status: 409, code: "sync_already_running", error: null }, "sync");
    expect(copy.kind).toBe("already_running");
  });

  it("maps 504 sync_timeout to timeout and says the prior ledger is kept", () => {
    const copy = gmailErrorCopy({ status: 504, code: "sync_timeout", error: "Gmail sync did not complete. Try again." }, "sync");
    expect(copy.kind).toBe("timeout");
    expect(copy.what).toContain("Your previous ledger is unchanged.");
  });

  it("maps a real Gmail 429 to rate_limited", () => {
    expect(gmailErrorCopy({ status: 429, code: "gmail_rate_limited", error: null }, "sync").kind).toBe("rate_limited");
  });

  it("maps gmail_access_denied to access_denied", () => {
    expect(gmailErrorCopy({ status: 403, code: "gmail_access_denied", error: null }, "preview").kind).toBe(
      "access_denied",
    );
  });

  it("does not claim the sync stopped when the connection dropped", () => {
    const copy = gmailErrorCopy({ status: 0, code: null, error: null }, "sync");
    expect(copy.kind).toBe("unreachable");
    expect(copy.what).toContain("may still be running");
  });

  it("explains known failure codes and falls back to the server's message", () => {
    expect(gmailErrorCopy({ status: 503, code: "extraction_unavailable", error: "x" }, "sync").what).toBe(
      "Receipt extraction is unavailable right now. Your previous ledger is unchanged.",
    );
    expect(gmailErrorCopy({ status: 422, code: "no_parseable_messages", error: "x" }, "sync").what).toContain(
      "None of the fetched messages could be read.",
    );
    const generic = gmailErrorCopy({ status: 503, code: "sync_unavailable", error: "Gmail sync is unavailable." }, "preview");
    expect(generic).toMatchObject({ kind: "failed", title: "Couldn't load the Gmail preview", what: "Gmail sync is unavailable." });
  });
});
