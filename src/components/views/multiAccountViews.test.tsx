import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FindingCard } from "@/components/FindingCard";
import { OrderCard } from "@/components/OrderCard";
import { orderSources } from "@/components/sourceAccounts";
import { ClaimView } from "@/components/views/ClaimView";
import { claimViewFixture } from "@/components/views/fixtures/claim";
import { ACCOUNT_HOME, ACCOUNT_WORK, ledgerThreeAccountsFixture, ledgerTwoAccountsFixture } from "@/components/views/fixtures/ledger-multi-account";
import { orderDetailViewFixture } from "@/components/views/fixtures/order-detail";
import { owedViewFixture } from "@/components/views/fixtures/owed";
import { OrderDetailView } from "@/components/views/OrderDetailView";
import { OwedView } from "@/components/views/OwedView";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
// Vitest compiles .tsx with the classic JSX runtime, which needs a global React.
Object.assign(globalThis, { React });

const accounts = ledgerTwoAccountsFixture.accounts!;
const noop = () => {};
const [workOnly, , bothInboxes] = ledgerTwoAccountsFixture.orders;

/** Visible text only, entities decoded. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const badges = (html: string) => [...html.matchAll(/<span[^>]*data-testid="source-badge"[^>]*>/g)].map((match) => match[0]);

describe("source badge on Purchases list items (OrderCard)", () => {
  it("shows the short mailbox, the full address in the tip and 'From <mailbox>' for screen readers", () => {
    const html = renderToStaticMarkup(<OrderCard order={workOnly} sources={orderSources(workOnly.sources, accounts)} onOpen={noop} />);
    expect(badges(html)).toHaveLength(1);
    expect(badges(html)[0]).toContain('title="work.shopper@example.com"');
    expect(text(html)).toContain("work.shopper@e");
    expect(text(html)).toContain("From work.shopper@example.com");
  });

  it("shows both sources of an order found in two inboxes", () => {
    const html = renderToStaticMarkup(<OrderCard order={bothInboxes} sources={orderSources(bothInboxes.sources, accounts)} onOpen={noop} />);
    expect(badges(html)).toHaveLength(1);
    expect(badges(html)[0]).toContain('title="work.shopper@example.com, home@example.com"');
    expect(text(html)).toContain("work.shopper@e + home@e");
    expect(text(html)).toContain("From work.shopper@example.com and home@example.com");
  });

  it("shows nothing for demo or uploaded purchases (no sources)", () => {
    const html = renderToStaticMarkup(<OrderCard order={{ ...workOnly, sources: undefined }} sources={orderSources(undefined, accounts)} onOpen={noop} />);
    expect(badges(html)).toHaveLength(0);
    expect(renderToStaticMarkup(<OrderCard order={workOnly} onOpen={noop} />)).not.toContain("source-badge");
  });
});

describe("source badge on finding cards", () => {
  const item = owedViewFixture.owedItems[0];

  it("shows the order's mailbox", () => {
    const html = renderToStaticMarkup(
      <FindingCard {...item} simulatedLabel="Simulated price feed" sources={orderSources([ACCOUNT_HOME], accounts)} onDraftClaim={noop} />,
    );
    expect(text(html)).toContain("home@e");
    expect(badges(html)[0]).toContain('title="home@example.com"');
  });

  it("shows nothing without sources, and OwedView passes the item's sources down", () => {
    expect(renderToStaticMarkup(<FindingCard {...item} simulatedLabel="x" onDraftClaim={noop} />)).not.toContain("source-badge");
    const html = renderToStaticMarkup(
      <OwedView {...owedViewFixture} owedItems={[{ ...item, sources: orderSources([ACCOUNT_WORK], accounts) }]} onOpenClaim={noop} />,
    );
    expect(badges(html)).toHaveLength(1);
    expect(text(html)).toContain("work.shopper@e");
  });
});

describe("source badge on order detail and the claim page", () => {
  it("order detail writes the whole address, for every source of a merged order", () => {
    const order = { ...orderDetailViewFixture.order, sources: [ACCOUNT_WORK, ACCOUNT_HOME] };
    const html = renderToStaticMarkup(<OrderDetailView {...orderDetailViewFixture} order={order} accounts={accounts} />);
    expect(text(html)).toContain("From work.shopper@example.com and home@example.com");
    expect(badges(html)).toHaveLength(1);
  });

  it("order detail shows a disconnected account by name and nothing for demo orders", () => {
    const order = { ...orderDetailViewFixture.order, sources: ["acct-old"] };
    const gone = ledgerThreeAccountsFixture.accounts!;
    expect(text(renderToStaticMarkup(<OrderDetailView {...orderDetailViewFixture} order={order} accounts={gone} />))).toContain("From Disconnected account");
    expect(renderToStaticMarkup(<OrderDetailView {...orderDetailViewFixture} accounts={accounts} />)).not.toContain("source-badge");
  });

  it("the claim page names the mailbox the purchase came from", () => {
    const order = { ...claimViewFixture.order, sources: [ACCOUNT_HOME] };
    const html = renderToStaticMarkup(<ClaimView {...claimViewFixture} order={order} accounts={accounts} />);
    expect(text(html)).toContain("From home@example.com");
    expect(renderToStaticMarkup(<ClaimView {...claimViewFixture} accounts={accounts} />)).not.toContain("source-badge");
  });
});
