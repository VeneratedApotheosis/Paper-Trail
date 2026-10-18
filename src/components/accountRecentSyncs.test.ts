import { describe, expect, it } from "vitest";
import { recentSyncs } from "@/components/accountRecentSyncs";
import { accountViewFixtures as f } from "@/components/views/fixtures/account";

const sync = { relative: "5 minutes ago", absolute: "Oct 18, 2026, 1:02 AM" };

describe("recentSyncs", () => {
  it("lists each synced account and skips accounts never synced", () => {
    const rows = recentSyncs({ accounts: f.accountsThree.accounts!, mailbox: null, lastSync: sync });
    expect(rows.map((r) => r.text)).toEqual([
      "work.shopper@example.com: synced 5 minutes ago",
      "home@example.com: synced 3 days ago",
    ]);
    expect(rows[0].when).toBe("Oct 18, 2026, 1:02 AM");
  });

  it("without accounts, uses the single last sync with the mailbox or plain Gmail", () => {
    expect(recentSyncs({ accounts: [], mailbox: "shopper@example.com", lastSync: sync })[0].text).toBe("shopper@example.com: synced 5 minutes ago");
    expect(recentSyncs({ accounts: [], mailbox: null, lastSync: sync })[0].text).toBe("Gmail: synced 5 minutes ago");
  });

  it("is empty when nothing was ever synced", () => {
    expect(recentSyncs({ accounts: [], mailbox: null, lastSync: null })).toEqual([]);
  });
});