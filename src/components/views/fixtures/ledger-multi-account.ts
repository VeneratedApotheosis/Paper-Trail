import type { NormalizedOrder } from "@/lib/contracts";
import type { LedgerViewProps } from "@/components/views/LedgerView";
import { ledgerViewFixture } from "@/components/views/fixtures/ledger";

// Sample props for previewing the purchases list with linked Gmail accounts (issue #115): the three synthetic orders of
// the base ledger fixture, tagged with the account(s) they came from. Account ids are opaque; addresses use example.com.
export const ACCOUNT_WORK = "acct-work";
export const ACCOUNT_HOME = "acct-home";
export const ACCOUNT_OLD = "acct-old";

const sourcesByOrder: Record<string, string[] | undefined> = {
  o1: [ACCOUNT_WORK],
  o2: [ACCOUNT_HOME],
  o3: [ACCOUNT_WORK, ACCOUNT_HOME],
};

const taggedOrders: NormalizedOrder[] = ledgerViewFixture.orders.map((order) => ({ ...order, sources: sourcesByOrder[order.id] }));

/** Two accounts: one order from each inbox and one found in both. */
export const ledgerTwoAccountsFixture: LedgerViewProps = {
  ...ledgerViewFixture,
  orders: taggedOrders,
  accounts: [
    { id: ACCOUNT_WORK, mailbox: "work.shopper@example.com", connected: true },
    { id: ACCOUNT_HOME, mailbox: "home@example.com", connected: true },
  ],
};

/** One account: the badge shows, but there is nothing to filter. */
export const ledgerOneAccountFixture: LedgerViewProps = {
  ...ledgerViewFixture,
  orders: taggedOrders.map((order) => ({ ...order, sources: [ACCOUNT_WORK] })),
  accounts: [{ id: ACCOUNT_WORK, mailbox: "work.shopper@example.com", connected: true }],
};

/** Three accounts: one expired (address known) and one disconnected (no address, purchases kept). */
export const ledgerThreeAccountsFixture: LedgerViewProps = {
  ...ledgerTwoAccountsFixture,
  orders: ledgerTwoAccountsFixture.orders.map((order) => (order.id === "o2" ? { ...order, sources: [ACCOUNT_OLD] } : order)),
  accounts: [
    { id: ACCOUNT_WORK, mailbox: "work.shopper@example.com", connected: true },
    { id: ACCOUNT_HOME, mailbox: "home@example.com", connected: false },
    { id: ACCOUNT_OLD, mailbox: null, connected: false },
  ],
};