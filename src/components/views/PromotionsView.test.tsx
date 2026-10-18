// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  promotionsEmptyFixture, promotionsExpiredShownFixture, promotionsFixture, promotionsLoadingFixture, promotionsViewFixture,
} from "./fixtures/promotions";
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
const clean = (text: string | null) => (text ?? "").replace(/\u00a0/g, " ").trim();
const buttonWithText = (text: string) => [...container.querySelectorAll("button")].find((button) => clean(button.textContent) === text)!;
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
    expect(first).toContain("Read by rules");
    expect(cards()[1].textContent).toContain("4 days left");
    expect(cards()[1].textContent).toContain("Read by Claude");
    expect(cards()[2].textContent).toContain("No end date");
    expect(container.querySelector("h1")?.textContent).toBe("Promotions");
    expect(container.textContent).toContain("They are not counted in what you are owed.");
    expect(container.textContent).toContain("3 active");
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

  it("says what an offer without a code needs, and never offers to copy an expired code", async () => {
    await render({ promotions: [promotionsFixture[2]] });
    expect(container.textContent).toContain("No code needed. Applied at checkout.");
    await render({ promotions: [promotionsFixture[3]], showExpired: true, expiredHidden: 0 });
    expect(container.querySelector("button[aria-label='Copy code WELCOME15']")).toBeNull();
    expect(container.querySelector("ul[aria-label='Promo codes'] code")?.textContent).toBe("WELCOME15");
  });

  it("filters by channel (both counts for each), shows the counts, and explains an empty result", async () => {
    await render({ promotions: promotionsFixture, showExpired: true, expiredHidden: 0 });
    expect(cards()).toHaveLength(4);
    expect(["All 4", "Online 2", "In store 2"].map((label) => buttonWithText(label))).not.toContain(undefined);
    await act(async () => buttonWithText("Online 2").click());
    expect(cards().map((card) => card.getAttribute("aria-label"))).toEqual([
      "Northwind Outfitters: 20% off everything", "Lumen Beauty: 15% off your next order",
    ]);
    await act(async () => buttonWithText("In store 2").click());
    expect(cards()).toHaveLength(2); // the in-store offer and the "both" offer
    await render({ promotions: [promotionsFixture[1]] });
    await act(async () => buttonWithText("In store 0").click());
    expect(container.textContent).toContain("No matching promotions");
    await act(async () => buttonWithText("Clear filters").click());
    expect(cards()).toHaveLength(1);
  });

  it("has a Show expired switch that calls back", async () => {
    const onShowExpiredChange = vi.fn();
    await render({ onShowExpiredChange });
    const toggle = container.querySelector<HTMLButtonElement>("button[role=switch]")!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.textContent).toContain("Show expired");
    await act(async () => toggle.click());
    expect(onShowExpiredChange).toHaveBeenCalledWith(true);
    await render({ showExpired: true, expiredHidden: 0, promotions: promotionsFixture });
    expect(container.querySelector("button[role=switch]")?.getAttribute("aria-checked")).toBe("true");
  });

  it("lists ended offers after the active ones under an Expired heading, dimmed", async () => {
    await render(promotionsExpiredShownFixture);
    const labels = cards().map((card) => card.getAttribute("aria-label")?.split(":")[0]);
    expect(labels.slice(-2)).toEqual(["Grandmart", "Bazaarly"]);
    expect(container.textContent).toContain("Expired2 ended offers");
    expect(container.textContent).toContain("7 shown");
    const ended = cards().find((card) => card.textContent?.includes("Ended Oct 15"))!;
    expect(ended.className).toContain("opacity-80");
    expect(ended.querySelector("button[aria-label='Copy code GRAND10']")).toBeNull();
    expect(ended.textContent).toContain("Expired");
    expect(cards().find((card) => card.textContent?.includes("Ended Oct 12"))?.textContent).toContain("No code was needed");
  });

  it("shows the empty state with a Sync inbox button, and a way to the hidden expired offers", async () => {
    const onSyncInbox = vi.fn();
    const onShowExpiredChange = vi.fn();
    await render({ ...promotionsEmptyFixture, onSyncInbox, onShowExpiredChange });
    expect(container.textContent).toContain("No active promotions");
    expect(container.querySelectorAll("article")).toHaveLength(0);
    expect(container.textContent).toContain("0 active");
    await act(async () => buttonWithText("Sync inbox").click());
    expect(onSyncInbox).toHaveBeenCalled();
    await act(async () => buttonWithText("Show expired offers").click());
    expect(onShowExpiredChange).toHaveBeenCalledWith(true);
    await render({ ...promotionsEmptyFixture, onSyncInbox: undefined, expiredHidden: 0 });
    expect(container.textContent).not.toContain("Sync inbox");
    expect(container.textContent).not.toContain("Show expired offers");
  });

  it("shows placeholders while loading and a note while Claude is reading", async () => {
    await render(promotionsLoadingFixture);
    expect(container.textContent).toContain("Reading your inbox for offers");
    expect(container.textContent).toContain("Loading");
    expect(container.querySelectorAll("article")).toHaveLength(0);
    await render({ enriching: true });
    expect(container.textContent).toContain("Claude is still reading");
  });

  it("filters by store with the shared searchable select and can clear it", async () => {
    await render({ promotions: promotionsFixture, showExpired: true, expiredHidden: 0 });
    const store = [...container.querySelectorAll<HTMLButtonElement>("button[aria-haspopup=listbox]")][0];
    await act(async () => store.click());
    const option = [...document.querySelectorAll<HTMLElement>("[role=option]")].find((item) => item.textContent?.startsWith("Northwind"))!;
    await act(async () => option.click());
    expect(cards()).toHaveLength(1);
    expect(cards()[0].textContent).toContain("Northwind Outfitters");
    expect(container.textContent).toContain("Showing offers from Northwind Outfitters");
    expect(container.textContent).toContain("1 of 4 shown");
    await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === "Clear filter")!.click());
    expect(cards()).toHaveLength(4);
  });

  it("has a right rail with what ends soonest and offers per store; picking a store filters", async () => {
    await render({ promotions: promotionsFixture, showExpired: true, expiredHidden: 0 });
    const rail = container.querySelector("aside[aria-label='Promotion summary']")!;
    expect(rail.textContent).toContain("Ending soon");
    expect(rail.textContent).toContain("Tonight");
    expect(rail.textContent).toContain("Promotions are not counted in what you are owed.");
    expect(rail.textContent).toContain("PaperTrail never sends email.");
    const pick = [...rail.querySelectorAll("section[aria-label='By store'] button")].find((button) => button.textContent?.startsWith("Northwind"))!;
    await act(async () => (pick as HTMLButtonElement).click());
    expect(cards()).toHaveLength(1);
    expect(pick.getAttribute("aria-pressed")).toBe("true");
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