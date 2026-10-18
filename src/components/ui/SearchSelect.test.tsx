// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LedgerView } from "@/components/views/LedgerView";
import { ledgerManyStoresFixture, manyStoreNames } from "@/components/views/fixtures/ledger-many-stores";

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/OrderCard", () => ({
  OrderCard: ({ order }: { order: { merchant: { name: string } } }) => <article data-testid="order">{order.merchant.name}</article>,
}));

beforeEach(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  delete environment.IS_REACT_ACT_ENVIRONMENT;
});

function press(element: Element, key: string) {
  return act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

function typeInto(input: HTMLInputElement, text: string) {
  return act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const orderCount = () => container.querySelectorAll("[data-testid=order]").length;
const storeButton = () => container.querySelector<HTMLButtonElement>("button[aria-haspopup=listbox]")!;
const searchBox = () => document.querySelector<HTMLInputElement>("input[role=combobox]")!;
const options = () => [...document.querySelectorAll("[role=option]")];

it("filters purchases with the searchable store dropdown by keyboard and combines with status", async () => {
  await act(async () => root.render(<LedgerView {...ledgerManyStoresFixture} />));
  const total = ledgerManyStoresFixture.orders.length;
  expect(orderCount()).toBe(total);
  expect(storeButton().textContent).toContain("All stores");
  expect(container.querySelector("[aria-label='Filter by merchant']")).toBeNull();

  await act(async () => storeButton().click());
  expect(storeButton().getAttribute("aria-expanded")).toBe("true");
  expect(options()).toHaveLength(manyStoreNames.length + 1);
  expect(options()[0].textContent).toContain("All stores");
  expect(document.activeElement).toBe(searchBox());

  await typeInto(searchBox(), "CEDAR GOODS");
  expect(options().map((o) => o.textContent)).toEqual(["Cedar Goods2"]);
  await press(searchBox(), "Enter");
  expect(storeButton().getAttribute("aria-expanded")).toBe("false");
  expect(storeButton().textContent).toContain("Cedar Goods");
  expect(document.activeElement).toBe(storeButton());
  expect(orderCount()).toBe(2);

  // Combine with a status pill: only the delivered purchases of that store remain.
  const delivered = [...container.querySelectorAll("button[aria-pressed]")].find((b) => b.textContent === "Delivered")!;
  await act(async () => (delivered as HTMLElement).click());
  expect(orderCount()).toBeLessThan(2);

  await act(async () => storeButton().click());
  await typeInto(searchBox(), "no such store");
  expect(options()).toHaveLength(0);
  expect(document.body.textContent).toContain("No stores match");
  await press(searchBox(), "Escape");
  expect(storeButton().getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(storeButton());
});

it("moves with arrow keys, closes on Tab and on an outside press", async () => {
  await act(async () => root.render(<LedgerView {...ledgerManyStoresFixture} />));
  await act(async () => storeButton().click());
  await press(searchBox(), "ArrowDown");
  await press(searchBox(), "ArrowDown");
  const active = options()[2];
  expect(searchBox().getAttribute("aria-activedescendant")).toBe(active.id);
  await press(searchBox(), "ArrowUp");
  expect(searchBox().getAttribute("aria-activedescendant")).toBe(options()[1].id);
  await press(searchBox(), "Enter");
  expect(orderCount()).toBeGreaterThan(0);
  expect(orderCount()).toBeLessThan(ledgerManyStoresFixture.orders.length);

  await act(async () => storeButton().click());
  await press(searchBox(), "Tab");
  expect(storeButton().getAttribute("aria-expanded")).toBe("false");

  await act(async () => storeButton().click());
  await act(async () => {
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
  expect(storeButton().getAttribute("aria-expanded")).toBe("false");
});