"use client";

import { type ReactNode, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { OrderCard } from "@/components/OrderCard";
import { EmptyState } from "@/components/states";
import { orders } from "@/lib/mock/data";
import { deriveOrderStatus, type OrderDisplayStatus } from "@/lib/view";

const ALL = "all" as const;

export default function LedgerPage() {
  const [merchant, setMerchant] = useState<string>(ALL);
  const [status, setStatus] = useState<string>(ALL);

  // Reverse-chronological: newest order first.
  const sorted = useMemo(
    () =>
      [...orders].sort(
        (a, b) => new Date(b.placedAt).getTime() - new Date(a.placedAt).getTime(),
      ),
    [],
  );

  const merchants = useMemo(
    () => Array.from(new Set(sorted.map((o) => o.merchant.name))).sort(),
    [sorted],
  );
  const statuses = useMemo(
    () => Array.from(new Set(sorted.map((o) => deriveOrderStatus(o)))),
    [sorted],
  );

  const visible = sorted.filter((o) => {
    if (merchant !== ALL && o.merchant.name !== merchant) return false;
    if (status !== ALL && deriveOrderStatus(o) !== status) return false;
    return true;
  });

  return (
    <AppShell>
      <div className="mb-6 flex items-baseline gap-3">
        <h1 className="font-serif text-3xl text-ink">Ledger</h1>
        <span className="text-sm text-ink-faint">
          {visible.length} {visible.length === 1 ? "order" : "orders"}
        </span>
      </div>

      <div className="mb-7 space-y-3">
        <div className="flex flex-wrap gap-2">
          <FilterPill active={status === ALL} onClick={() => setStatus(ALL)}>
            All
          </FilterPill>
          {statuses.map((s: OrderDisplayStatus) => (
            <FilterPill key={s} active={status === s} onClick={() => setStatus(s)}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </FilterPill>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterPill active={merchant === ALL} onClick={() => setMerchant(ALL)}>
            All merchants
          </FilterPill>
          {merchants.map((m) => (
            <FilterPill key={m} active={merchant === m} onClick={() => setMerchant(m)}>
              {m}
            </FilterPill>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No matching orders">
          No orders match these filters. Try clearing the merchant or status filter.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          {visible.map((order) => (
            <OrderCard key={order.id} order={order} />
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
