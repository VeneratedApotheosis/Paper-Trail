"use client";

import { type ReactNode, useMemo, useState } from "react";
import type { NormalizedOrder } from "@/lib/contracts";
import { AppShell } from "@/components/AppShell";
import { OrderCard } from "@/components/OrderCard";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { accountFilterOptions, filterOrdersByAccount, orderSources, type SourceAccount } from "@/components/sourceAccounts";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/SearchSelect";
import { deriveOrderStatus, type OrderDisplayStatus } from "@/lib/view";
import { formatMoney } from "@/lib/format";
import { groupByMonth, matchesQuery, spendByStore } from "@/components/ledgerGroups";

const ALL = "all" as const;

// Canonical lifecycle order so status pills never reorder across renders/data.
const STATUS_ORDER: OrderDisplayStatus[] = [
  "ordered",
  "shipped",
  "delivered",
  "return in progress",
  "returned",
  "refunded",
  "cancelled",
];

// Props-only view for the purchases list. All orders arrive as props (typed via
// @/lib/contracts) and opening an order is a callback, so the page wrapper owns
// data + navigation. No fetch, no @/lib/api, no routing in here.
export interface LedgerViewProps {
  orders: NormalizedOrder[];
  // Linked Gmail accounts (issue #115): purchases show the mailbox they came from, and with two or more accounts an
  // Account filter appears. Omit for demo and uploaded data.
  accounts?: SourceAccount[];
  onOpenOrder: (id: string) => void;
  onLoadDemo?: () => void;
}

