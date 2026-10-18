import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AccountView } from "@/components/views/AccountView";
import { accountViewFixtures as f } from "@/components/views/fixtures/account";

vi.mock("next/navigation", () => ({ usePathname: () => "/account" }));
// Vitest compiles .tsx with the classic JSX runtime, which needs a global React.
Object.assign(globalThis, { React });

const html = (props: Parameters<typeof AccountView>[0]) => renderToStaticMarkup(<AccountView {...props} />);

describe("AccountView two-column layout (#142)", () => {
  it("marks the page wide and keeps the right rail with the delete card", () => {
    const out = html(f.accountsTwo);
    expect(out).toContain('data-layout="wide"');
    expect(out).toContain("Recent syncs");
    expect(out).toContain("What Gmail access allows");
    expect(out).toContain("Delete everything");
  });

  it("an expired or disconnected account offers Reconnect, never Sync", () => {
    const out = html(f.accountsThree);
    expect(out).toContain('aria-label="Reconnect home@example.com"');
    expect(out).toContain('aria-label="Reconnect Disconnected account"');
    expect(out).not.toContain("Sync this account: home@example.com");
    expect(out).not.toContain("Sync this account: Disconnected account");
  });

  it("how connecting works only shows before any mailbox was linked", () => {
    expect(html(f.demo)).toContain("When you connect your inbox");
    expect(html(f.disconnectedWithData)).not.toContain("When you connect your inbox");
    expect(html(f.accountsTwo)).not.toContain("When you connect your inbox");
  });

  it("recent syncs is left out when nothing was synced", () => {
    expect(html(f.demo)).not.toContain("Recent syncs");
  });
});