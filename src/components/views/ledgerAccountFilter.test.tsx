// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LedgerView } from "@/components/views/LedgerView";
import {
  ledgerOneAccountFixture,
  ledgerThreeAccountsFixture,
  ledgerTwoAccountsFixture,
} from "@/components/views/fixtures/ledger-multi-account";
import { ledgerViewFixture } from "@/components/views/fixtures/ledger";
import { filterOrdersByAccount } from "@/components/sourceAccounts";
import { deriveOrderStatus } from "@/lib/view";

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
let container: HTMLDivElement;
let root: Root;

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));

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

const selects = () => [...container.querySelectorAll<HTMLButtonElement>("button[aria-haspopup=listbox]")];
const accountSelect = () =>
  selects().find((button) => document.getElementById(button.getAttribute("aria-labelledby")!.split(" ")[0])?.textContent === "Account");
const cards = () => [...container.querySelectorAll("button.neu-raised")].map((card) => card.textContent ?? "");
const option = (label: string) => [...document.querySelectorAll<HTMLElement>("[role=option]")].find((item) => item.textContent?.startsWith(label))!;

describe("LedgerView Account filter", () => {
  it("is hidden with one account or none (demo and uploaded data)", async () => {
    await act(async () => root.render(<LedgerView {...ledgerOneAccountFixture} />));
    expect(selects()).toHaveLength(1);
    await act(async () => root.render(<LedgerView {...ledgerViewFixture} />));
    expect(selects()).toHaveLength(1);
    expect(container.textContent).not.toContain("All accounts");
  });

  it("appears with two accounts, lists each mailbox with its count and filters the purchases", async () => {
    await act(async () => root.render(<LedgerView {...ledgerTwoAccountsFixture} />));
    expect(selects()).toHaveLength(2);
    expect(cards()).toHaveLength(3);
    expect(accountSelect()?.textContent).toContain("All accounts");

    await act(async () => accountSelect()!.click());
    const labels = [...document.querySelectorAll("[role=option]")].map((item) => item.textContent);
    expect(labels).toEqual(["All accounts3", "work.shopper@example.com2", "home@example.com2"]);

    await act(async () => option("home@example.com").click());
    expect(accountSelect()?.textContent).toContain("home@example.com");
    // Order 2 came from the home inbox only, order 3 from both inboxes.
    expect(cards()).toHaveLength(2);
    expect(cards().join(" ")).not.toContain("Rowan and Vale");

    await act(async () => accountSelect()!.click());
    await act(async () => option("All accounts").click());
    expect(cards()).toHaveLength(3);
  });

  it("combines with the status filter", async () => {
    await act(async () => root.render(<LedgerView {...ledgerTwoAccountsFixture} />));
    await act(async () => accountSelect()!.click());
    await act(async () => option("work.shopper@example.com").click());
    expect(cards()).toHaveLength(2);
    const workOrders = filterOrdersByAccount(ledgerTwoAccountsFixture.orders, "acct-work");
    const status = deriveOrderStatus(workOrders[0]);
    const pill = [...container.querySelectorAll<HTMLButtonElement>("[aria-label='Filter by status'] button")].find(
      (candidate) => candidate.textContent?.toLowerCase() === status,
    )!;
    await act(async () => pill.click());
    expect(cards()).toHaveLength(workOrders.filter((order) => deriveOrderStatus(order) === status).length);
  });

  it("lists a disconnected account, whose purchases are kept", async () => {
    await act(async () => root.render(<LedgerView {...ledgerThreeAccountsFixture} />));
    await act(async () => accountSelect()!.click());
    expect([...document.querySelectorAll("[role=option]")].map((item) => item.textContent)).toContain("Disconnected account1");
    await act(async () => option("Disconnected account").click());
    expect(cards()).toHaveLength(1);
  });

  it("shows the source badge on each purchase card", async () => {
    await act(async () => root.render(<LedgerView {...ledgerTwoAccountsFixture} />));
    const badges = [...container.querySelectorAll("[data-testid=source-badge]")].map((badge) => badge.getAttribute("title"));
    // Newest purchase first; every order carries its own sources.
    expect([...badges].sort()).toEqual(["home@example.com", "work.shopper@example.com", "work.shopper@example.com, home@example.com"]);
  });
});
