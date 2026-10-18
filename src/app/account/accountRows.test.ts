import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountView, type AccountViewProps } from "@/components/views/AccountView";
import { accountViewFixtures } from "@/components/views/fixtures/account";
import type { LinkedAccount } from "@/lib/api/types";
import { accountRowStatus, buildAccountRows } from "./accountState";

vi.mock("next/navigation", () => ({ usePathname: () => "/account" }));
// Vitest compiles .tsx with the classic JSX runtime, which needs a global React.
Object.assign(globalThis, { React });

const NOW = new Date("2026-10-18T12:00:00.000Z");
const work: LinkedAccount = { id: "acct-work", mailbox: "work@example.com", connected: true, expired: false, lastSyncAt: "2026-10-18T11:55:00.000Z" };
const home: LinkedAccount = { id: "acct-home", mailbox: "home@example.com", connected: true, expired: false, lastSyncAt: null };
const expired: LinkedAccount = { ...home, connected: false, expired: true, lastSyncAt: "2026-10-15T12:00:00.000Z" };
const disconnected: LinkedAccount = { id: "acct-old", mailbox: null, connected: false, expired: true, lastSyncAt: null };

describe("accountRowStatus", () => {
  it("tells connected, expired (address known) and disconnected (no address) apart", () => {
    expect(accountRowStatus(work)).toBe("connected");
    expect(accountRowStatus(expired)).toBe("expired");
    expect(accountRowStatus(disconnected)).toBe("disconnected");
  });
});

describe("buildAccountRows", () => {
  const idle = { state: "ready", progress: null, targetAccountId: null } as const;

  it("maps every linked account: label, status, last sync", () => {
    const rows = buildAccountRows([work, expired, disconnected], idle, NOW);
    expect(rows).toEqual([
      { id: "acct-work", label: "work@example.com", status: "connected", lastSync: { relative: "5 minutes ago", absolute: expect.any(String) }, syncing: false, syncDetail: null },
      { id: "acct-home", label: "home@example.com", status: "expired", lastSync: { relative: "3 days ago", absolute: expect.any(String) }, syncing: false, syncDetail: null },
      { id: "acct-old", label: "Disconnected account", status: "disconnected", lastSync: null, syncing: false, syncDetail: null },
    ]);
  });

  it("marks only the target account while one account syncs, with the whole sync's counts", () => {
    const rows = buildAccountRows([work, home], { state: "running", progress: { stage: "fetching", fetched: 12, total: 50 }, targetAccountId: "acct-work" }, NOW);
    expect(rows.map((row) => [row.id, row.syncing, row.syncDetail])).toEqual([
      ["acct-work", true, "Reading 12 of 50"],
      ["acct-home", false, null],
    ]);
  });

  it("marks every connected account while all sync, with a line per account", () => {
    const progress = {
      stage: "fetching" as const,
      fetched: 12,
      total: null,
      accounts: [
        { accountId: "acct-work", label: "work@example.com", detail: "12 of 50" },
        { accountId: "acct-home", label: "home@example.com", detail: "waiting" },
      ],
    };
    const rows = buildAccountRows([work, home, disconnected], { state: "running", progress, targetAccountId: null }, NOW);
    expect(rows.map((row) => [row.id, row.syncing, row.syncDetail])).toEqual([
      ["acct-work", true, "Syncing, 12 of 50"],
      ["acct-home", true, "Waiting for its turn"],
      ["acct-old", false, null],
    ]);
  });

  it("says plain 'Syncing' before the first progress arrives, and never marks an expired account", () => {
    const rows = buildAccountRows([work, expired], { state: "running", progress: null, targetAccountId: null }, NOW);
    expect(rows.map((row) => [row.syncing, row.syncDetail])).toEqual([[true, "Syncing"], [false, null]]);
  });

  it("marks nothing without a running sync or before the sync control is known", () => {
    expect(buildAccountRows([work], idle, NOW)[0].syncing).toBe(false);
    expect(buildAccountRows([work], null, NOW)[0].syncing).toBe(false);
  });
});

/** Visible text only, entities decoded, so assertions read like the screen. */
function render(props: AccountViewProps): string {
  return renderToStaticMarkup(createElement(AccountView, props))
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}
const html = (props: AccountViewProps) => renderToStaticMarkup(createElement(AccountView, props));
const f = accountViewFixtures;
const rows = (props: AccountViewProps) => [...html(props).matchAll(/<li[^>]*data-testid="account-row"[^>]*>(.*?)<\/li>/gs)].map((match) => match[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));

