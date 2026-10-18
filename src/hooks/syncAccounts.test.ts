import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GmailAccountSync, GmailSyncResponse, GmailSyncStatus } from "@/lib/api/types";
import { addAccountHref, connectHref } from "./accountLinks";
import { resetCache } from "./cache";
import { accountProgressLine, accountSyncLine, confirmFromPreview, shellProgress, syncSuccessNotice } from "./syncButton";

const syncGmailMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/client")>()),
  syncGmail: syncGmailMock,
}));

import { isSyncRunning, runGmailSync, runningSyncAccountId } from "./syncRun";

const okWork: GmailAccountSync = { accountId: "acct-work", mailbox: "work@example.com", ok: true, fetched: 20, capped: false };
const okHome: GmailAccountSync = { accountId: "acct-home", mailbox: "home@example.com", ok: true, fetched: 50, capped: true };
const expiredHome: GmailAccountSync = { accountId: "acct-home", mailbox: "home@example.com", ok: false, code: "token_expired" };

function response(accounts: GmailAccountSync[], orders = 12, needsReview = 0): Parameters<typeof syncSuccessNotice>[0] {
  return { stats: { orders, needsReview }, accounts } as Parameters<typeof syncSuccessNotice>[0];
}

describe("accountProgressLine", () => {
  const base = { accountId: "acct-work", mailbox: "work@example.com", fetched: 0, total: null };

  it("says what each account is doing in plain words", () => {
    expect(accountProgressLine({ ...base, stage: "idle" })).toEqual({ accountId: "acct-work", label: "work@example.com", detail: "waiting" });
    expect(accountProgressLine({ ...base, stage: "listing" }).detail).toBe("listing emails");
    expect(accountProgressLine({ ...base, stage: "fetching", fetched: 12, total: 50 }).detail).toBe("12 of 50");
    expect(accountProgressLine({ ...base, stage: "fetching", fetched: 3 }).detail).toBe("reading");
    expect(accountProgressLine({ ...base, stage: "processing" }).detail).toBe("analyzing receipts");
    expect(accountProgressLine({ ...base, stage: "promotions" }).detail).toBe("reading promotions");
    expect(accountProgressLine({ ...base, stage: "complete" }).detail).toBe("done");
    expect(accountProgressLine({ ...base, stage: "failed" }).detail).toBe("could not sync");
  });

  it("falls back to a plain name when the address is unknown", () => {
    expect(accountProgressLine({ ...base, mailbox: null, stage: "idle" }).label).toBe("Gmail account");
  });
});

describe("shellProgress", () => {
  const status = (overrides: Partial<GmailSyncStatus>): GmailSyncStatus => ({ stage: "fetching", fetched: 12, total: null, skipped: 0, ...overrides });

  it("is null while nothing is in flight (idle, complete or failed are left over from earlier)", () => {
    expect(shellProgress(null)).toBeNull();
    for (const stage of ["idle", "complete", "failed"] as const) expect(shellProgress(status({ stage }))).toBeNull();
  });

  it("keeps the plain shape for one account", () => {
    expect(shellProgress(status({ total: 50 }))).toEqual({ stage: "fetching", fetched: 12, total: 50 });
    expect(shellProgress(status({ total: 50, accounts: [{ accountId: "a", mailbox: "a@example.com", stage: "fetching", fetched: 12, total: 50 }] }))).not.toHaveProperty("accounts");
  });

  it("adds a line per account while several sync: 'work 12 of 50, home waiting'", () => {
    const progress = shellProgress(
      status({
        accounts: [
          { accountId: "acct-work", mailbox: "work@example.com", stage: "fetching", fetched: 12, total: 50 },
          { accountId: "acct-home", mailbox: "home@example.com", stage: "idle", fetched: 0, total: null },
        ],
      }),
    );
    expect(progress?.accounts?.map((line) => `${line.label} ${line.detail}`)).toEqual(["work@example.com 12 of 50", "home@example.com waiting"]);
  });
});

describe("accountSyncLine", () => {
  it("reports what was read, and a reached limit", () => {
    expect(accountSyncLine(okWork)).toEqual({ accountId: "acct-work", label: "work@example.com", ok: true, text: "Read 20 emails" });
    expect(accountSyncLine(okHome).text).toBe("Read 50 emails (limit reached)");
    expect(accountSyncLine({ ...okWork, fetched: 1 }).text).toBe("Read 1 email");
  });

  it("flags failures and offers Reconnect only where Google's consent helps", () => {
    expect(accountSyncLine(expiredHome)).toMatchObject({ ok: false, text: "Needs reconnect", reconnect: true });
    expect(accountSyncLine({ ...expiredHome, code: "gmail_access_denied" })).toMatchObject({ text: "Access denied, reconnect", reconnect: true });
    expect(accountSyncLine({ ...expiredHome, code: "sync_timeout" })).toMatchObject({ text: "Took too long", reconnect: false });
    expect(accountSyncLine({ ...expiredHome, code: "gmail_rate_limited" }).text).toBe("Gmail asked to slow down");
    expect(accountSyncLine({ ...expiredHome, code: "something_else" }).text).toBe("Could not sync");
    expect(accountSyncLine({ ...expiredHome, mailbox: null }).label).toBe("Gmail account");
  });
});

