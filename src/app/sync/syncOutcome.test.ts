import { describe, expect, it } from "vitest";
import type { PipelineStats } from "@/lib/pipeline/run";
import type { GmailSyncResponse } from "@/lib/api/types";
import {
  gmailErrorCopy,
  gmailProgress,
  gmailSyncOutcome,
  importErrorCopy,
  sessionErrorCopy,
  tokenExpiredCopy,
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
    accounts: [],
    ...overrides,
  };
}

describe("uploadOutcome", () => {
  it("opens the ledger when the upload produced orders or needs-review items", () => {
    const files = [{ name: "a.eml" }];
    expect(uploadOutcome({ stats: stats({ orders: 1, findings: 2 }), files, parseErrors: [] })).toEqual({
      kind: "open_ledger",
      result: { scanned: 2, files: 1, parseErrors: 0, orders: 1, needsReview: 0, findings: 2 },
    });
    expect(uploadOutcome({ stats: stats({ needsReview: 2 }), files, parseErrors: [] }).kind).toBe("open_ledger");
  });

  it("reports the real email, file, and parse-error counts when nothing looked like a purchase", () => {
    const outcome = uploadOutcome({
      stats: stats({ emails: 3 }),
      files: [{ name: "a.eml" }, { name: "b.mbox" }],
      parseErrors: [{}],
    });
    expect(outcome).toEqual({
      kind: "no_receipts",
      result: { scanned: 3, files: 2, parseErrors: 1, orders: 0, needsReview: 0, findings: 0 },
    });
  });
});

describe("gmailSyncOutcome", () => {
  it("opens the ledger when the sync produced orders or needs-review items", () => {
    expect(gmailSyncOutcome(syncResponse({ stats: stats({ orders: 4, findings: 1 }) }), 50)).toEqual({
      kind: "open_ledger",
      result: { scanned: 12, parseErrors: 0, capped: false, maxMessages: 50, orders: 4, needsReview: 0, findings: 1 },
    });
    expect(gmailSyncOutcome(syncResponse({ stats: stats({ needsReview: 1 }) }), 50).kind).toBe("open_ledger");
  });

  it("passes the fetched count, capped flag, and the cap from the preview when nothing looked like a purchase", () => {
    expect(gmailSyncOutcome(syncResponse({ fetched: 50, capped: true }), 50)).toEqual({
      kind: "no_receipts",
      result: { scanned: 50, parseErrors: 0, capped: true, maxMessages: 50, orders: 0, needsReview: 0, findings: 0 },
    });
    expect(gmailSyncOutcome(syncResponse({ fetched: 1 }), null).result).not.toHaveProperty("maxMessages");
  });
});

describe("gmailProgress", () => {
  it("passes only real counts for in-flight stages", () => {
    for (const progress of [
      { stage: "listing", fetched: 0, total: null, skipped: 0 },
      { stage: "fetching", fetched: 7, total: 40, skipped: 1 },
      { stage: "fetching", fetched: 3, total: null, skipped: 0 },
      { stage: "processing", fetched: 40, total: 40, skipped: 0 },
    ] as const) {
      expect(gmailProgress(progress)).toEqual(progress);
    }
  });

  it("returns null (plain 'syncing') for no status or a stage left over from an earlier run", () => {
    expect(gmailProgress({ stage: "promotions", fetched: 50, total: 50, skipped: 1, promotions: { fetched: 7, total: 30 } }))
      .toEqual({ stage: "promotions", fetched: 7, total: 30, skipped: 1 });
    expect(gmailProgress({ stage: "promotions", fetched: 50, total: 50, skipped: 0 })).toEqual({ stage: "promotions", fetched: 0, total: null, skipped: 0 });
    expect(gmailProgress(null)).toBeNull();
    for (const stage of ["idle", "complete", "failed"] as const) {
      expect(gmailProgress({ stage, fetched: 50, total: 50, skipped: 0 })).toBeNull();
    }
  });
});

describe("importErrorCopy", () => {
  it("names what failed and keeps the API's message", () => {
    expect(importErrorCopy("upload", "No .eml or .mbox files were uploaded.")).toEqual({
      kind: "failed",
      title: "Couldn't import those files",
      what: "No .eml or .mbox files were uploaded.",
      fix: "Choose .eml or .mbox files, 5 MB in total at most.",
    });
    expect(importErrorCopy("demo", null)).toMatchObject({ title: "Couldn't load the demo data" });
    expect(importErrorCopy("preview", "x")).toMatchObject({ title: "Couldn't load the sync preview", what: "x" });
  });
});

describe("session copy", () => {
  it("maps an expired grant to reconnect and a failed session check to failed", () => {
    expect(tokenExpiredCopy.kind).toBe("reconnect");
    expect(sessionErrorCopy("offline")).toMatchObject({ kind: "failed", what: "offline" });
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

  it("maps a 409 from delete-all during the sync to failed without claiming the prior ledger is kept", () => {
    const error = "Your data was deleted while Gmail was syncing; nothing was saved. Start the sync again if you want it.";
    const copy = gmailErrorCopy({ status: 409, code: null, error }, "sync");
    expect(copy).toMatchObject({ kind: "failed", what: error });
    expect(copy.what).not.toContain("unchanged");
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
