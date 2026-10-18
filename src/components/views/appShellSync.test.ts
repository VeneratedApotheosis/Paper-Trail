import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { syncButtonLabel, syncConfirmText } from "@/components/ShellSyncControl";
import { AppShellView } from "@/components/views/AppShellView";
import { appShellSyncFixtures, appShellViewFixture } from "@/components/views/fixtures/app-shell";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
// Vitest compiles .tsx with the classic JSX runtime, which needs a global React.
Object.assign(globalThis, { React });

function render(sync?: (typeof appShellSyncFixtures)[keyof typeof appShellSyncFixtures]): string {
  return renderToStaticMarkup(createElement(AppShellView, { ...appShellViewFixture, mode: "gmail", sync }))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

describe("AppShellView navigation", () => {
  it("lists Owed to you, Purchases, Promotions, Review, Trust and Account", () => {
    // nav undefined = the shell's own default items
    const html = renderToStaticMarkup(
      createElement(AppShellView, { ...appShellViewFixture, nav: undefined, activePath: "/account" }),
    );
    const labels = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((m) => `${m[1]}:${m[2]}`);
    expect(labels.slice(1, 7)).toEqual([
      "/:Owed to you",
      "/ledger:Purchases",
      "/promotions:Promotions",
      "/review:Review",
      "/trust:Trust",
      "/account:Account",
    ]);
    expect(html).toMatch(/aria-current="page"[^>]*>Account</);
  });
});

describe("shell Sync emails button", () => {
  it("renders no button without the sync prop", () => {
    expect(render(undefined)).not.toContain("Sync emails");
  });

  it("labels each state", () => {
    expect(syncButtonLabel("ready")).toBe("Sync emails");
    expect(syncButtonLabel("checking")).toBe("Sync emails");
    expect(syncButtonLabel("connect")).toBe("Connect Gmail");
    expect(syncButtonLabel("reconnect")).toBe("Reconnect Gmail");
    expect(syncButtonLabel("running")).toBe("Syncing");
    expect(syncButtonLabel("running", { stage: "listing", fetched: 0, total: null })).toBe("Syncing");
    expect(syncButtonLabel("running", { stage: "fetching", fetched: 12, total: 50 })).toBe("Reading 12 of 50");
    expect(syncButtonLabel("running", { stage: "fetching", fetched: 3, total: null })).toBe("Syncing");
    expect(syncButtonLabel("running", { stage: "processing", fetched: 50, total: 50 })).toBe("Analyzing receipts");
  });

  it("ready shows Sync emails and the last sync time", () => {
    const text = render(appShellSyncFixtures.ready);
    expect(text).toContain("Sync emails");
    expect(text).toContain("Last synced 5 minutes ago");
    expect(render(appShellSyncFixtures.neverSynced)).toContain("Not synced yet");
  });

  it("the confirm uses the real preview numbers and the required wording", () => {
    const text = render(appShellSyncFixtures.confirming);
    expect(text).toContain(
      "Read up to 50 emails from the last 90 days. Receipts are redacted and sent to Claude for analysis. Nothing is sent or changed in your mailbox.",
    );
    expect(text).toContain("Start sync");
    expect(text).toContain("Cancel");
    expect(syncConfirmText({ messageCount: 18, windowDays: 90 })).toContain("Read up to 18 emails from the last 90 days.");
    const loading = render(appShellSyncFixtures.confirmLoading);
    expect(loading).toContain("Checking your mailbox");
    expect(loading).not.toContain("Start sync");
  });

  it("running is disabled and shows live progress", () => {
    const html = renderToStaticMarkup(
      createElement(AppShellView, { ...appShellViewFixture, mode: "gmail", sync: appShellSyncFixtures.runningFetching }),
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-busy="true"|<button[^>]*aria-busy="true"[^>]*disabled=""/);
    expect(html).toContain("Reading 12 of 50");
  });

  it("checking is disabled; connect and reconnect are enabled", () => {
    const button = (sync: Parameters<typeof render>[0]) =>
      renderToStaticMarkup(createElement(AppShellView, { ...appShellViewFixture, mode: "gmail", sync })).match(
        /<button[^>]*>/,
      )![0];
    expect(button(appShellSyncFixtures.checking)).toContain('disabled=""');
    expect(button(appShellSyncFixtures.connect)).not.toContain('disabled=""');
    expect(render(appShellSyncFixtures.connect)).toContain("Connect Gmail");
    expect(render(appShellSyncFixtures.reconnect)).toContain("Reconnect Gmail");
  });

  it("announces results: success, already running, expired with a Reconnect action", () => {
    expect(render(appShellSyncFixtures.success)).toContain("Synced 12 purchases");
    expect(render(appShellSyncFixtures.alreadyRunning)).toContain("A Gmail sync is already running");
    const expired = render(appShellSyncFixtures.expired);
    expect(expired).toContain("Your Gmail connection expired");
    expect(expired.match(/Reconnect Gmail/g)?.length).toBe(2);
  });
});
