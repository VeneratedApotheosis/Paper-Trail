"use client";

import { useMemo, useState } from "react";
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
      <div className="mb-6">
        <h1 className="font-serif text-3xl text-ink">Ledger</h1>
        <p className="mt-1 text-base text-ink-muted">
          Every purchase, newest first. Each row is an order.
        </p>
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="col-head">Merchant</span>
          <select
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            className="rounded-sm border border-rule bg-paper px-2 py-1.5 text-sm text-ink"
          >
            <option value={ALL}>All merchants</option>
            {merchants.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="col-head">Status</span>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-sm border border-rule bg-paper px-2 py-1.5 text-sm text-ink"
          >
            <option value={ALL}>All statuses</option>
            {statuses.map((s: OrderDisplayStatus) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {visible.length === 0 ? (
        <EmptyState title="No matching orders">
          No orders match these filters. Try clearing the merchant or status filter.
        </EmptyState>
      ) : (
        <div>
          <div className="flex items-center gap-4 border-b border-rule px-2 pb-2">
            <span className="col-head w-20 shrink-0">Date</span>
            <span className="col-head min-w-0 flex-1">Merchant</span>
            <span className="col-head shrink-0">Status</span>
            <span className="col-head w-28 shrink-0 text-right">Amount</span>
          </div>
          {visible.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      )}
    </AppShell>
  );
}