export function LedgerView({ orders, accounts, onOpenOrder, onLoadDemo }: LedgerViewProps) {
  const [merchant, setMerchant] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(ALL);
  const [query, setQuery] = useState("");

  // Reverse-chronological: newest order first.
  const sorted = useMemo(
    () =>
      [...orders].sort(
        (a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime(),
      ),
    [orders],
  );

  // One option per store with its purchase count, A to Z.
  const merchantOptions = useMemo<SearchSelectOption[]>(() => {
    const counts = new Map<string, number>();
    for (const o of sorted) counts.set(o.merchant.name, (counts.get(o.merchant.name) ?? 0) + 1);
    return [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ value: name, label: name, count }));
  }, [sorted]);
  // A refreshed ledger may drop the chosen store; fall back to all stores instead of an empty list.
  const activeMerchant = merchantOptions.some((o) => o.value === merchant) ? merchant : null;
  const linkedAccounts = useMemo(() => accounts ?? [], [accounts]);
  // Only with two or more accounts; a refreshed account list may drop the chosen one.
  const accountOptions = useMemo(() => accountFilterOptions(sorted, linkedAccounts), [sorted, linkedAccounts]);
  const activeAccount = accountOptions.some((o) => o.value === account) ? account : null;
  const statuses = useMemo(() => {
    const present = new Set(sorted.map((o) => deriveOrderStatus(o)));
    return STATUS_ORDER.filter((s) => present.has(s));
  }, [sorted]);

  const fromAccount = useMemo(() => new Set(filterOrdersByAccount(sorted, activeAccount).map((o) => o.id)), [sorted, activeAccount]);
  const visible = sorted.filter((o) => {
    if (activeMerchant !== null && o.merchant.name !== activeMerchant) return false;
    if (status !== ALL && deriveOrderStatus(o) !== status) return false;
    if (!fromAccount.has(o.id)) return false;
    if (!matchesQuery(o, query)) return false;
    return true;
  });

  if (orders.length === 0) {
    return (
      <AppShell>
        <EmptyState
          title="No purchases yet"
          actions={
            onLoadDemo ? (
              <Button type="button" onClick={onLoadDemo}>
                Try demo data
              </Button>
            ) : undefined
          }
        >
          Your purchases appear here as we read your receipt emails. Try the demo
          data to see how purchases and refunds we find look.
        </EmptyState>
      </AppShell>
    );
  }

  const months = groupByMonth(visible);
  // The rail shows money in the most common currency; other currencies are never added in.
  const currency = mostCommonCurrency(visible) ?? "USD";
  const spend = spendByStore(visible, currency, 5);
  const maxSpend = Math.max(...spend.map((s) => s.total), 1);
  const statusCounts = STATUS_ORDER.map((s) => ({ s, n: visible.filter((o) => deriveOrderStatus(o) === s).length })).filter((x) => x.n > 0);

  return (
    <AppShell>
      {/* data-layout="wide" lets the shell use the full desktop width (#133); below xl it is one column. */}
      <div data-layout="wide" className="mx-auto max-w-ledger xl:max-w-none">
        <div className="mb-6 flex items-baseline gap-3">
          <h1 className="font-serif text-3xl text-ink xl:text-[2.5rem] xl:leading-tight">Purchases</h1>
          <span className="text-sm text-ink-faint">
            {visible.length} {visible.length === 1 ? "purchase" : "purchases"}
          </span>
        </div>

        <div className="space-y-6 xl:grid xl:grid-cols-[minmax(0,1fr)_22.5rem] xl:items-start xl:gap-8 xl:space-y-0">
          <div className="min-w-0 space-y-6">
            <div className="space-y-4">
              <label className="block">
                <span className="sr-only">Search purchases</span>
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search stores"
                  className="neu-inset min-h-[44px] w-full rounded-full bg-transparent px-5 text-sm text-ink placeholder:text-ink-faint"
                />
              </label>
              <div
                role="group"
                aria-label="Filter by status"
                className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-3 pt-1.5 sm:mx-0 sm:flex-wrap sm:px-1.5"
              >
                <FilterPill active={status === ALL} onClick={() => setStatus(ALL)}>
                  All statuses
                </FilterPill>
                {statuses.map((s: OrderDisplayStatus) => (
                  <FilterPill key={s} active={status === s} onClick={() => setStatus(s)}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </FilterPill>
                ))}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-3">
                <SearchSelect
                  label="Store"
                  options={merchantOptions}
                  value={activeMerchant}
                  onChange={setMerchant}
                  allLabel="All stores"
                  allCount={sorted.length}
                  searchPlaceholder="Search stores"
                  emptyText="No stores match"
                />
                {accountOptions.length > 0 ? (
                  <SearchSelect
                    label="Account"
                    options={accountOptions}
                    value={activeAccount}
                    onChange={setAccount}
                    allLabel="All accounts"
                    allCount={sorted.length}
                    searchPlaceholder="Search accounts"
                    emptyText="No accounts match"
                  />
                ) : null}
              </div>
            </div>

            {visible.length === 0 ? (
              <EmptyState title="No matching purchases">
                No purchases match these filters. Try clearing the search, store, account or status filter.
              </EmptyState>
            ) : (
              <div className="space-y-6">
                {months.map((m) => (
                  <section key={m.key} aria-label={m.label} className="space-y-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 className="font-serif text-xl text-ink">{m.label}</h2>
                      <span className="text-sm text-ink-muted">
                        {m.items.length} {m.items.length === 1 ? "purchase" : "purchases"}
                      </span>
                    </div>
                    <div className="anim-stagger space-y-4">
                      {m.items.map((order) => (
                        <OrderCard
                          key={order.id}
                          order={order}
                          sources={orderSources(order.sources, linkedAccounts)}
                          onOpen={() => onOpenOrder(order.id)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>

          {/* Right rail (xl and up): spend and status counts for what is currently shown. */}
          {visible.length > 0 ? (
            <aside aria-label="Summary" className="hidden space-y-5 xl:block">
              {spend.length > 0 ? (
                <section aria-label="Spend by store" className="neu-raised space-y-4 rounded-lg p-6">
                  <h2 className="font-serif text-xl text-ink">Spend by store</h2>
                  <ul className="space-y-3.5">
                    {spend.map((s) => (
                      <li key={s.merchant} className="space-y-1.5">
                        <span className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="truncate text-ink">{s.merchant}</span>
                          <span className="tabular-nums text-ink-muted">{formatMoney(s.total, currency)}</span>
                        </span>
                        <span className="neu-inset block rounded-full p-[2px]">
                          <span
                            className="block h-1.5 rounded-full bg-teal-deep"
                            style={{ width: `${Math.max(6, Math.round((s.total / maxSpend) * 100))}%` }}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section aria-label="By status" className="neu-raised space-y-3 rounded-lg p-6">
                <h2 className="font-serif text-xl text-ink">By status</h2>
                <ul className="space-y-2 text-sm">
                  {statusCounts.map(({ s, n }) => (
                    <li key={s} className="flex items-center justify-between">
                      <span className="text-ink">{s.charAt(0).toUpperCase() + s.slice(1)}</span>
                      <span className="tabular-nums text-ink-muted">{n}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </aside>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

function mostCommonCurrency(orders: readonly NormalizedOrder[]): string | null {
  const counts = new Map<string, number>();
  for (const o of orders) counts.set(o.currency, (counts.get(o.currency) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
// A pill that drives a filter choice. Active = teal accent, inactive = soft raised.
function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-[44px] flex-none items-center whitespace-nowrap rounded-sm px-4 py-1.5 text-sm font-bold transition-shadow md:min-h-[36px] ${
        active ? "neu-accent" : "neu-raised-sm text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
