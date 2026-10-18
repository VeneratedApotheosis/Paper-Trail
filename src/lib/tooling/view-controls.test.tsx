// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ClaimView } from "@/components/views/ClaimView";
import { claimViewFixture } from "@/components/views/fixtures/claim";
import { DeleteAllPanel, MerchantExcludePanel } from "@/components/DeleteAllPanel";
import { ReviewView } from "@/components/views/ReviewView";
import { reviewViewFixture } from "@/components/views/fixtures/review";

it("shows an email handoff only for a server-approved draft and server URL", () => {
  const unapproved = renderToStaticMarkup(<ClaimView {...claimViewFixture} mailtoUrl="mailto:server@example.test" />);
  expect(unapproved).not.toContain("Open in email");
  expect(unapproved).not.toContain("Approved and copied");
  const approved = renderToStaticMarkup(<ClaimView {...claimViewFixture} approved mailtoUrl="mailto:server@example.test" />);
  expect(approved).toContain('href="mailto:server@example.test"');
  expect(approved).toContain("Claim approved");
  expect(approved).not.toContain("Approved and copied");
  const failedCopy = renderToStaticMarkup(<ClaimView {...claimViewFixture} approved copyStatus="failed" />);
  expect(failedCopy).toContain("Approved, but not copied");
});

it("clicking Approve requests approval but never fabricates it locally", async () => {
  const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); const approve = vi.fn();
  try {
    await act(async () => root.render(<ClaimView {...claimViewFixture} onApprove={approve} />));
    const button = container.querySelector("button")!;
    await act(async () => button.click());
    expect(approve).toHaveBeenCalledWith(expect.objectContaining({ recipient: claimViewFixture.draft.recipient }));
    expect(container.querySelector('a[href^="mailto:"]')).toBeNull();
    expect(container.textContent).not.toContain("Approved and copied");
  } finally { await act(async () => root.unmount()); container.remove(); delete environment.IS_REACT_ACT_ENVIRONMENT; }
});

it.each([true, false])("deletion receipt reports actual revocation=%s and actual purge counts", revokedToken => {
  const html = renderToStaticMarkup(<DeleteAllPanel onDeleteAll={() => {}} deleteReceipt={{ at: "2026-10-17T12:00:00Z", revokedToken,
    purged: { orders: 17, findings: 6, drafts: 2, reviewItems: 1, audit: 34 } }} />);
  expect(html).toContain("17"); expect(html).toContain("34");
  expect(html).not.toContain("Simulated for the demo");
  expect(html).toContain(revokedToken ? "Gmail access was revoked" : "No successful Google revocation was reported");
});

it("renders pending/unsaved review state and unreadable items without claiming saves", () => {
  const first = reviewViewFixture.items[0];
  const html = renderToStaticMarkup(<ReviewView {...reviewViewFixture} pendingOrderId={first.id}
    notice="Checking your purchase" unreadableItems={[{ emailId: "synthetic-message", stage: "extract", reason: "Could not read fields" }]} />);
  expect(html).toContain("Saving changes"); expect(html).toContain("disabled");
  expect(html).toContain("Could not read fields"); expect(html).toContain("Checking your purchase");
  expect(html).not.toContain("stubbed");
  const merchant = renderToStaticMarkup(<MerchantExcludePanel merchants={["Synthetic Store"]} excludedMerchants={[]}
    pending error="Try again" onToggleMerchant={() => {}} />);
  expect(merchant).toContain("disabled"); expect(merchant).not.toContain("not saved yet");
});