describe("AccountView with linked accounts", () => {
  it("lists one row per account, each with last sync, and no single-account Gmail card", () => {
    const two = rows(f.accountsTwo);
    expect(two).toHaveLength(2);
    expect(two[0]).toContain("work.shopper@example.com");
    expect(two[0]).toContain("Connected");
    expect(two[0]).toContain("Last synced 5 minutes ago");
    expect(two[1]).toContain("home@example.com");
    expect(two[1]).toContain("Last synced 2 hours ago");
    expect(html(f.accountsTwo)).not.toContain('data-testid="mailbox"');
    expect(render(f.accountsTwo)).toContain("Gmail accounts");
  });

  it("connected accounts get Sync this account and Disconnect, never Reconnect", () => {
    const [first] = rows(f.accountsTwo);
    expect(first).toContain("Sync this account");
    expect(first).toContain("Disconnect");
    expect(first).not.toContain("Reconnect");
    expect(html(f.accountsTwo)).toMatch(/aria-label="Sync this account: work.shopper@example.com"/);
  });

  it("shows an expired account and a disconnected account with Reconnect and no Sync or Disconnect", () => {
    const [connected, expired, disconnected] = rows(f.accountsThree);
    expect(connected).toContain("Sync this account");
    expect(expired).toContain("Expired, needs reconnect");
    expect(expired).toContain("Reconnect");
    expect(expired).not.toContain("Sync this account");
    expect(expired).not.toMatch(/Disconnect(?!ed)/);
    expect(disconnected).toContain("Disconnected account");
    expect(disconnected).toContain("Disconnected");
    expect(disconnected).toContain("Never synced");
    expect(disconnected).toContain("Its purchases are kept");
    expect(disconnected).toContain("Reconnect");
    expect(disconnected).not.toContain("Sync this account");
  });

  it("offers Add another Gmail account always and Sync all accounts only with two connected accounts", () => {
    for (const fixture of [f.accountsOne, f.accountsTwo, f.accountsThree]) expect(render(fixture)).toContain("Add another Gmail account");
    expect(render(f.accountsTwo)).toContain("Sync all accounts");
    expect(render(f.accountsOne)).not.toContain("Sync all accounts");
    expect(render(f.accountsThree)).not.toContain("Sync all accounts");
  });

  it("keeps the data source, counts and controls below the accounts", () => {
    const text = render(f.accountsThree);
    expect(text).toContain("Current data source");
    expect(text).toContain("Need a check");
    expect(text).toContain("Manage excluded stores");
    expect(text).toContain("Delete everything");
  });

  it("asks before disconnecting one account and says its purchases are kept", () => {
    const confirming = render(f.accountsConfirmDisconnect);
    expect(confirming).toContain("Disconnect home@example.com?");
    expect(confirming).toContain("Its purchases and findings are kept");
    expect(confirming).toContain("Keep connected");
    // Only the chosen row asks; the other keeps its normal actions.
    const [first, second] = rows(f.accountsConfirmDisconnect);
    expect(first).toContain("Sync this account");
    expect(second).toContain("Keep connected");
    expect(render(f.accountsDisconnecting)).toContain("Disconnecting");
  });

  it("confirms a sync inside the row of the chosen account, with the real numbers", () => {
    const [first, second] = rows(f.accountsConfirmSyncOne);
    expect(first).toContain("Read up to 31 emails from the last 90 days");
    expect(first).toContain("Start sync");
    expect(second).not.toContain("Start sync");
    // Everything else waits while the confirm is open.
    expect(html(f.accountsConfirmSyncOne)).toMatch(/<button[^>]*aria-label="Sync this account: home@example.com"[^>]*disabled=""/);
  });

  it("confirms Sync all accounts below the list and counts the accounts", () => {
    const text = render(f.accountsConfirmSyncAll);
    expect(text).toContain("Read up to 74 emails from the last 90 days across 2 Gmail accounts");
    expect(rows(f.accountsConfirmSyncAll).join(" ")).not.toContain("Start sync");
  });

  it("shows per-account progress while syncing and blocks a second sync", () => {
    const [first, second] = rows(f.accountsSyncingAll);
    expect(first).toContain("Syncing, 12 of 50");
    expect(second).toContain("Waiting for its turn");
    expect(html(f.accountsSyncingAll)).not.toMatch(/<button(?![^>]*disabled)[^>]*>(Sync this account|Syncing|Sync all accounts|Syncing all accounts)</);
    const one = rows(f.accountsSyncingOne);
    expect(one[0]).toContain("Reading 12 of 50");
    expect(one[1]).not.toContain("Syncing");
  });

  it("reports a partial failure per account and offers Reconnect for the expired one", () => {
    const text = render(f.accountsPartialFailure);
    expect(text).toContain("Synced 1 of 2 accounts");
    expect(text).toContain("Read 20 emails");
    expect(text).toContain("Needs reconnect");
    expect(text).toContain("Reconnect Gmail");
    expect(html(f.accountsPartialFailure)).toContain('role="alert"');
    expect(render(f.accountsSyncedAll)).toContain("Read 8 emails");
  });

  it.each(Object.entries(f).filter(([name]) => name.startsWith("accounts")))("%s has no em dash and no simulated wording", (_name, props) => {
    const text = render(props);
    expect(text).not.toContain("\u2014");
    expect(text.toLowerCase()).not.toContain("simulated");
  });
});
