// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promotionsFixture, promotionsViewFixture } from "./fixtures/promotions";
import { PromotionsView, type PromotionsViewProps } from "./PromotionsView";

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

beforeEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.useRealTimers();
  delete environment.IS_REACT_ACT_ENVIRONMENT;
});

async function render(props: Partial<PromotionsViewProps> = {}) {
  await act(async () => root.render(<PromotionsView {...promotionsViewFixture} {...props} />));
}
const buttonWithText = (text: string) => [...container.querySelectorAll("button")].find((button) => button.textContent?.trim() === text)!;
const cards = () => [...container.querySelectorAll("article")];

describe("PromotionsView", () => {
  it("renders one card per offer in the given order, with store, offer, expiry, channel and the reader", async () => {
    await render();
    expect(cards()).toHaveLength(3);
    const first = cards()[0].textContent ?? "";
    expect(first).toContain("Lumen Beauty");
    expect(first).toContain("$10 off a $40 pickup order");
    expect(first).toContain("Ends tonight"); // urgent: under 24 hours
    expect(first).toContain("In store");
    expect(first).toContain("Details read by rules");
    expect(cards()[1].textContent).toContain("4 days left");
    expect(cards()[1].textContent).toContain("Details read by Claude");
    expect(cards()[2].textContent).toContain("No end date");
    expect(container.querySelector("h1")?.textContent).toBe("Promotions");
    expect(container.textContent).toContain("never counted in what you");
    expect(container.textContent).toContain("3 offers");
  });

  it("shows several copyable codes and copies one through the callback, with a Copied confirmation", async () => {
    const onCopyCode = vi.fn(async () => undefined);
    await render({ onCopyCode });
    const codes = [...container.querySelectorAll("ul[aria-label='Promo codes'] code")].map((code) => code.textContent);
    expect(codes).toEqual(["FALL20", "FALLEXTRA"]);
    const copy = container.querySelector<HTMLButtonElement>("button[aria-label='Copy code FALL20']")!;
    await act(async () => copy.click());
    expect(onCopyCode).toHaveBeenCalledWith("FALL20");
    expect(copy.textContent).toBe("Copied");
    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(copy.textContent).toBe("Copy");
  });

  it("tells the user when the clipboard refuses", async () => {
    await render({ onCopyCode: async () => { throw new Error("denied"); } });
    await act(async () => container.querySelector<HTMLButtonElement>("button[aria-label='Copy code FALL20']")!.click());
    expect(container.querySelector("[role=status]:not(:empty)")?.textContent).toContain("Couldn't copy");
  });

  it("filters by channel (both counts for each) and explains an empty result", async () => {
    await render({ promotions: promotionsFixture, showExpired: true, expiredHidden: 0 });
    expect(cards()).toHaveLength(4);
    await act(async () => buttonWithText("Online").click());
    expect(cards().map((card) => card.getAttribute("aria-label"))).toEqual([
      "Northwind Outfitters: 20% off everything", "Lumen Beauty: 15% off your next order",
    ]);
    await act(async () => buttonWithText("In store").click());
    expect(cards()).toHaveLength(2); // the in-store offer and the "both" offer
    await render({ promotions: [promotionsFixture[1]] });
    expect(buttonWithText("In store")).toBeDefined();
    await act(async () => buttonWithText("In store").click());
    expect(container.textContent).toContain("No matching promotions");
  });

  it("offers the expired toggle with a count and calls back", async () => {
    const onShowExpiredChange = vi.fn();
    await render({ onShowExpiredChange });
    await act(async () => buttonWithText("Show expired (1)").click());
    expect(onShowExpiredChange).toHaveBeenCalledWith(true);
    await render({ showExpired: true, expiredHidden: 0, promotions: promotionsFixture });
    expect(buttonWithText("Hide expired")).toBeDefined();
    const expired = cards().find((card) => card.textContent?.includes("Expired Oct 10"))!;
    expect(expired.className).toContain("opacity-70");
  });

  it("shows the empty state when nothing was found, and the note while Claude is reading", async () => {
    await render({ promotions: [], expiredHidden: 0 });
    expect(container.textContent).toContain("No active promotions");
    expect(container.querySelectorAll("article")).toHaveLength(0);
    await render({ enriching: true });
    expect(container.textContent).toContain("Claude is still reading");
  });

  it("filters by store with the shared searchable select", async () => {
    await render({ promotions: promotionsFixture, showExpired: true, expiredHidden: 0 });
    const store = [...container.querySelectorAll<HTMLButtonElement>("button[aria-haspopup=listbox]")][0];
    await act(async () => store.click());
    const option = [...document.querySelectorAll<HTMLElement>("[role=option]")].find((item) => item.textContent?.startsWith("Northwind"))!;
    await act(async () => option.click());
    expect(cards()).toHaveLength(1);
    expect(cards()[0].textContent).toContain("Northwind Outfitters");
  });

  it("adds an Account filter and a mailbox badge with two linked accounts", async () => {
    const accounts = [{ id: "a1", mailbox: "sam@example.test", connected: true }, { id: "a2", mailbox: "pat@example.test", connected: true }];
    const promotions = promotionsFixture.slice(0, 2).map((promotion, index) => ({ ...promotion, accountId: accounts[index].id }));
    await render({ promotions, accounts });
    expect(container.querySelectorAll("button[aria-haspopup=listbox]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-testid=source-badge]")).toHaveLength(2);
    expect(container.textContent).toContain("From sam@example.test");
  });
});