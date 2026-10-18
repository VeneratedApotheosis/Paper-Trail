"use client";

import { type ReactNode, useMemo, useState } from "react";
import type { NormalizedOrder } from "@/lib/contracts";
import { AppShell } from "@/components/AppShell";
import { OrderCard } from "@/components/OrderCard";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/Button";
import { SearchSelect, type SearchSelectOption } from "@/components/ui/SearchSelect";
import { deriveOrderStatus, type OrderDisplayStatus } from "@/lib/view";

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
  onOpenOrder: (id: string) => void;
  onLoadDemo?: () => void;
}

export function LedgerView({ orders, onOpenOrder, onLoadDemo }: LedgerViewProps) {
  const [merchant, setMerchant] = useState<string | null>(null);
  const [status, setStatus] = useState<string>(ALL);

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
  const statuses = useMemo(() => {
    const present = new Set(sorted.map((o) => deriveOrderStatus(o)));
    return STATUS_ORDER.filter((s) => present.has(s));
  }, [sorted]);

  const visible = sorted.filter((o) => {
    if (activeMerchant !== null && o.merchant.name !== activeMerchant) return false;
    if (status !== ALL && deriveOrderStatus(o) !== status) return false;
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

  return (
    <AppShell>
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="font-serif text-3xl text-ink">Purchases</h1>
        <span className="text-sm text-ink-faint">
          {visible.length} {visible.length === 1 ? "purchase" : "purchases"}
        </span>
      </div>

      <div className="mb-7 space-y-3">
        <div
          role="group"
          aria-label="Filter by status"
          className="flex flex-wrap gap-2"
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
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No matching purchases">
          No purchases match these filters. Try clearing the store or status filter.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {visible.map((order) => (
            <OrderCard
              key={order.id}
              order={order}
              onOpen={() => onOpenOrder(order.id)}
            />
          ))}
        </div>
      )}
    </AppShell>
  );
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
      className={`rounded-sm px-4 py-1.5 text-sm font-bold transition-shadow ${
        active ? "neu-accent" : "neu-raised-sm text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
