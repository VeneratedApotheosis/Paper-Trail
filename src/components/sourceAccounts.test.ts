import { describe, expect, it } from "vitest";
import type { NormalizedOrder } from "@/lib/contracts";
import {
  accountFilterOptions,
  accountLabels,
  filterOrdersByAccount,
  mailboxShortLabel,
  orderSources,
  sourceBadgeSummary,
  type SourceAccount,
} from "./sourceAccounts";

const work: SourceAccount = { id: "a-work", mailbox: "work.shopper@example.com", connected: true };
const home: SourceAccount = { id: "a-home", mailbox: "home@mail.example.org", connected: true };
const gone: SourceAccount = { id: "a-gone", mailbox: null, connected: false };

const order = (id: string, sources?: string[]) => ({ id, sources }) as NormalizedOrder;

describe("mailboxShortLabel", () => {
  it("is the local part plus the domain's first letter", () => {
    expect(mailboxShortLabel("home@mail.example.org")).toBe("home@m");
    expect(mailboxShortLabel("shopper@example.com")).toBe("shopper@e");
  });

  it("cuts a long local part with an ellipsis", () => {
    expect(mailboxShortLabel("a.very.long.name.indeed@example.com")).toBe("a.very.long\u2026@e");
  });

  it("copes with a value that is not an address", () => {
    expect(mailboxShortLabel("shopper")).toBe("shopper");
    expect(mailboxShortLabel("a-rather-long-name")).toBe("a-rather-lo\u2026");
  });
});

describe("accountLabels", () => {
  it("uses the mailbox, or a plain stand-in without one", () => {
    const labels = accountLabels([work, gone]);
    expect(labels.get("a-work")).toBe("work.shopper@example.com");
    expect(labels.get("a-gone")).toBe("Disconnected account");
  });

  it("calls a connected account with an unknown address a Gmail account", () => {
    expect(accountLabels([{ id: "x", mailbox: null, connected: true }]).get("x")).toBe("Gmail account");
  });

  it("numbers identical stand-ins so the filter never lists two equal entries", () => {
    const labels = accountLabels([gone, work, { id: "a-gone2", mailbox: null, connected: false }]);
    expect(labels.get("a-gone")).toBe("Disconnected account 1");
    expect(labels.get("a-gone2")).toBe("Disconnected account 2");
  });
});

describe("orderSources", () => {
  it("maps source ids to the linked accounts, in the order's own order", () => {
    expect(orderSources(["a-home", "a-work"], [work, home])).toEqual([
      { id: "a-home", label: "home@mail.example.org", short: "home@m" },
      { id: "a-work", label: "work.shopper@example.com", short: "work.shopper@e" },
    ]);
  });

  it("shows a disconnected account by its stand-in name", () => {
    expect(orderSources(["a-gone"], [work, gone])).toEqual([{ id: "a-gone", label: "Disconnected account", short: "Disconnected account" }]);
  });

  it("is empty for demo or uploaded purchases (no sources) and for unknown ids", () => {
    expect(orderSources(undefined, [work])).toEqual([]);
    expect(orderSources([], [work])).toEqual([]);
    expect(orderSources(["nope"], [work])).toEqual([]);
    expect(orderSources(["a-work"], [])).toEqual([]);
  });
});

describe("sourceBadgeSummary", () => {
  const [one] = orderSources(["a-work"], [work]);
  const two = orderSources(["a-work", "a-home"], [work, home]);

  it("is null with nothing to show", () => {
    expect(sourceBadgeSummary([])).toBeNull();
  });

  it("shows one source short, with the full address in the tip and 'From <mailbox>' for screen readers", () => {
    expect(sourceBadgeSummary([one])).toEqual({
      text: "work.shopper@e",
      title: "work.shopper@example.com",
      accessibleText: "From work.shopper@example.com",
    });
  });

  it("shows both sources of a merged order", () => {
    expect(sourceBadgeSummary(two)).toEqual({
      text: "work.shopper@e + home@m",
      title: "work.shopper@example.com, home@mail.example.org",
      accessibleText: "From work.shopper@example.com and home@mail.example.org",
    });
  });

  it("collapses three or more into a count, keeping the list in the tip", () => {
    const three = orderSources(["a-work", "a-home", "a-gone"], [work, home, gone]);
    expect(sourceBadgeSummary(three)).toMatchObject({ text: "3 accounts", title: expect.stringContaining("Disconnected account") });
  });

  it("writes the whole address on detail screens", () => {
    expect(sourceBadgeSummary(two, true)?.text).toBe("From work.shopper@example.com and home@mail.example.org");
  });
});

describe("account filter", () => {
  const orders = [order("1", ["a-work"]), order("2", ["a-home"]), order("3", ["a-work", "a-home"]), order("4")];

  it("keeps every order for 'all accounts'", () => {
    expect(filterOrdersByAccount(orders, null)).toHaveLength(4);
  });

  it("keeps the orders an account contributed to, merged ones included", () => {
    expect(filterOrdersByAccount(orders, "a-work").map((o) => o.id)).toEqual(["1", "3"]);
    expect(filterOrdersByAccount(orders, "a-home").map((o) => o.id)).toEqual(["2", "3"]);
  });

  it("drops orders without sources once an account is chosen", () => {
    expect(filterOrdersByAccount(orders, "a-gone")).toEqual([]);
  });

  it("offers one option per account with counts, only from two accounts on", () => {
    expect(accountFilterOptions(orders, [work, home])).toEqual([
      { value: "a-work", label: "work.shopper@example.com", count: 2 },
      { value: "a-home", label: "home@mail.example.org", count: 2 },
    ]);
    expect(accountFilterOptions(orders, [work])).toEqual([]);
    expect(accountFilterOptions(orders, [])).toEqual([]);
  });

  it("lists a disconnected account too, since its purchases are kept", () => {
    expect(accountFilterOptions(orders, [work, gone]).map((o) => o.label)).toEqual(["work.shopper@example.com", "Disconnected account"]);
  });
});
