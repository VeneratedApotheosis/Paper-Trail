"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ReviewCard, type OrderFieldEdit } from "@/components/ReviewCard";
import { EmptyState } from "@/components/states";
import { Chip } from "@/components/ui/Chip";
import type { NormalizedOrder } from "@/lib/contracts";
import { orders } from "@/lib/mock/data";
import { orderNeedsReview } from "@/lib/view";

// Apply one inline field edit immutably. In production this patch would POST to a
// backend edit endpoint and the server would persist it + write an audit row; here
// it only updates local component state (see INTERFACE notes below).
function applyEdit(order: NormalizedOrder, edit: OrderFieldEdit): NormalizedOrder {
  switch (edit.field) {
    case "merchantName":
      return { ...order, merchant: { ...order.merchant, name: edit.value } };
    case "orderRef":
      return { ...order, orderRef: edit.value };
    case "placedAt":
      return { ...order, placedAt: edit.value };
    case "total":
      return { ...order, total: edit.value };
    case "lineItemName":
      return {
        ...order,
        lineItems: order.lineItems.map((li) =>
          li.id === edit.lineItemId ? { ...li, name: edit.value } : li,
        ),
      };
    case "lineItemQty":
      return {
        ...order,
        lineItems: order.lineItems.map((li) =>
          li.id === edit.lineItemId ? { ...li, qty: edit.value } : li,
        ),
      };
    case "lineItemUnitPrice":
      return {
        ...order,
        lineItems: order.lineItems.map((li) =>
          li.id === edit.lineItemId ? { ...li, unitPrice: edit.value } : li,
        ),
      };
  }
}

export default function ReviewPage() {
  // The page owns the queue (client state). Seeded from orders that fail the
  // confidence threshold (demo: ord_1004 at 61%).
  const [queue, setQueue] = useState<NormalizedOrder[]>(() =>
    orders.filter(orderNeedsReview),
  );
  // Names of orders the user has confirmed this session, for the "now included" note.
  const [confirmed, setConfirmed] = useState<string[]>([]);

  function handleEdit(orderId: string, edit: OrderFieldEdit) {
    setQueue((prev) =>
      prev.map((o) => (o.id === orderId ? applyEdit(o, edit) : o)),
    );
  }

  function handleConfirm(orderId: string) {
    setQueue((prev) => {
      const confirmedOrder = prev.find((o) => o.id === orderId);
      if (confirmedOrder) {
        setConfirmed((names) => [...names, confirmedOrder.merchant.name]);
      }
      return prev.filter((o) => o.id !== orderId);
    });
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="font-serif text-3xl text-ink">Needs review</h1>
        <p className="mt-1 max-w-ledger text-base text-ink-muted">
          Orders we parsed with low confidence. They are{" "}
          <span className="font-medium text-ink">excluded from your &ldquo;owed&rdquo; total</span>{" "}
          until you confirm the details — so the headline number only reflects purchases
          we&rsquo;re sure about.
        </p>
      </div>

      {confirmed.length > 0 ? (
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-md border border-saved/30 bg-saved-tint px-4 py-3 text-sm text-saved">
          <Chip tone="saved">Confirmed</Chip>
          <span>
            {confirmed.join(", ")} now included in owed totals. Edit logged to audit
            (stubbed).
          </span>
        </div>
      ) : null}

      {queue.length === 0 ? (
        <EmptyState title="Nothing to review">
          {confirmed.length > 0
            ? "Every flagged order has been confirmed and is now counted in your owed total."
            : "No orders fell below the confidence threshold. New low-confidence purchases will appear here for a quick check."}
        </EmptyState>
      ) : (
        <>
          <p className="mb-4 text-sm text-ink-muted">
            <span className="font-medium tabular-nums text-ink">{queue.length}</span>{" "}
            order{queue.length === 1 ? "" : "s"} remaining to review.
          </p>
          <div className="flex flex-col gap-6">
            {queue.map((order) => (
              <ReviewCard
                key={order.id}
                order={order}
                onEdit={handleEdit}
                onConfirm={handleConfirm}
              />
            ))}
          </div>
        </>
      )}
    </AppShell>
  );
}
