import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountView, type AccountViewProps } from "@/components/views/AccountView";
import { accountViewFixtures } from "@/components/views/fixtures/account";
import type { AccountResponse } from "@/lib/api/types";
import { GMAIL_DISCONNECTED_SOURCE_LABEL, buildAccountViewData, gmailStatusOf, sourceOf } from "./accountState";

vi.mock("next/navigation", () => ({ usePathname: () => "/account" }));
// Vitest compiles .tsx with the classic JSX runtime, which needs a global React.
Object.assign(globalThis, { React });

const NOW = new Date("2026-10-18T12:00:00.000Z");

function account(overrides: Partial<AccountResponse> = {}): AccountResponse {
  return {
    gmail: { connected: true, expired: false, mailbox: "shopper@example.com" },
    mode: "gmail",
    asOf: "2026-10-18T11:55:00.000Z",
    lastSyncAt: "2026-10-18T11:55:00.000Z",
    counts: { orders: 45, findings: 6, reviewItems: 2 },
    excludedMerchants: ["shop.example"],
    syncing: false,
    ...overrides,
  };
}

const NOT_CONNECTED = { connected: false, expired: false, mailbox: null };
const EXPIRED = { connected: false, expired: true, mailbox: null };

describe("gmailStatusOf", () => {
  it("maps the account's Gmail flags to the three states", () => {
    expect(gmailStatusOf({ connected: true, expired: false })).toBe("connected");
    expect(gmailStatusOf(EXPIRED)).toBe("expired");
    expect(gmailStatusOf(NOT_CONNECTED)).toBe("not_connected");
  });
});

describe("sourceOf", () => {
  it("names each data source", () => {
    expect(sourceOf(account()).label).toBe("Gmail");
    expect(sourceOf(account({ mode: "demo", gmail: NOT_CONNECTED })).label).toBe("Demo data");
    expect(sourceOf(account({ mode: "upload", gmail: NOT_CONNECTED })).label).toBe("Uploaded files");
    expect(sourceOf(account({ mode: "empty", counts: { orders: 0, findings: 0, reviewItems: 0 } })).kind).toBe("empty");
  });

  it("says synced purchases are kept after Gmail was disconnected or expired", () => {
    for (const gmail of [NOT_CONNECTED, EXPIRED]) {
      expect(sourceOf(account({ gmail }))).toMatchObject({
        kind: "gmail_disconnected",
        label: GMAIL_DISCONNECTED_SOURCE_LABEL,
      });
    }
    expect(GMAIL_DISCONNECTED_SOURCE_LABEL).toBe("Gmail disconnected: your synced purchases are kept");
  });

  it("does not claim kept purchases when there are none", () => {
    const none = { orders: 0, findings: 0, reviewItems: 0 };
    expect(sourceOf(account({ gmail: NOT_CONNECTED, counts: none })).kind).toBe("empty");
  });
});