describe("syncSuccessNotice with accounts", () => {
  it("is unchanged for one account or none", () => {
    expect(syncSuccessNotice(response([okWork]))).toEqual({ tone: "success", text: "Synced 12 purchases", detail: undefined });
    expect(syncSuccessNotice(response([]))).not.toHaveProperty("accounts");
  });

  it("lists each account when several succeeded", () => {
    const notice = syncSuccessNotice(response([okWork, okHome], 12, 2));
    expect(notice).toMatchObject({ tone: "success", text: "Synced 12 purchases", detail: "2 items need a check in Review." });
    expect(notice.accounts?.map((account) => account.text)).toEqual(["Read 20 emails", "Read 50 emails (limit reached)"]);
    expect(notice.reconnect).toBeUndefined();
  });

  it("flags a partial failure as an error that names the account and offers Reconnect, while the others are kept", () => {
    const notice = syncSuccessNotice(response([okWork, expiredHome]));
    expect(notice.tone).toBe("error");
    expect(notice.text).toBe("Synced 1 of 2 accounts");
    expect(notice.reconnect).toBe(true);
    expect(notice.detail).toContain("Purchases from the accounts that worked were saved.");
    expect(notice.detail).toContain("Reconnect the account that needs it");
    expect(notice.accounts).toEqual([
      { accountId: "acct-work", label: "work@example.com", ok: true, text: "Read 20 emails" },
      { accountId: "acct-home", label: "home@example.com", ok: false, text: "Needs reconnect", reconnect: true },
    ]);
  });

  it("does not suggest a reconnect for a failure that one will not fix", () => {
    const notice = syncSuccessNotice(response([okWork, { ...expiredHome, code: "sync_timeout" }]));
    expect(notice.reconnect).toBe(false);
    expect(notice.detail).toContain("Try the account that failed again");
  });
});

describe("confirmFromPreview with accounts", () => {
  const preview = { messagesToFetch: 74, maxMessages: 50, windowDays: 90 };
  const answered = (accountId: string) => ({ accountId, mailbox: `${accountId}@example.com`, ok: true as const, estimatedMessages: 40, messagesToFetch: 37 });

  it("counts the accounts that answered", () => {
    expect(confirmFromPreview({ ...preview, accounts: [answered("a"), answered("b")] })).toEqual({
      status: "ready",
      messageCount: 74,
      windowDays: 90,
      accountCount: 2,
    });
  });

  it("leaves the plain shape for one account, and ignores an account that could not be read", () => {
    expect(confirmFromPreview({ ...preview, accounts: [answered("a")] })).toEqual({ status: "ready", messageCount: 74, windowDays: 90 });
    const withExpired = [answered("a"), { accountId: "b", mailbox: null, ok: false as const, code: "token_expired" }];
    expect(confirmFromPreview({ ...preview, accounts: withExpired })).not.toHaveProperty("accountCount");
  });

  it("falls back to the per-account cap times the accounts when nothing is known yet", () => {
    expect(confirmFromPreview({ ...preview, messagesToFetch: 0, accounts: [answered("a"), answered("b")] }).messageCount).toBe(100);
  });
});

describe("reconnect and add-account links", () => {
  it("adds accounts through the link flow, always", () => {
    expect(addAccountHref()).toBe("/api/auth/link");
  });

  it("reconnects through the link flow once the profile has accounts, else through the plain sign-in", () => {
    expect(connectHref(null)).toBe("/api/auth/google");
    expect(connectHref({ accounts: [] })).toBe("/api/auth/google");
    expect(connectHref({ accounts: [{ id: "a", mailbox: "a@example.com", connected: false, expired: true, lastSyncAt: null }] })).toBe("/api/auth/link");
  });
});

describe("runGmailSync target", () => {
  beforeEach(() => {
    resetCache();
    syncGmailMock.mockReset();
  });
  afterEach(() => resetCache());

  it("remembers the account of a running sync of one account and forgets it afterwards", async () => {
    let finish: (value: GmailSyncResponse) => void = () => {};
    syncGmailMock.mockReturnValue(new Promise<GmailSyncResponse>((resolve) => (finish = resolve)));
    const run = runGmailSync({ accountId: "acct-work" });
    expect(isSyncRunning()).toBe(true);
    expect(runningSyncAccountId()).toBe("acct-work");
    expect(syncGmailMock).toHaveBeenCalledWith({ accountId: "acct-work" });

    finish({} as GmailSyncResponse);
    await run;
    expect(isSyncRunning()).toBe(false);
    expect(runningSyncAccountId()).toBeNull();
  });

  it("syncs every connected account by default (no target)", async () => {
    syncGmailMock.mockResolvedValue({} as GmailSyncResponse);
    const run = runGmailSync();
    expect(runningSyncAccountId()).toBeNull();
    expect(syncGmailMock).toHaveBeenCalledWith({});
    await run;
  });

  it("clears the target when the sync fails", async () => {
    syncGmailMock.mockRejectedValue(new Error("boom"));
    await expect(runGmailSync({ accountId: "acct-work" })).rejects.toThrow("boom");
    expect(runningSyncAccountId()).toBeNull();
    expect(isSyncRunning()).toBe(false);
  });
});
