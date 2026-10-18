import { describe, expect, it } from "vitest";
import type { AccountResponse, GmailFailure } from "@/lib/api/types";
import { syncConfirmText } from "@/components/ShellSyncControl";
import {
  confirmFromPreview,
  deriveSyncButtonState,
  lastSyncLabel,
  syncFailureNotice,
  syncSuccessNotice,
} from "./syncButton";

type SyncAccount = Pick<AccountResponse, "gmail" | "mode" | "syncing" | "lastSyncAt">;

function account(overrides: Partial<SyncAccount> & { gmail?: Partial<AccountResponse["gmail"]> } = {}): SyncAccount {
  const { gmail, ...rest } = overrides;
  return {
    gmail: { connected: true, expired: false, mailbox: "shopper@example.com", ...gmail },
    mode: "gmail",
    syncing: false,
    lastSyncAt: null,
    ...rest,
  };
}

describe("deriveSyncButtonState", () => {
  it("is checking until the account is loaded", () => {
    expect(deriveSyncButtonState(null, false)).toBe("checking");
  });

  it("is ready for a connected Gmail account on Gmail or empty data", () => {
    expect(deriveSyncButtonState(account(), false)).toBe("ready");
    expect(deriveSyncButtonState(account({ mode: "empty" }), false)).toBe("ready");
  });

  it("is running when a sync started here or the server says one is running", () => {
    expect(deriveSyncButtonState(account(), true)).toBe("running");
    expect(deriveSyncButtonState(null, true)).toBe("running");
    expect(deriveSyncButtonState(account({ syncing: true }), false)).toBe("running");
  });

  it("is reconnect when the grant expired", () => {
    expect(deriveSyncButtonState(account({ gmail: { connected: false, expired: true, mailbox: null } }), false)).toBe("reconnect");
  });

  it("is connect when Gmail is not connected, including disconnected data", () => {
    const notConnected = { connected: false, expired: false, mailbox: null };
    expect(deriveSyncButtonState(account({ gmail: notConnected, mode: "empty" }), false)).toBe("connect");
    expect(deriveSyncButtonState(account({ gmail: notConnected, mode: "gmail" }), false)).toBe("connect");
  });

  it("never offers a sync over demo or uploaded data, even with a live grant", () => {
    expect(deriveSyncButtonState(account({ mode: "demo" }), false)).toBe("connect");
    expect(deriveSyncButtonState(account({ mode: "upload" }), false)).toBe("connect");
  });

  it("ignores a stale server syncing flag when Gmail is not connected", () => {
    const notConnected = { connected: false, expired: false, mailbox: null };
    expect(deriveSyncButtonState(account({ gmail: notConnected, syncing: true, mode: "gmail" }), false)).toBe("connect");
  });
});

describe("lastSyncLabel", () => {
  const now = new Date("2026-10-18T12:00:00.000Z");

  it("shows the relative last sync time", () => {
    const synced = account({ lastSyncAt: "2026-10-18T11:55:00.000Z" });
    expect(lastSyncLabel(synced, "ready", now)).toBe("Last synced 5 minutes ago");
    expect(lastSyncLabel(synced, "connect", now)).toBe("Last synced 5 minutes ago");
  });

  it("says Not synced yet only where a sync is possible", () => {
    expect(lastSyncLabel(account(), "ready", now)).toBe("Not synced yet");
    expect(lastSyncLabel(account(), "connect", now)).toBeUndefined();
    expect(lastSyncLabel(null, "checking", now)).toBeUndefined();
  });
});

describe("confirmFromPreview", () => {
  it("uses the number of messages a sync would read and the window", () => {
    expect(confirmFromPreview({ messagesToFetch: 18, maxMessages: 50, windowDays: 90 })).toEqual({
      status: "ready",
      messageCount: 18,
      windowDays: 90,
    });
  });

  it("carries the redaction mode so the confirm copy can say whether receipts are redacted (#125)", () => {
    const confirm = confirmFromPreview({ messagesToFetch: 18, maxMessages: 50, windowDays: 90, redaction: "off" });
    expect(confirm.redaction).toBe("off");
    expect(syncConfirmText(confirm)).toContain("redaction is off");
    expect(syncConfirmText({ ...confirm, redaction: "on" })).toContain("Receipts are redacted");
  });

  it("falls back to the per-run cap when Google's estimate is zero", () => {
    expect(confirmFromPreview({ messagesToFetch: 0, maxMessages: 50, windowDays: 90 }).messageCount).toBe(50);
  });
});

describe("syncSuccessNotice", () => {
  const stats = (orders: number, needsReview: number) => ({ stats: { orders, needsReview } }) as Parameters<typeof syncSuccessNotice>[0];

  it("reports the real purchase count", () => {
    expect(syncSuccessNotice(stats(12, 0))).toEqual({ tone: "success", text: "Synced 12 purchases", detail: undefined });
    expect(syncSuccessNotice(stats(1, 0)).text).toBe("Synced 1 purchase");
  });

  it("says so when nothing was found and mentions items to check", () => {
    expect(syncSuccessNotice(stats(0, 0)).text).toBe("Sync finished, no purchases found");
    expect(syncSuccessNotice(stats(3, 2)).detail).toBe("2 items need a check in Review.");
    expect(syncSuccessNotice(stats(3, 1)).detail).toBe("1 item needs a check in Review.");
  });
});

describe("syncFailureNotice", () => {
  const failure = (status: number, code: string | null): GmailFailure => ({ status, code, error: null });

  it("asks to reconnect when the grant expired (401)", () => {
    const notice = syncFailureNotice(failure(401, "token_expired"), "sync");
    expect(notice).toMatchObject({ tone: "error", text: "Your Gmail connection expired", reconnect: true });
  });

  it("explains a sync that is already running (409)", () => {
    const notice = syncFailureNotice(failure(409, "sync_already_running"), "sync");
    expect(notice.text).toBe("A Gmail sync is already running");
    expect(notice.reconnect).toBe(false);
  });

  it("explains the time limit (504) and says the previous ledger is unchanged", () => {
    const notice = syncFailureNotice(failure(504, "sync_timeout"), "sync");
    expect(notice.text).toBe("Gmail sync took too long");
    expect(notice.detail).toContain("Your previous ledger is unchanged.");
  });

  it("handles other errors and offline without claiming a reconnect", () => {
    expect(syncFailureNotice(failure(0, null), "sync")).toMatchObject({ text: "Couldn't reach PaperTrail", reconnect: false });
    expect(syncFailureNotice(failure(502, "gmail_unavailable"), "preview")).toMatchObject({
      text: "Couldn't load the Gmail preview",
      reconnect: false,
    });
  });
});