describe("buildAccountViewData", () => {
  it("maps a connected account", () => {
    expect(buildAccountViewData(account(), false, NOW)).toEqual({
      gmail: { status: "connected", mailbox: "shopper@example.com" },
      source: { kind: "gmail", label: "Gmail", detail: "Purchases read from your mailbox." },
      lastSync: { relative: "5 minutes ago", absolute: expect.stringContaining("Oct 18, 2026") },
      counts: { purchases: 45, findings: 6, needsCheck: 2 },
      excludedStores: 1,
      syncing: false,
    });
  });

  it("has no last sync before the first one", () => {
    expect(buildAccountViewData(account({ lastSyncAt: null }), false, NOW).lastSync).toBeNull();
  });

  it("never shows a mailbox once Gmail is not connected", () => {
    const data = buildAccountViewData(account({ gmail: { connected: false, expired: true, mailbox: "left@example.com" } }), false, NOW);
    expect(data.gmail).toEqual({ status: "expired", mailbox: null });
  });

  it("is syncing when this tab or the server runs a sync (server flag only counts while connected)", () => {
    expect(buildAccountViewData(account(), true, NOW).syncing).toBe(true);
    expect(buildAccountViewData(account({ syncing: true }), false, NOW).syncing).toBe(true);
    expect(buildAccountViewData(account({ syncing: true, gmail: NOT_CONNECTED }), false, NOW).syncing).toBe(false);
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

const f = accountViewFixtures;
const SYNC_FLOW = ["Simulated", "simulated", "fake"];

describe("AccountView fixtures", () => {
  it.each(Object.entries(f))("%s renders without simulated text or em dashes", (_name, props) => {
    const text = render(props);
    for (const word of SYNC_FLOW) expect(text).not.toContain(word);
    expect(text).not.toContain("\u2014");
    expect(text).toContain("Manage excluded stores");
    expect(text).toContain("Delete everything");
  });

  it("connected: shows the mailbox, last sync, counts, Sync emails and Disconnect Gmail", () => {
    const text = render(f.connected);
    expect(text).toContain("Connected");
    expect(text).toContain("shopper@example.com");
    expect(text).toContain("5 minutes ago");
    expect(text).toContain("Oct 18, 2026, 1:02 AM");
    expect(text).toContain("Purchases");
    expect(text).toContain("Need a check");
    expect(text).toContain("1 store is excluded from scanning.");
    expect(text).toContain("Sync emails");
    expect(text).toContain("Disconnect Gmail");
    expect(text).not.toContain("Reconnect Gmail");
    expect(text).not.toContain("Leave demo");
  });

  it("never synced: says Never synced", () => {
    const text = render(f.connectedNeverSynced);
    expect(text).toContain("Never synced");
    expect(text).toContain("No stores excluded.");
  });

  it("connected without a known mailbox shows no address", () => {
    expect(render(f.connectedMailboxUnknown)).not.toContain("@");
  });

  it("syncing disables Sync emails", () => {
    expect(renderToStaticMarkup(createElement(AccountView, f.syncing))).toMatch(/<button[^>]*disabled=""[^>]*>Syncing<\/button>/);
  });

  it("disconnect asks first and explains purchases are kept", () => {
    const idle = render(f.connected);
    expect(idle).not.toContain("Keep connected");
    const confirming = render(f.confirmingDisconnect);
    expect(confirming).toContain("Disconnect Gmail?");
    expect(confirming).toContain("Your purchases and findings are kept");
    expect(confirming).toContain("Keep connected");
    expect(confirming).not.toContain("Sync emails");
    expect(render(f.disconnecting)).toContain("Disconnecting");
  });

  it("shows an action error in plain words", () => {
    expect(render(f.disconnectFailed)).toContain("Couldn't disconnect Gmail");
  });

  it("expired: Reconnect Gmail, no Sync or Disconnect", () => {
    const text = render(f.expired);
    expect(text).toContain("Expired, needs reconnect");
    expect(text).toContain("Reconnect Gmail");
    expect(text).not.toContain("Sync emails");
    expect(text).not.toContain("Disconnect Gmail");
  });

  it("not connected: Connect Gmail only", () => {
    const text = render(f.notConnected);
    expect(text).toContain("Not connected");
    expect(text).toContain("Connect Gmail");
    expect(text).not.toContain("Disconnect Gmail");
    expect(text).not.toContain("Sync emails");
  });

  it("disconnected with data keeps the synced purchases visible", () => {
    const text = render(f.disconnectedWithData);
    expect(text).toContain("Gmail disconnected: your synced purchases are kept");
    expect(text).toContain("45");
    expect(text).toContain("Connect Gmail");
  });

  it("demo offers Leave demo and uploads do not", () => {
    expect(render(f.demo)).toContain("Leave demo");
    expect(render(f.demo)).toContain("Demo data");
    expect(render(f.leavingDemo)).toContain("Leaving demo");
    expect(render(f.upload)).toContain("Uploaded files");
    expect(render(f.upload)).not.toContain("Leave demo");
  });

  it("delete everything points to the Trust page where the typed confirmation lives", () => {
    const html = renderToStaticMarkup(createElement(AccountView, f.connected));
    expect(html).toMatch(/<a[^>]*href="\/trust"[^>]*>Delete everything<\/a>/);
    expect(html).toMatch(/<a[^>]*href="\/trust"[^>]*>Manage excluded stores<\/a>/);
  });
});
