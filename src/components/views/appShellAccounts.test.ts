import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { syncConfirmText } from "@/components/ShellSyncControl";
import { AppShellView } from "@/components/views/AppShellView";
import { appShellSyncFixtures, appShellViewFixture } from "@/components/views/fixtures/app-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
// Vitest compiles .tsx with the classic JSX runtime, which needs a global React.
Object.assign(globalThis, { React });

const html = (sync: (typeof appShellSyncFixtures)[keyof typeof appShellSyncFixtures]) =>
  renderToStaticMarkup(createElement(AppShellView, { ...appShellViewFixture, mode: "gmail", sync }));
const text = (markup: string) => markup.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

describe("global Sync button with several Gmail accounts", () => {
  it("the confirm says how many accounts a sync reads", () => {
    expect(text(html(appShellSyncFixtures.confirmingTwoAccounts))).toContain("Read up to 74 emails from the last 90 days across 2 Gmail accounts.");
    expect(syncConfirmText({ messageCount: 50, windowDays: 90, accountCount: 1 })).toBe(syncConfirmText({ messageCount: 50, windowDays: 90 }));
  });

  it("running shows one line per account: 'work 12 of 50, home waiting'", () => {
    const markup = html(appShellSyncFixtures.runningTwoAccounts);
    expect(text(markup)).toContain("Syncing 2 accounts");
    expect(text(markup)).toContain("work.shopper@example.com 12 of 50");
    expect(text(markup)).toContain("home@example.com waiting");
    expect(markup).toContain('data-testid="sync-account-lines"');
  });

  it("a partial failure lists each account and offers Reconnect Gmail", () => {
    const markup = html(appShellSyncFixtures.partialFailure);
    expect(markup).toContain('role="alert"');
    expect(text(markup)).toContain("Synced 1 of 2 accounts");
    expect(text(markup)).toContain("work.shopper@example.com Read 20 emails");
    expect(text(markup)).toContain("home@example.com Needs reconnect");
    expect(text(markup)).toContain("Reconnect Gmail");
    expect(text(markup)).toContain("Dismiss");
  });

  it("single-account running states do not grow a per-account popover", () => {
    expect(html(appShellSyncFixtures.runningFetching)).not.toContain("sync-account-lines");
  });
});
