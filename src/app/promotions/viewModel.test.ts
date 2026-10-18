import { describe, expect, it, vi } from "vitest";
import type { PromotionsResponse } from "@/lib/api/types";
import { promotionsFixture } from "@/components/views/fixtures/promotions";
import { copyToClipboard, promotionsViewProps } from "./viewModel";

const data: PromotionsResponse = {
  promotions: promotionsFixture.slice(0, 2), total: 2, asOf: "2026-10-17T15:00:00.000Z", expiredHidden: 1, enriching: true,
};

describe("promotionsViewProps", () => {
  it("maps the API response, the accounts and the callbacks onto the view", () => {
    const onShowExpiredChange = vi.fn();
    const onCopyCode = vi.fn();
    const accounts = [{ id: "a1", mailbox: "sam@example.test", connected: true }];
    const onSyncInbox = vi.fn();
    const props = promotionsViewProps({ data, accounts, showExpired: true, onShowExpiredChange, onCopyCode, onSyncInbox });
    expect(props).toEqual({
      promotions: data.promotions, asOf: data.asOf, accounts, showExpired: true, onShowExpiredChange,
      expiredHidden: 1, enriching: true, loading: false, onCopyCode, onSyncInbox,
    });
  });

  it("shows the view's loading placeholders with no offers while the first load runs", () => {
    const props = promotionsViewProps({ data: null, accounts: undefined, showExpired: false, onShowExpiredChange: vi.fn(), onCopyCode: vi.fn() });
    expect(props).toMatchObject({ promotions: [], expiredHidden: 0, enriching: false, loading: true, onSyncInbox: undefined });
    expect(Number.isNaN(new Date(props.asOf).getTime())).toBe(false);
  });
});

describe("copyToClipboard", () => {
  it("writes to the clipboard and rejects when there is none or the browser refuses", async () => {
    const writeText = vi.fn(async () => undefined);
    await copyToClipboard("FALL20", { writeText });
    expect(writeText).toHaveBeenCalledWith("FALL20");
    await expect(copyToClipboard("FALL20", undefined)).rejects.toThrow(/clipboard is not available/);
    await expect(copyToClipboard("FALL20", { writeText: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
  });
});