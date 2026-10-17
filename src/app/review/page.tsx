"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { type OrderFieldEdit } from "@/components/ReviewCard";
import { ReviewView } from "@/components/views/ReviewView";
import { Chip } from "@/components/ui/Chip";
import type { NormalizedOrder } from "@/lib/contracts";
import { orders } from "@/lib/mock/data";
import { orderNeedsReview } from "@/lib/view";

// Apply one inline field edit immutably. In production this patch would POST to a
// backend edit endpoint (POST /api/review/:id/edit) and the server would persist
// it + write an audit row; here it only updates local component state.
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

// Thin wrapper: owns the mock review queue (client state) and supplies it to the
// props-only ReviewView. ui-wiring (Kenan) replaces the mock source + optimistic
// handlers with real calls to POST /api/review/:id/confirm and /edit here; the
// view itself stays data-agnostic.
export default function ReviewPage() {
  // Seeded from orders that fail the confidence threshold (demo: ord_1004 at 61%).
  const [queue, setQueue] = useState<NormalizedOrder[]>(() =>
    orders.filter(orderNeedsReview),
  );
  // Names of orders confirmed this session, for the "now included" note.
  const [confirmed, setConfirmed] = useState<string[]>([]);

  function handleEditField(orderId: string, edit: OrderFieldEdit) {
    setQueue((prev) =>
      prev.map((o) => (o.id === orderId ? applyEdit(o, edit) : o)),
    );
  }

  function handleConfirm(orderId: string) {
    // Record the confirmed name OUTSIDE the setQueue updater. Under React
    // StrictMode dev double-invokes updaters, so calling setConfirmed inside
    // setQueue appended the merchant name twice. Real persistence will POST to
    // /api/review/:id/confirm (writes the audit row); here we optimistically
    // drop the order from the local queue.
    const confirmedOrder = queue.find((o) => o.id === orderId);
    if (confirmedOrder) {
      setConfirmed((names) => [...names, confirmedOrder.merchant.name]);
    }
    setQueue((prev) => prev.filter((o) => o.id !== orderId));
  }

  return (
    <AppShell>
      {confirmed.length > 0 ? (
        <div className="neu-inset mb-6 flex flex-wrap items-center gap-2 rounded-lg px-4 py-3 text-sm text-ink-muted">
          <Chip tone="saved">Confirmed</Chip>
          <span>
            {confirmed.join(", ")} now included in owed totals. Edit logged to audit
            (stubbed).
          </span>
        </div>
      ) : null}
      <ReviewView
        items={queue}
        onConfirm={handleConfirm}
        onEditField={handleEditField}
      />
    </AppShell>
  );
}
