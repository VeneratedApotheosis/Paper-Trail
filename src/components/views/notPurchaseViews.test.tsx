// @vitest-environment jsdom
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orderDetailViewFixture } from "@/components/views/fixtures/order-detail";
import { reviewViewFixture } from "@/components/views/fixtures/review";
import { OrderDetailView, type OrderDetailViewProps } from "@/components/views/OrderDetailView";
import { ReviewView, type ReviewViewProps } from "@/components/views/ReviewView";

// The shell reads the account and ledger over the network; these tests are about the view only.
vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
// Vitest compiles .tsx with the classic JSX runtime, which needs a global React.
Object.assign(globalThis, { React });

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let cleanup: (() => Promise<void>) | undefined;
async function render(element: React.ReactElement) {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(element));
  cleanup = async () => { await act(async () => root.unmount()); container.remove(); delete environment.IS_REACT_ACT_ENVIRONMENT; };
  return container;
}
afterEach(async () => { await cleanup?.(); cleanup = undefined; });

const buttons = (container: HTMLElement, label: string) => [...container.querySelectorAll("button")].filter((candidate) => candidate.textContent?.trim() === label);
const click = (element: Element) => act(async () => { (element as HTMLElement).click(); });
const detail = (props: Partial<OrderDetailViewProps> = {}) => <OrderDetailView {...orderDetailViewFixture} {...props} />;

describe("OrderDetailView: Not a purchase", () => {
  it("has no feedback actions unless the page supplies callbacks", async () => {
    const container = await render(detail());
    expect(buttons(container, "Not a purchase")).toHaveLength(0);
    expect(buttons(container, "Not about this purchase")).toHaveLength(0);
  });

  it("asks to confirm, can be cancelled, and calls back once on confirm", async () => {
    const onMarkNotPurchase = vi.fn();
    const container = await render(detail({ onMarkNotPurchase }));
    await click(buttons(container, "Not a purchase")[0]);
    expect(onMarkNotPurchase).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Mark this as not a purchase?");
    expect(container.textContent).toContain("4 emails");

    await click(buttons(container, "Cancel")[0]);
    expect(container.textContent).not.toContain("Mark this as not a purchase?");
    expect(buttons(container, "Not a purchase")).toHaveLength(1);

    await click(buttons(container, "Not a purchase")[0]);
    await click(buttons(container, "Yes, not a purchase")[0]);
    expect(onMarkNotPurchase).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Mark this as not a purchase?");
  });

  it("shows only the Undo notice after the purchase was marked, and Undo calls back", async () => {
    const onRestore = vi.fn();
    const container = await render(detail({ onMarkNotPurchase: vi.fn(), onRestore, feedback: { pending: false, error: null, notice: "purchase" } }));
    expect(container.textContent).toContain("Marked as not a purchase");
    expect(container.textContent).not.toContain("Merino crew sweater");
    await click(buttons(container, "Undo")[0]);
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it("offers Not about this purchase on each timeline email (several-email orders), passing the email id", async () => {
    const onMarkEmailNotAboutOrder = vi.fn();
    const container = await render(detail({ onMarkEmailNotAboutOrder }));
    const rows = buttons(container, "Not about this purchase");
    expect(rows).toHaveLength(3);
    await click(rows[1]);
    expect(onMarkEmailNotAboutOrder).toHaveBeenCalledWith("msg_rv_3");

    const single = await render(detail({ onMarkEmailNotAboutOrder, order: { ...orderDetailViewFixture.order, messageIds: ["msg_rv_1"] } }));
    expect(buttons(single, "Not about this purchase")).toHaveLength(0);
  });

  it("keeps the order visible with an email notice, disables actions while pending, and reports errors", async () => {
    const container = await render(detail({ onMarkEmailNotAboutOrder: vi.fn(), onRestore: vi.fn(), onMarkNotPurchase: vi.fn(),
      feedback: { pending: true, error: "Nothing to undo", notice: "email" } }));
    expect(container.textContent).toContain("That email no longer counts toward this purchase.");
    expect(container.textContent).toContain("Merino crew sweater");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Nothing to undo");
    expect(buttons(container, "Undo")[0].disabled).toBe(true);
    expect(buttons(container, "Not about this purchase")[0].disabled).toBe(true);
  });
});

describe("ReviewView: Not a purchase", () => {
  const review = (props: Partial<ReviewViewProps> = {}) => <ReviewView {...reviewViewFixture} {...props} />;

  it("is hidden without the callback", async () => {
    expect(buttons(await render(review()), "Not a purchase")).toHaveLength(0);
  });

  it("confirms first, then reports the order id of the card", async () => {
    const onNotPurchase = vi.fn();
    const container = await render(review({ onNotPurchase }));
    const cards = buttons(container, "Not a purchase");
    expect(cards).toHaveLength(reviewViewFixture.items.length);
    await click(cards[1]);
    expect(onNotPurchase).not.toHaveBeenCalled();
    await click(buttons(container, "Yes, not a purchase")[0]);
    expect(onNotPurchase).toHaveBeenCalledWith(reviewViewFixture.items[1].id);
  });
});
